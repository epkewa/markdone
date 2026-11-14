import { redirect } from "next/navigation";
import { configured, supabase } from "../../lib/supabase/server";
import { Library } from "./library";

export const dynamic = "force-dynamic";

async function collectPages(query) {
  const rows = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await query().range(offset, offset + size - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < size) return rows;
  }
}

export default async function ReferencesPage() {
  if (!configured()) redirect("/sign-in");

  const client = await supabase();
  const { data } = await client.auth.getClaims();
  const owner = data?.claims.sub;
  if (!owner) redirect("/sign-in");

  const [folders, references] = await Promise.all([
    collectPages(() => client.from("folders").select("id,name").eq("owner_id", owner).order("name").order("id")),
    collectPages(() => client.from("saved_references")
      .select("id,platform,post_id,kind,url,title,created_at,folder_references(folder_id)")
      .eq("owner_id", owner).order("created_at", { ascending: false }).order("id", { ascending: false })),
  ]);

  return <Library email={data.claims.email} folders={folders} references={references} />;
}
