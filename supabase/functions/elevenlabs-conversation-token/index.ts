import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token",
};

/**
 * ElevenLabs Conversation Token Generator
 * 
 * Generates a secure token for WebRTC-based voice conversation with ElevenLabs agents.
 * This keeps the API key server-side for security.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    
    if (!ELEVENLABS_API_KEY) {
      console.error("ELEVENLABS_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body for agent_id (optional - can use default)
    let agentId: string | undefined;
    try {
      const body = await req.json();
      agentId = body.agent_id;
    } catch {
      // No body provided, use default agent
    }

    // If no agent ID provided, we'll use the signed URL approach for flexibility
    // The client can specify an agent ID when starting the conversation
    if (!agentId) {
      // Return a signed URL that works with any agent
      const response = await fetch(
        "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url",
        {
          method: "GET",
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("ElevenLabs API error:", errorText);
        
        // For now, return a success with instructions to use agentId directly
        // This is because signed URLs require an agent to be configured
        return new Response(
          JSON.stringify({ 
            useAgentId: true,
            message: "Use agent ID directly - no pre-configured agent" 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();
      console.log("Got signed URL for conversation");
      
      return new Response(
        JSON.stringify({ signed_url: data.signed_url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get conversation token for specific agent
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      {
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to get conversation token", details: errorText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    console.log("Got conversation token for agent:", agentId);

    return new Response(
      JSON.stringify({ signed_url: data.signed_url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in elevenlabs-conversation-token:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
