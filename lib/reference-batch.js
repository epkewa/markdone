import { parseLink, referenceSources } from "./references.js";

export function parseReferenceBatch(input) {
  const seen = new Set();
  const entries = [];
  for (const url of input.split(/,\s*(?=https?:\/\/)|\s+/i)) {
    if (!url || /^,+$/.test(url)) continue;
    const link = parseLink(url);
    if (link) {
      const key = `${link.platform}:${link.id ?? link.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    entries.push({ url, link });
  }
  return entries;
}

export async function saveReferenceBatch(entries, save, onProgress) {
  const failed = [];
  for (const [index, { url, link }] of entries.entries()) {
    let error;
    if (link) {
      try {
        const result = await save(url);
        if (!result?.ok) error = result?.error || "The link couldn’t be saved. Try again.";
      } catch {
        error = "The link couldn’t be saved. Try again.";
      }
    } else {
      error = `Use a link to a post from ${referenceSources}.`;
    }
    if (error) failed.push({ url, error });
    onProgress(index + 1);
  }
  return failed;
}
