"use server";

import { revalidatePath } from "next/cache";
import { configured, supabase } from "../../../lib/supabase/server";
import { parsePlanRequest, sendVideoPlan, uuid } from "../../../lib/video-planner/service";

async function account() {
  if (!configured()) return {};
  const client = await supabase();
  const { data } = await client.auth.getClaims();
  return { client, owner: data?.claims.sub };
}

export async function sendPlan(input) {
  const request = parsePlanRequest(input);
  if (!request) return { error: "Enter a video idea up to 2,000 characters." };
  const { client, owner } = await account();
  if (!owner) return { error: "Your session ended. Sign in again to continue." };
  try {
    const result = await sendVideoPlan(client, owner, request);
    if (result.status === "conflict") {
      return { conflict: true, error: "This chat was updated or deleted in another tab. Refresh the chat before sending again." };
    }
    if (result.status === "unavailable") return { error: "Video planning is unavailable right now." };
    revalidatePath("/references/plan");
    return { chatId: result.chatId };
  } catch (error) {
    console.error("Markdone video planner failed", error?.code || error?.name);
    return { error: "Couldn’t make a video plan. Try sending your idea again." };
  }
}

export async function deletePlan(_state, form) {
  const id = form.get("chatId");
  if (typeof id !== "string" || !uuid.test(id)) return { error: "Chat couldn’t be found." };
  const { client, owner } = await account();
  if (!owner) return { error: "Your session ended. Sign in again to continue." };
  const { error } = await client.from("video_plan_chats").delete().eq("owner_id", owner).eq("id", id);
  if (error) return { error: "Couldn’t delete this chat. Try again." };
  return { ok: true };
}
