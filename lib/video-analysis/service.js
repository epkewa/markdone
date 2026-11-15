import { cleanText, fetchThumbnail, getVideoMetadata } from "./metadata.js";
import { generateVideoAnalysis, VideoInputRejected } from "./model.js";

export function analysisConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function parseTimeCode(value) {
  if (typeof value !== "string") return NaN;
  const match = /^(\d{1,4}):([0-5]\d(?:\.\d{1,3})?)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function validatePlaybook(playbook, videoInput) {
  if (!playbook || !videoInput) return null;
  const windowStart = videoInput.startSeconds ?? 0;
  const windowEnd = videoInput.endSeconds ?? videoInput.durationSeconds;
  const { materials, steps } = playbook;
  const startSeconds = parseTimeCode(playbook.startTime);
  const endSeconds = parseTimeCode(playbook.endTime);
  const observation = cleanText(playbook.observation, 350);
  const playbackCheck = cleanText(playbook.playbackCheck, 350);
  if (!observation || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
      startSeconds < windowStart || startSeconds >= windowEnd || endSeconds < startSeconds || endSeconds > windowEnd ||
      !Array.isArray(materials) || materials.length < 1 || materials.length > 5 ||
      !Array.isArray(steps) || steps.length < 2 || steps.length > 4 || !playbackCheck) return null;

  const cleanedMaterials = materials.map((material) => cleanText(material, 160));
  const cleanedSteps = steps.map((step) => ({
    title: cleanText(step?.title, 100),
    action: cleanText(step?.action, 350),
  }));
  if (cleanedMaterials.some((material) => !material) || cleanedSteps.some(({ title, action }) => !title || !action) ||
      new Set(cleanedSteps.map(({ action }) => action.toLowerCase())).size !== steps.length) return null;

  return {
    startSeconds, endSeconds, observation, materials: [...new Set(cleanedMaterials)],
    steps: [...cleanedSteps, { title: "Check playback", action: playbackCheck }],
  };
}

export async function analyzeSavedVideo(client, owner, id, {
  explicit = false,
  refreshLegacy = false,
  startAt,
  apiKey = process.env.GEMINI_API_KEY,
  youtubeKey = process.env.YOUTUBE_DATA_API_KEY,
  fetcher = fetch,
  generate = generateVideoAnalysis,
} = {}) {
  if (!apiKey) return "disabled";
  const { data: claim, error } = await client.rpc("claim_reference_analysis", {
    p_reference_id: id, p_explicit: explicit, p_refresh_legacy: refreshLegacy, p_analyze_moment: startAt !== undefined,
  });
  if (error) throw error;
  if (!claim) return "unchanged";

  async function finish(status, result = {}) {
    const { data, error: finishError } = await client.rpc("finish_reference_analysis", {
      p_reference_id: id, p_token: claim.token, p_status: status, p_playbook: null, p_video_window: null, ...result,
    });
    if (finishError) throw finishError;
    if (!data) return "unchanged";
    if (!claim.has_previous || status === "ready") return status;
    return status === "failed" ? "refresh_failed" : "refresh_unavailable";
  }

  try {
    const signal = AbortSignal.timeout(45000);
    const fetchOptions = { fetcher, signal, youtubeKey, startAt };
    const metadata = await getVideoMetadata(claim, fetchOptions);
    if (startAt !== undefined && !metadata.videoInput) {
      const status = await finish(metadata.lookupFailed ? "failed" : "unavailable");
      return status === "unchanged" || metadata.lookupFailed ? status : "invalid_start";
    }
    if (!metadata.video) return await finish(metadata.lookupFailed ? "failed" : "not_video");

    const { title, description, thumbnail: imageUrl, videoInput } = metadata;
    const thumbnail = videoInput ? null : await fetchThumbnail(claim.platform, imageUrl, fetchOptions);
    if (!(title || description || thumbnail || videoInput)) {
      return await finish(metadata.lookupFailed ? "failed" : "unavailable");
    }

    function finishFromPostDetails() {
      if (claim.has_previous || (!title && !description)) return finish("unavailable");
      return finish("ready", {
        p_title: cleanText(title || description, 120),
        p_summary: cleanText(description || title, 550),
        p_source: "metadata",
      });
    }

    let folders = null;
    if (!claim.manual_folders) {
      const { data, error: folderError } = await client.from("folders").select("id,name")
        .eq("owner_id", owner).order("name").order("id").limit(100).abortSignal(signal);
      if (folderError) throw folderError;
      folders = data;
    }

    let result;
    try {
      result = await generate({
        platform: claim.platform, title, description, thumbnail, folders, videoInput,
      }, { apiKey, signal, fetcher });
    } catch (error) {
      if (!(error instanceof VideoInputRejected) || !videoInput) throw error;
      return await finishFromPostDetails();
    }
    if (typeof result?.sufficient !== "boolean") throw new Error("Invalid video analysis");
    if (!result.sufficient) return await finishFromPostDetails();

    const summary = cleanText(result.summary, 550);
    const generatedTitle = cleanText(result.title, 120);
    if (!generatedTitle || !summary) throw new Error("Invalid video analysis");
    const playbook = validatePlaybook(result.playbook, videoInput);
    if (claim.has_playbook && !playbook) return await finish("unavailable");
    const matchedFolder = Number.isInteger(result.folderIndex) && result.folderIndex >= 0
      ? folders?.[result.folderIndex] : null;
    return await finish("ready", {
      p_title: generatedTitle,
      p_summary: summary,
      p_playbook: playbook,
      p_video_window: videoInput?.startSeconds === undefined ? null :
        { startSeconds: videoInput.startSeconds, endSeconds: videoInput.endSeconds },
      p_source: videoInput ? "video" : "metadata",
      p_folder_id: matchedFolder?.id ?? null,
      p_folder_name: folders && result.folderIndex === -1 ? cleanText(result.newFolder, 60) || null : null,
    });
  } catch (analysisError) {
    // Provider errors may include prompts or headers. Log only the error type.
    console.error("Markdone video analysis failed", analysisError?.name);
    return finish("failed");
  }
}
