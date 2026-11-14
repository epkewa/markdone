import { parseLink } from "./references";

export function instagramEmbed(url, headers = {}) {
  const link = parseLink(url);
  if (!link?.id || link.platform !== "instagram") {
    return new Response(null, { status: 404, headers });
  }

  // The URL is rebuilt from validated host, path segments, and post ID.
  const markup = `<blockquote class="instagram-media" data-instgrm-permalink="${link.url}" data-instgrm-version="14"></blockquote>`;

  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Social post</title><style>body{margin:0;font:14px system-ui,sans-serif}blockquote{margin:1rem}iframe{max-width:100%}</style><body>${markup}<script async src="https://www.instagram.com/embed.js"></script></body></html>`, {
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "SAMEORIGIN" },
  });
}
