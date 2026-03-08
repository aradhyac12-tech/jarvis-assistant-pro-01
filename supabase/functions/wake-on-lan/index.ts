import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseMac(mac: string): Uint8Array {
  const clean = mac.replace(/[:\-\.]/g, "");
  if (clean.length !== 12) throw new Error("Invalid MAC address");
  const bytes = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function buildMagicPacket(macBytes: Uint8Array): Uint8Array {
  const packet = new Uint8Array(102);
  // 6 bytes of 0xFF
  for (let i = 0; i < 6; i++) packet[i] = 0xff;
  // 16 repetitions of MAC address
  for (let i = 0; i < 16; i++) {
    packet.set(macBytes, 6 + i * 6);
  }
  return packet;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mac_address, broadcast_ip } = await req.json();
    if (!mac_address) {
      return new Response(
        JSON.stringify({ success: false, error: "MAC address required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const macBytes = parseMac(mac_address);
    const packet = buildMagicPacket(macBytes);
    const target = broadcast_ip || "255.255.255.255";

    // Send UDP magic packet via Deno
    const conn = Deno.listenDatagram({ port: 0, transport: "udp" });
    await conn.send(packet, { hostname: target, port: 9, transport: "udp" });
    conn.close();

    console.log(`WOL packet sent to ${mac_address} via ${target}:9`);

    return new Response(
      JSON.stringify({ success: true, message: `Magic packet sent to ${mac_address}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("WOL error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
