import test from "node:test";
import assert from "node:assert/strict";
import { parseLink, resolveLink } from "../lib/references.js";

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
    return Response.redirect(calls.length === 1 ? "https://www.tiktok.com/t/ZShort/" : "https://www.tiktok.com/@scout2015/video/6718335390845095173", 302);
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

test("Pinterest Pin URLs normalize to one canonical identity", () => {
  const url = "https://www.pinterest.com/pin/256283035028156290/";
  const expected = { platform: "pinterest", id: "256283035028156290", kind: "pin", url };
  assert.deepEqual(parseLink(url), expected);
  assert.deepEqual(parseLink("https://uk.pinterest.com/pin/concrete-and-oak--256283035028156290/?utm_source=copy"), expected);
  assert.equal(parseLink("https://www.pinterest.com/example/design-board/"), null);
  assert.equal(parseLink("https://pin.it.example/AbC12"), null);
});

test("Pinterest share URLs resolve only to accepted Pinterest destinations", async () => {
  const short = "https://pin.it/AbC12";
  const pin = "https://www.pinterest.com/pin/256283035028156290/";
  const resolved = await resolveLink(short + "?tracking=1", async (url) => {
    assert.equal(url, short);
    return Response.redirect(pin, 302);
  });
  assert.equal(resolved.url, pin);
  const unresolved = await resolveLink(short, async (url) => {
    assert.equal(url, short);
    return Response.redirect("https://www.pinterest.com/example/design-board/", 302);
  });
  assert.equal(unresolved.kind, "share");
  assert.equal(unresolved.url, short);

  const redirect = "https://api.pinterest.com/url_shortener/AbC12/redirect/";
  const viaApi = await resolveLink(short, async (url) => {
    if (url === short) return Response.redirect(redirect, 308);
    assert.equal(url, redirect);
    return Response.redirect(pin + "sent/?sender=123", 302);
  });
  assert.equal(viaApi.url, pin);

  let requests = 0;
  const unrelated = await resolveLink(short, async () => {
    requests++;
    return Response.redirect("https://api.pinterest.com/url_shortener/Other/redirect/", 308);
  });
  assert.equal(requests, 1);
  assert.equal(unrelated.url, short);
});
