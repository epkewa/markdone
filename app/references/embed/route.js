import { configured, supabase } from "../../../lib/supabase/server";
import { instagramEmbed } from "../../../lib/instagram-embed";

export async function GET(request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!configured()) return new Response(null, { status: 401, headers });
  const client = await supabase();
  const { data: auth } = await client.auth.getClaims();
  if (!auth?.claims.sub) return new Response(null, { status: 401, headers });

  const id = request.nextUrl.searchParams.get("id") || "";
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) {
    return new Response(null, { status: 400, headers });
  }
  const { data } = await client.from("saved_references").select("url").eq("id", id)
    .eq("owner_id", auth.claims.sub).maybeSingle();
  return instagramEmbed(data?.url, headers);
}
