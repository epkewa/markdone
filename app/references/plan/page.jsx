import { notFound, redirect } from "next/navigation";
import { configured, supabase } from "../../../lib/supabase/server";
import { uuid } from "../../../lib/video-planner/service";
import { Planner } from "./planner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function readPages(query) {
  const rows = [];
  const size = 100;
  for (let start = 0; ; start += size) {
    const { data, error } = await query().range(start, start + size - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < size) return rows;
  }
}

export default async function PlanPage({ searchParams }) {
  if (!configured()) redirect("/sign-in");
  const client = await supabase();
  const { data } = await client.auth.getClaims();
  const owner = data?.claims.sub;
  if (!owner) redirect("/sign-in");
  const { chat: chatId } = await searchParams;
  if (chatId !== undefined && (typeof chatId !== "string" || !uuid.test(chatId))) notFound();

  const [chats, turns] = await Promise.all([
    readPages(() => client.from("video_plan_chats").select("id,title,last_turn")
      .eq("owner_id", owner).order("updated_at", { ascending: false }).order("id", { ascending: false })),
    chatId ? readPages(() => client.from("video_plan_turns").select("turn_number,prompt,reply")
      .eq("owner_id", owner).eq("chat_id", chatId).order("turn_number")) : [],
  ]);

  const chat = chats.find(({ id }) => id === chatId);
  if (chatId && !chat) notFound();

  const ids = [...new Set(turns.flatMap(({ reply }) => (reply.references ?? []).map(({ id }) => id)))];
  const lookups = [];
  for (let start = 0; start < ids.length; start += 100) {
    lookups.push(client.from("saved_references").select("id").eq("owner_id", owner).in("id", ids.slice(start, start + 100)));
  }
  const available = (await Promise.all(lookups)).flatMap(({ data, error }) => {
    if (error) throw error;
    return data.map(({ id }) => id);
  });

  return <Planner email={data.claims.email} chats={chats} chat={chat} turns={turns}
    available={available} enabled={Boolean(process.env.GEMINI_API_KEY)} />;
}
