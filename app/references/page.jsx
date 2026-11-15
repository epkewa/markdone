import { redirect } from "next/navigation";
import { configured, supabase } from "../../lib/supabase/server";
import { Library } from "./library";
import { analysisConfigured } from "../../lib/video-analysis/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

export default async function ReferencesPage({ searchParams }) {
  if (!configured()) redirect("/sign-in");

  const client = await supabase();
  const { data } = await client.auth.getClaims();
  const owner = data?.claims.sub;
  if (!owner) redirect("/sign-in");

  const [folders, references] = await Promise.all([
    collectPages(() => client.from("folders").select("id,name").eq("owner_id", owner).order("name").order("id")),
    collectPages(() => client.from("saved_references")
      .select("id,platform,post_id,kind,url,title,created_at,ai_status,ai_summary,ai_playbook,ai_version,ai_source,ai_claim_until,folder_references(folder_id)")
      .eq("owner_id", owner).order("created_at", { ascending: false }).order("id", { ascending: false })),
  ]);

  const { reference: referenceId } = await searchParams;
  const initialReference = references.find(({ id }) => id === referenceId);
  return <Library email={data.claims.email} folders={folders} references={references} analysisEnabled={analysisConfigured()}
    initialReference={initialReference} missingReference={Boolean(referenceId) && !initialReference} />;
}
