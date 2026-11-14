"use server";

import { parseLink, resolveLink } from "../../lib/references";

export async function resolveDemoPin(url) {
  const link = parseLink(url);
  if (link?.platform !== "pinterest" || link.kind !== "share") return null;
  return resolveLink(link.url);
}
