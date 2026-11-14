import { configured, supabase } from "../../lib/supabase/server";
import { demoFolders } from "../../lib/demo-folders";
import { parseLink } from "../../lib/references";
import { DemoLibrary } from "./demo-library";

export const metadata = { title: "Try Markdone — Demo Library" };
export const dynamic = "force-dynamic";

async function readCatalog() {
  if (!configured()) return null;
  try {
    const client = await supabase();
    const { data, error } = await client.from("demo_references")
      .select("id,url,title,folders").order("sort_order").order("id");
    if (error) throw error;

    return data.flatMap(({ id, url, title, folders }) => {
      const link = parseLink(url);
      if (!link) return [];
      return [{
        id,
        url: link.url,
        title,
        platform: link.platform,
        post_id: link.id,
        kind: link.kind,
        folder_references: demoFolders.filter(({ key }) => folders.includes(key))
          .map(({ id }) => ({ folder_id: id })),
      }];
    });
  } catch (error) {
    console.error("Markdone demo catalog unavailable", error?.code);
    return null;
  }
}

export default async function DemoPage() {
  return <DemoLibrary catalog={await readCatalog()} />;
}
