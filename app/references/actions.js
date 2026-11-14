"use server";

import { revalidatePath } from "next/cache";
import { supabase, configured } from "../../lib/supabase/server";
import { resolveLink, referenceSources } from "../../lib/references";
import { analyzeSavedVideo } from "../../lib/video-analysis/service";

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

async function mutate(operation) {
  if (!configured()) return { error: "Sign in to continue." };
  const client = await supabase();
  const { data } = await client.auth.getClaims();
  const owner = data?.claims.sub;
  if (!owner) return { error: "Your session ended. Sign in again to continue." };
  try {
    const result = await operation(client, owner);
    if (result?.error) return result;
    revalidatePath("/references");
    return { ok: true };
  } catch (error) {
    console.error("Markdone library mutation failed", error?.code);
    return { error: "The change couldn’t be saved. Try again." };
  }
}

function folderIds(data) {
  const ids = [...new Set(data.getAll("folderIds"))];
  return ids.length <= 100 && ids.every((id) => typeof id === "string" && uuid.test(id)) ? ids : null;
}

function rpcArgs(reference, folders) {
  return {
    p_platform: reference.platform,
    p_post_id: reference.id,
    p_kind: reference.kind,
    p_url: reference.url,
    p_folder_ids: folders,
  };
}

async function analyzeAfterSave(client, owner, id, options) {
  try {
    await analyzeSavedVideo(client, owner, id, options);
  } catch (error) {
    console.error("Markdone could not update video analysis", error?.code || error?.name);
  }
}

export async function saveReference(_state, data) {
  return mutate(async (client, owner) => {
    const ids = folderIds(data);
    if (!ids) return { error: "Choose valid folders." };
    const reference = await resolveLink(data.get("url"));
    if (!reference) return { error: `Paste a link to a post from ${referenceSources}.` };
    const { data: id, error } = await client.rpc("save_reference", rpcArgs(reference, ids));
    if (error?.code === "23503") return { error: "A selected folder was deleted. Reopen this form and try again." };
    if (error) throw error;
    if (reference.id && reference.kind !== "photo") await analyzeAfterSave(client, owner, id);
  });
}

export async function retryReference(_state, data) {
  return mutate(async (client, owner) => {
    const id = String(data.get("id") ?? "");
    if (!uuid.test(id)) return { error: "Reference couldn’t be found." };
    const { data: saved, error } = await client.from("saved_references").select("url")
      .eq("id", id).eq("owner_id", owner).is("post_id", null).maybeSingle();
    if (error) throw error;
    if (!saved) return { error: "This reference has already changed. Reopen it and try again." };
    const reference = await resolveLink(saved.url);
    if (!reference?.id) return { error: "The platform didn’t resolve this share link. You can still open the original." };
    const { data: resolvedId, error: saveError } = await client.rpc("save_reference", { ...rpcArgs(reference, []), p_share_id: id });
    if (saveError) throw saveError;
    if (reference.kind !== "photo") await analyzeAfterSave(client, owner, resolvedId, { explicit: true });
  });
}

export async function analyzeReference(_state, data) {
  return mutate(async (client, owner) => {
    const id = String(data.get("id") ?? "");
    if (!uuid.test(id)) return { error: "Reference couldn’t be found." };
    const status = await analyzeSavedVideo(client, owner, id, { explicit: true });
    if (status === "disabled") return { error: "Video analysis isn’t configured." };
  });
}

export async function saveFolder(_state, data) {
  return mutate(async (client, owner) => {
    const name = String(data.get("name") ?? "").trim();
    const id = String(data.get("id") ?? "");
    if (!name || name.length > 60) return { error: "Enter a folder name up to 60 characters." };
    if (id && !uuid.test(id)) return { error: "Folder couldn’t be found." };
    const query = client.from("folders");
    const { data: folder, error } = id
      ? await query.update({ name }).eq("id", id).eq("owner_id", owner).select("id").maybeSingle()
      : await query.insert({ name, owner_id: owner }).select("id").single();
    if (error?.code === "23505") return { error: "A folder with this name already exists." };
    if (error) throw error;
    if (!folder) return { error: "Folder couldn’t be found." };
  });
}

export async function editMemberships(_state, data) {
  return mutate(async (client) => {
    const id = String(data.get("id") ?? "");
    const ids = folderIds(data);
    if (!uuid.test(id) || !ids) return { error: "This reference or folder selection is invalid." };
    const { error } = await client.rpc("set_reference_folders", { p_reference_id: id, p_folder_ids: ids });
    if (error?.code === "23503") return { error: "A selected folder was deleted. Reopen this form and try again." };
    if (error?.code === "P0002") return { error: "Reference couldn’t be found." };
    if (error) throw error;
  });
}

async function remove(data, table) {
  return mutate(async (client, owner) => {
    const id = String(data.get("id") ?? "");
    if (!uuid.test(id)) return { error: "This item couldn’t be found." };
    const { error } = await client.from(table).delete().eq("id", id).eq("owner_id", owner);
    if (error) throw error;
  });
}

export async function deleteReference(_state, data) {
  return remove(data, "saved_references");
}

export async function deleteFolder(_state, data) {
  return remove(data, "folders");
}
