import { cleanText, fetchThumbnail, getVideoMetadata } from "./metadata.js";
import { generateVideoAnalysis } from "./model.js";

export function analysisConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function analyzeSavedVideo(client, owner, id, {
  explicit = false,
  apiKey = process.env.ANTHROPIC_API_KEY,
  youtubeKey = process.env.YOUTUBE_DATA_API_KEY,
  fetcher = fetch,
  generate = generateVideoAnalysis,
} = {}) {
  if (!apiKey) return "disabled";
  const { data: claim, error } = await client.rpc("claim_reference_analysis", {
    p_reference_id: id, p_explicit: explicit,
  });
  if (error) throw error;
  if (!claim) return "unchanged";

  async function finish(status, result = {}) {
    const { data, error: finishError } = await client.rpc("finish_reference_analysis", {
      p_reference_id: id, p_token: claim.token, p_status: status, ...result,
    });
    if (finishError) throw finishError;
    return data ? status : "unchanged";
  }

  try {
    const signal = AbortSignal.timeout(22000);
    const fetchOptions = { fetcher, signal, youtubeKey };
    const metadata = await getVideoMetadata(claim, fetchOptions);
    if (!metadata.video) return await finish(metadata.lookupFailed ? "failed" : "not_video");

    const { title, description, thumbnail: imageUrl } = metadata;
    const thumbnail = description.length < 120
      ? await fetchThumbnail(claim.platform, imageUrl, fetchOptions) : null;
    if (!(title || description || thumbnail)) {
      return await finish(metadata.lookupFailed ? "failed" : "unavailable");
    }

    let folders = null;
    if (!claim.manual_folders) {
      const { data, error: folderError } = await client.from("folders").select("id,name")
        .eq("owner_id", owner).order("name").order("id").limit(100).abortSignal(signal);
      if (folderError) throw folderError;
      folders = data;
    }

    const result = await generate({
      platform: claim.platform, title, description, thumbnail, folders,
    }, { apiKey, signal });
    if (typeof result?.sufficient !== "boolean") throw new Error("Invalid video analysis");
    if (!result.sufficient) return await finish("unavailable");

    const summary = cleanText(result.summary, 550);
    const generatedTitle = cleanText(result.title, 120);
    if (!generatedTitle || !summary || !Array.isArray(result.steps)) throw new Error("Invalid video analysis");
    const matchedFolder = Number.isInteger(result.folderIndex) && result.folderIndex >= 0
      ? folders?.[result.folderIndex] : null;
    return await finish("ready", {
      p_title: generatedTitle,
      p_summary: summary,
      p_steps: [...new Set(result.steps.map((step) => cleanText(step, 200)).filter(Boolean))].slice(0, 3),
      p_source: "metadata",
      p_folder_id: matchedFolder?.id ?? null,
      p_folder_name: folders && result.folderIndex === -1 ? cleanText(result.newFolder, 60) || null : null,
    });
  } catch (analysisError) {
    // Provider errors may include prompts or headers. Log only the error type.
    console.error("Markdone video analysis failed", analysisError?.name);
    return finish("failed");
  }
}
