import test from "node:test";
import assert from "node:assert/strict";
import { parseLink, resolveLink } from "../lib/references.js";
import { demoReferences } from "../scripts/demo-data.mjs";

test("YouTube forms deduplicate by video ID", () => {
  const urls = [
    "https://www.youtube.com/watch?v=uiANvR_hsZY&list=1",
    "https://youtu.be/uiANvR_hsZY?si=tracking",
    "https://youtube.com/shorts/uiANvR_hsZY",
  ];
  assert.deepEqual(urls.map((url) => parseLink(url).id), Array(3).fill("uiANvR_hsZY"));
});

test("Instagram and X normalize tracking and alternate URL forms", () => {
  assert.deepEqual(parseLink("https://instagram.com/reels/DBTxkQnugon/?igsh=tracking"), {
    platform: "instagram", id: "DBTxkQnugon", kind: "reel", url: "https://www.instagram.com/reel/DBTxkQnugon/",
  });
  assert.equal(parseLink("https://mobile.twitter.com/NASA/status/1474724928360525827/video/1?s=20").url,
    "https://x.com/NASA/status/1474724928360525827");
});

test("rejects unsupported links and lookalike or credential-bearing hosts", () => {
  for (const url of [
    "https://www.youtube.com.evil.test/watch?v=uiANvR_hsZY",
    "https://evil.test@youtu.be/uiANvR_hsZY",
    "https://youtu.be:8443/uiANvR_hsZY",
    "javascript:alert(1)",
    "https://www.instagram.com/nasa/",
    "https://x.com/NASA/status/123/anything",
  ]) {
    assert.equal(parseLink(url), null, url);
  }
});

test("follows provider short links and keeps an unresolved link if redirected elsewhere", async () => {
  const url = "https://vm.tiktok.com/ZShort/";
  const calls = [];
  const resolved = await resolveLink(url, async (visited, options) => {
    calls.push(visited);
    assert.equal(options.redirect, "manual");
    return Response.redirect(calls.length === 1 ? "https://www.tiktok.com/t/ZShort/" : demoReferences[2].url, 302);
  });
  assert.equal(resolved.id, "6718335390845095173");
  assert.equal(calls.length, 2);

  const blocked = await resolveLink(url, async (visited) => {
    assert.equal(visited, url);
    return Response.redirect("https://example.com/", 302);
  });
  assert.equal(blocked.url, url);
  assert.equal(blocked.id, null);
});

test("caps redirect attempts and handles provider failures", async () => {
  const original = "https://www.instagram.com/share/reel/Abc";
  let attempts = 0;
  const result = await resolveLink(original, async () => {
    attempts++;
    return Response.redirect(original, 302);
  });
  assert.equal(attempts, 4);
  assert.equal(result.id, null);
  assert.equal((await resolveLink(original, async () => { throw new Error("Timeout"); })).url, original);
});

test("the demo seeds an embeddable URL form for each provider", () => {
  const links = demoReferences.map(({ url }) => parseLink(url));
  assert.deepEqual(links.map(({ platform }) => platform), ["youtube", "instagram", "tiktok", "x"]);
  assert.ok(links.every(({ id }) => id));
});
