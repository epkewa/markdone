export const platforms = {
  youtube: { name: "YouTube", format: "Video" },
  instagram: { name: "Instagram", format: "Post" },
  tiktok: { name: "TikTok", format: "Video" },
  x: { name: "X", format: "Post" },
  pinterest: { name: "Pinterest", format: "Pin" },
};

export const referenceSources = "YouTube, Instagram, TikTok, X, or Pinterest";

const hosts = {
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
  instagram: ["instagram.com", "www.instagram.com"],
  tiktok: ["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  pinterest: [
    "pinterest.com", "www.pinterest.com", "pin.it",
    "au.pinterest.com", "br.pinterest.com", "ca.pinterest.com", "de.pinterest.com",
    "es.pinterest.com", "fr.pinterest.com", "in.pinterest.com", "it.pinterest.com",
    "jp.pinterest.com", "mx.pinterest.com", "nl.pinterest.com", "uk.pinterest.com",
  ],
  x: ["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"],
};

function readUrl(input) {
  if (typeof input !== "string" || input.length > 2048) return null;
  try {
    const url = new URL(input.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    url.protocol = "https:";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function parseLink(input) {
  const url = readUrl(input);
  if (!url) return null;
  const platform = Object.keys(hosts).find((name) => hosts[name].includes(url.hostname));
  if (!platform) return null;
  const path = url.pathname.replace(/\/$/, "");

  if (platform === "youtube") {
    const id = url.hostname === "youtu.be"
      ? path.slice(1)
      : path === "/watch" ? url.searchParams.get("v") : path.match(/^\/(?:shorts|live|embed)\/([^/]+)$/)?.[1];
    if (id && /^[\w-]{11}$/.test(id)) {
      const kind = path.startsWith("/shorts/") ? "shorts" : "video";
      const canonical = kind === "shorts" ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
      return { platform, id, kind, url: canonical };
    }
  }

  if (platform === "instagram") {
    const match = path.match(/^\/(p|reel|reels|tv)\/([\w-]{1,64})$/);
    if (match) {
      const kind = match[1] === "reels" ? "reel" : match[1];
      return { platform, id: match[2], kind, url: `https://www.instagram.com/${kind}/${match[2]}/` };
    }
    if (/^\/share\/(?:reel\/|p\/)?[\w-]+$/.test(path)) {
      return { platform, id: null, kind: "share", url: `https://www.instagram.com${path}` };
    }
  }

  if (platform === "tiktok") {
    const match = path.match(/^\/@([\w.]{1,24})\/(video|photo)\/(\d{1,24})$/);
    if (match) {
      return { platform, id: match[3], kind: match[2], url: `https://www.tiktok.com${path}` };
    }
    const isShortHost = ["vm.tiktok.com", "vt.tiktok.com"].includes(url.hostname);
    if ((isShortHost && /^\/[\w-]+$/.test(path)) || (!isShortHost && /^\/t\/[\w-]+$/.test(path))) {
      return { platform, id: null, kind: "share", url: `https://${isShortHost ? url.hostname : "www.tiktok.com"}${path}/` };
    }
  }

  if (platform === "pinterest") {
    if (url.hostname === "pin.it") {
      return /^\/[a-zA-Z0-9]{1,64}$/.test(path)
        ? { platform, id: null, kind: "share", url: `https://pin.it${path}` }
        : null;
    }
    const id = path.match(/^\/pin\/(?:[a-z0-9-]+--)?(\d{1,24})$/i)?.[1];
    if (id) return { platform, id, kind: "pin", url: `https://www.pinterest.com/pin/${id}/` };
  }

  if (platform === "x") {
    const match = path.match(/^\/(?:([\w]{1,15})|i\/web)\/status\/(\d{1,24})(?:\/(?:video|photo)\/\d+)?$/);
    if (match) {
      return { platform, id: match[2], kind: "post", url: `https://x.com/${match[1] ?? "i/web"}/status/${match[2]}` };
    }
  }

  return null;
}

export async function resolveLink(input, fetcher = fetch) {
  const original = parseLink(input);
  if (!original || original.id) return original;
  let current = original.url;
  const signal = AbortSignal.timeout(3000);

  try {
    for (let hop = 0; hop < 4; hop++) {
      const response = await fetcher(current, { redirect: "manual", cache: "no-store", signal });
      await response.body?.cancel();
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) break;
      const next = readUrl(new URL(location, current).href);
      if (!next || !hosts[original.platform].includes(next.hostname)) break;
      const parsed = parseLink(next.href);
      if (parsed?.id) return parsed;
      if (original.platform === "pinterest" && !parsed) break;
      current = next.href;
    }
  } catch {
    // Keep the original share link when the provider cannot resolve it.
  }

  return original;
}

export function formatName(reference) {
  const formats = { reel: "Reel", shorts: "Short", photo: "Photo post", share: "Link" };
  if (Object.hasOwn(formats, reference.kind)) return formats[reference.kind];
  return platforms[reference.platform].format;
}

export function referenceTitle(reference) {
  return reference.title || `${platforms[reference.platform].name} ${formatName(reference).toLowerCase()}`;
}

export function thumbnail(reference) {
  if (reference.platform === "youtube" && /^[\w-]{11}$/.test(reference.post_id ?? "")) {
    return `https://i.ytimg.com/vi/${reference.post_id}/hqdefault.jpg`;
  }
  return null;
}
