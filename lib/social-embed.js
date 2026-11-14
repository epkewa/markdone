import { parseLink } from "./references";

const widgets = {
  instagram: {
    script: "https://www.instagram.com/embed.js",
    render: (url) => `<blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14"></blockquote>`,
  },
  pinterest: {
    script: "https://assets.pinterest.com/js/pinit.js",
    render: (url) => `<a data-pin-do="embedPin" data-pin-width="large" href="${url}" target="_blank" rel="noopener noreferrer">Open on Pinterest</a>`,
  },
};

export function socialEmbed(url, headers = {}) {
  const link = parseLink(url);
  const widget = link?.id && widgets[link.platform];
  if (!widget) return new Response(null, { status: 404, headers });

  // The widget uses the canonical URL rebuilt by parseLink.
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Social post</title><style>body{margin:0;font:14px system-ui,sans-serif;text-align:center}blockquote{margin:1rem}iframe,img{max-width:100%}body>span{max-width:100%}</style><body>${widget.render(link.url)}<script async defer src="${widget.script}"></script></body></html>`, {
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "SAMEORIGIN" },
  });
}
