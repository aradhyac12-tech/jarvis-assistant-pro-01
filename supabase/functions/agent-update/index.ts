import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    // For GET with device_key - agent checking for updates (no auth needed)
    if (req.method === "GET") {
      const url = new URL(req.url);
      const deviceKey = url.searchParams.get("device_key");
      
      if (!deviceKey) {
        return new Response(JSON.stringify({ error: "device_key required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey);

      // Find device by key to get user_id
      const { data: device } = await supabase
        .from("devices")
        .select("user_id")
        .eq("device_key", deviceKey)
        .single();

      if (!device) {
        return new Response(JSON.stringify({ error: "device not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get latest update for this user
      const { data: update } = await supabase
        .from("agent_updates")
        .select("*")
        .eq("user_id", device.user_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!update) {
        return new Response(JSON.stringify({ version: null, message: "no updates" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        version: update.version,
        file_manifest: update.file_manifest,
        created_at: update.created_at,
        notes: update.notes,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST - push update (requires auth)
    if (req.method === "POST") {
      const authHeader = req.headers.get("authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey);
      const userSupabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user } } = await userSupabase.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const { version, files, notes } = body;
      // files: Array<{ path: string, content: string }> (base64 encoded content)

      if (!version || !files || !Array.isArray(files)) {
        return new Response(JSON.stringify({ error: "version and files required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const manifest: Array<{ path: string; size: number; hash: string }> = [];

      // Upload each file to storage
      for (const file of files) {
        const storagePath = `${user.id}/${version}/${file.path}`;
        const contentBytes = Uint8Array.from(atob(file.content), c => c.charCodeAt(0));

        const { error: uploadError } = await supabase.storage
          .from("agent-files")
          .upload(storagePath, contentBytes, {
            contentType: "application/octet-stream",
            upsert: true,
          });

        if (uploadError) {
          console.error(`Upload error for ${file.path}:`, uploadError);
          return new Response(JSON.stringify({ error: `upload failed: ${file.path}`, details: uploadError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        manifest.push({
          path: file.path,
          size: contentBytes.length,
          hash: await hashContent(contentBytes),
        });
      }

      // Record update
      const { error: insertError } = await supabase
        .from("agent_updates")
        .insert({
          user_id: user.id,
          version,
          file_manifest: manifest,
          notes: notes || `Update to v${version}`,
        });

      if (insertError) {
        return new Response(JSON.stringify({ error: "failed to record update", details: insertError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        version,
        files_uploaded: manifest.length,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET file download - agent downloading specific file
    if (req.method === "PATCH") {
      // Using PATCH to download files (GET is taken for manifest)
      const body = await req.json();
      const { device_key, version, file_path } = body;

      if (!device_key || !version || !file_path) {
        return new Response(JSON.stringify({ error: "device_key, version, file_path required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey);

      const { data: device } = await supabase
        .from("devices")
        .select("user_id")
        .eq("device_key", device_key)
        .single();

      if (!device) {
        return new Response(JSON.stringify({ error: "device not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const storagePath = `${device.user_id}/${version}/${file_path}`;
      const { data, error } = await supabase.storage
        .from("agent-files")
        .download(storagePath);

      if (error || !data) {
        return new Response(JSON.stringify({ error: "file not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const bytes = new Uint8Array(await data.arrayBuffer());
      const b64 = btoa(String.fromCharCode(...bytes));

      return new Response(JSON.stringify({ content: b64, path: file_path }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("agent-update error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function hashContent(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
