import { Parser } from "htmlparser2";
import { parseLink } from "../references.js";

const pageLimit = 512 * 1024;
const pinterestPageLimit = 2 * 1024 * 1024;
const imageLimit = 512 * 1024;

export function cleanText(value, limit) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, limit).trim() : "";
}

export function readPageMetadata(html, link) {
  const tags = new Map();
  const videos = [];
  const isPinterest = link?.platform === "pinterest";
  let inHead = true;
  let structuredData = null;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (isPinterest && tag === "script" && attrs.type === "application/ld+json") {
        structuredData = "";
      }
      // Pinterest can place its Open Graph metadata in the body.
      if ((!inHead && !isPinterest) || tag !== "meta") return;
      const key = (attrs.property || attrs.name || attrs.itemprop)?.toLowerCase();
      if (key && attrs.content && !tags.has(key)) tags.set(key, attrs.content);
    },
    ontext(text) {
      if (structuredData !== null) structuredData += text;
    },
    onclosetag(tag) {
      if (tag === "head") inHead = false;
      if (tag !== "script" || structuredData === null) return;
      try {
        const value = JSON.parse(structuredData);
        if (value?.["@type"] === "VideoObject") videos.push(value);
      } catch {
        // Ignore incomplete or invalid structured data.
      }
      structuredData = null;
    },
  });
  parser.end(html);
  const canonical = parseLink(tags.get("og:url"));
  const video = videos.find((item) => {
    const pin = parseLink(item["@id"]);
    return pin?.platform === "pinterest" && (pin.id === link.id ||
      (canonical?.platform === "pinterest" && pin.id === canonical.id));
  });
  return {
    title: video?.name || tags.get("og:title") || tags.get("twitter:title"),
    description: video?.description || video?.caption || tags.get("og:description") || tags.get("twitter:description") || tags.get("description"),
    thumbnail: (Array.isArray(video?.thumbnailUrl) ? video.thumbnailUrl[0] : video?.thumbnailUrl) ||
      tags.get("og:image") || tags.get("twitter:image"),
    video: Boolean(video) || tags.get("og:type")?.toLowerCase().startsWith("video") ||
      ["og:video", "og:video:url", "og:video:secure_url", "twitter:player:stream"].some((key) => tags.has(key)) ||
      tags.get("medium") === "video",
  };
}

async function request(url, { signal, fetcher, limit = pageLimit, types, partial = false, headers }) {
  const response = await fetcher(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(3500)]),
    redirect: "error",
    cache: "no-store",
    headers,
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 429 || response.status >= 500) throw new Error("Metadata temporarily unavailable");
    return null;
  }
  const mediaType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!types.includes(mediaType) || !response.body ||
      (!partial && Number(response.headers.get("content-length")) > limit)) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const buffer = new Uint8Array(limit);
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) return { data: buffer.subarray(0, size), mediaType };
      const remaining = limit - size;
      if (!partial && value.length > remaining) return null;
      buffer.set(value.subarray(0, remaining), size);
      size += Math.min(value.length, remaining);
    }
    if (!partial && !(await reader.read()).done) return null;
    return { data: buffer, mediaType };
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function getJson(url, options) {
  const result = await request(url, { ...options, types: ["application/json", "text/json", "application/json+oembed"] });
  return result ? JSON.parse(new TextDecoder().decode(result.data)) : null;
}

const imageHosts = {
  youtube: /^(?:i|img)\.ytimg\.com$/i,
  tiktok: /(?:^|\.)(?:tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com)$/i,
  instagram: /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i,
  pinterest: /(?:^|\.)pinimg\.com$/i,
  x: /^pbs\.twimg\.com$/i,
};

export function safeThumbnail(platform, value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      imageHosts[platform]?.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

export async function fetchThumbnail(platform, value, options) {
  const url = safeThumbnail(platform, value);
  if (!url) return null;
  return request(url, { ...options, limit: imageLimit, types: ["image/jpeg", "image/png", "image/webp"] }).catch(() => null);
}

const genericTitle = /^(?:instagram|tiktok|youtube|pinterest|x|twitter|reels?|video|watch(?: this)?|log in|sign up|just a moment|something went wrong)(?:[ .!|–-]+(?:instagram|tiktok|youtube|pinterest|x|twitter|reels?|video))*[ .!]*$/iu;
const boilerplate = /^(?:see (?:instagram|photos|videos)|log in|sign up|create an account|watch .* on tiktok|we're sorry|javascript is not available|no description|\d[\d,.km]*\s+likes?\s*,\s*\d[\d,.km]*\s+comments?)\b/iu;

function sourceText(value, limit) {
  const text = cleanText(value, limit);
  return genericTitle.test(text) || boilerplate.test(text) ? "" : text;
}

export async function getVideoMetadata(reference, { signal = AbortSignal.timeout(12000), fetcher = fetch, youtubeKey } = {}) {
  const link = parseLink(reference.url);
  if (!link?.id || link.platform !== reference.platform || link.id !== reference.post_id || link.kind === "photo") {
    return { video: false };
  }

  const options = { signal, fetcher };
  const watchUrl = link.platform === "youtube" ? `https://www.youtube.com/watch?v=${link.id}` : null;
  const knownVideo = Boolean(watchUrl) || link.kind === "video" || ["reel", "tv"].includes(link.kind);
  let lookupFailed = false;

  async function attempt(read) {
    try {
      return await read();
    } catch {
      lookupFailed = true;
      return null;
    }
  }

  let preferred;
  if (watchUrl) {
    if (youtubeKey) {
      const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
      endpoint.search = new URLSearchParams({
        part: "snippet", id: link.id,
        fields: "items(snippet(title,description,thumbnails))",
      });
      const item = (await attempt(() => getJson(endpoint.href, {
        ...options, headers: { "x-goog-api-key": youtubeKey },
      })))?.items?.[0];
      if (item) {
        preferred = {
          title: item.snippet?.title,
          description: item.snippet?.description,
          thumbnail: item.snippet?.thumbnails?.medium?.url,
        };
      }
    }
    if (!preferred?.title) {
      const endpoint = new URL("https://www.youtube.com/oembed");
      endpoint.search = new URLSearchParams({ url: watchUrl, format: "json" });
      const embed = await attempt(() => getJson(endpoint.href, options));
      if (embed) preferred = { ...preferred, title: embed.title, thumbnail: embed.thumbnail_url };
    }
  } else if (link.platform === "tiktok") {
    const endpoint = new URL("https://www.tiktok.com/oembed");
    endpoint.searchParams.set("url", link.url);
    const embed = await attempt(() => getJson(endpoint.href, options));
    if (embed) preferred = { title: embed.title, description: embed.title, thumbnail: embed.thumbnail_url };
  }

  let page;
  if (!sourceText(preferred?.description, 1200)) {
    const html = await attempt(() => request(watchUrl || link.url, {
      ...options, types: ["text/html", "application/xhtml+xml"], partial: true,
      limit: link.platform === "pinterest" ? pinterestPageLimit : pageLimit,
    }));
    if (html) page = readPageMetadata(new TextDecoder().decode(html.data), link);
  }

  const title = sourceText(preferred?.title, 220) || sourceText(page?.title, 220);
  // TikTok's oEmbed title contains the creator's caption.
  const description = sourceText(preferred?.description, 1200) || sourceText(page?.description, 1200);
  const thumbnail = safeThumbnail(link.platform, preferred?.thumbnail) ||
    safeThumbnail(link.platform, page?.thumbnail);
  return {
    video: knownVideo || Boolean(page?.video),
    title,
    description: description === title ? "" : description,
    thumbnail,
    lookupFailed,
  };
}
