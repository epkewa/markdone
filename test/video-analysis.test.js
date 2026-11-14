import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseLink } from "../lib/references.js";
import { getVideoMetadata, safeThumbnail } from "../lib/video-analysis/metadata.js";
import { generateVideoAnalysis } from "../lib/video-analysis/model.js";
import { analyzeSavedVideo } from "../lib/video-analysis/service.js";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
let db, original;

async function asAccount(account, sql, args = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [account]);
    return (await tx.query(sql, args)).rows;
  });
}

async function save(account, url, folders = [], share = null) {
  const link = parseLink(url);
  const [row] = await asAccount(account, "select save_reference($1,$2,$3,$4,$5,$6) as id", [
    link.platform, link.id, link.kind, link.url, folders, share,
  ]);
  return row.id;
}

function clientFor(account) {
  const calls = {
    claim_reference_analysis: "select claim_reference_analysis($1,$2) as result",
    finish_reference_analysis: "select finish_reference_analysis($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",
  };
  return {
    async rpc(name, params) {
      const args = name === "claim_reference_analysis"
        ? [params.p_reference_id, params.p_explicit]
        : [params.p_reference_id, params.p_token, params.p_status, params.p_title ?? null, params.p_summary ?? null,
          params.p_steps ?? [], params.p_source ?? null, params.p_folder_id ?? null, params.p_folder_name ?? null];
      try {
        const [row] = await asAccount(account, calls[name], args);
        return { data: row.result };
      } catch (error) {
        return { error };
      }
    },
    from(table) {
      assert.equal(table, "folders");
      return {
        select() { return this; },
        eq(column, value) { assert.equal(column, "owner_id"); assert.equal(value, account); return this; },
        order() { return this; },
        limit() { return this; },
        async abortSignal() {
          return { data: await asAccount(account, "select id,name from folders order by name,id limit 100") };
        },
      };
    },
  };
}

const watch = (id) => `https://www.youtube.com/watch?v=${id}`;
const modelResult = {
  sufficient: true,
  title: "Animating a product launch",
  summary: "A product launch campaign uses staggered typography for emphasis.",
  steps: ["Stagger the headline and the call to action."],
  folderIndex: -1,
  newFolder: "Motion Design",
};

const response = (value) => Response.json(value);
const html = (value) => new Response(value, { headers: { "Content-Type": "text/html" } });

function youtube({ duration = "PT45S", privacyStatus = "public", title = "Typography transitions in a product launch",
  description = "A practical example of staggered typography in a product launch campaign." } = {}) {
  return async (url) => {
    assert.equal(new URL(url).hostname, "www.googleapis.com");
    return response({ items: [{
      snippet: { title, description },
      contentDetails: { duration },
      status: { privacyStatus },
    }] });
  };
}

function analyze(id, options = {}, account = owner) {
  return analyzeSavedVideo(clientFor(account), account, id, {
    apiKey: "stub", youtubeKey: "stub", fetcher: youtube(), generate: async () => modelResult, ...options,
  });
}

async function read(account, id) {
  const [row] = await asAccount(account, `
    select r.title, r.ai_summary, r.ai_steps, r.ai_source, r.ai_status,
      array(select f.name from folder_references m join folders f on f.id = m.folder_id
        where m.reference_id = r.id order by f.name) as folders
    from saved_references r where r.id = $1
  `, [id]);
  return row;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $func$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $func$;
    grant usage on schema auth to authenticated, anon, service_role;
    insert into auth.users values ('${owner}'), ('${other}');
  `);
  for (const filename of (await readdir(migrations)).sort()) {
    if (filename.endsWith("_reference_video_analysis.sql")) original = await save(owner, watch("original001"));
    await db.exec(await readFile(new URL(filename, migrations), "utf8"));
  }
});

after(async () => { await db?.close(); });

test("existing videos are opt-in; explicit analysis saves a result and reloads only read it", async () => {
  let count = 0;
  const options = { generate: async () => { count++; return modelResult; } };
  assert.equal((await read(owner, original)).ai_status, "unrequested");
  assert.equal(await analyze(original, options), "unchanged");
  assert.equal(await analyze(original, { ...options, explicit: true }), "ready");
  const reloaded = await read(owner, original);
  assert.deepEqual(reloaded, {
    title: modelResult.title, ai_summary: modelResult.summary, ai_steps: modelResult.steps,
    ai_status: "ready", ai_source: "metadata", folders: ["Motion Design"],
  });
  assert.deepEqual(await read(owner, original), reloaded);
  assert.equal(await analyze(original, { ...options, explicit: true }), "unchanged");
  assert.equal(count, 1);
});

test("concurrent duplicate saves claim one model call and reuse a case-insensitive topic", async () => {
  const [id, duplicate] = await Promise.all([
    save(owner, watch("duplicates1")), save(owner, "https://youtu.be/duplicates1"),
  ]);
  assert.equal(id, duplicate);
  let count = 0;
  const options = { generate: async () => { count++; return { ...modelResult, newFolder: "motion design" }; } };
  const result = await Promise.all([analyze(id, options), analyze(duplicate, options)]);
  assert.deepEqual(result.sort(), ["ready", "unchanged"]);
  assert.equal(count, 1);
  assert.deepEqual((await read(owner, id)).folders, ["Motion Design"]);
  assert.deepEqual(await asAccount(owner, "select name from folders where lower(name) = 'motion design'"), [{ name: "Motion Design" }]);
});

test("manual selections and edits during analysis take precedence over model classification", async () => {
  const [manual] = await asAccount(owner, "insert into folders(name) values ('My picks') returning id");
  const id = await save(owner, watch("manualpick1"), [manual.id]);
  assert.equal(await analyze(id, { generate: async (input) => {
    assert.equal(input.folders, null);
    return modelResult;
  } }), "ready");
  assert.deepEqual((await read(owner, id)).folders, ["My picks"]);

  const edited = await save(owner, watch("manualedit1"));
  assert.equal(await analyze(edited, { generate: async ({ folders }) => {
    await asAccount(owner, "select set_reference_folders($1, '{}')", [edited]);
    return { ...modelResult, folderIndex: folders.findIndex(({ name }) => name === "Motion Design") };
  } }), "ready");
  assert.deepEqual((await read(owner, edited)).folders, []);
});

test("another account cannot read, claim, or finalize someone else's analysis", async () => {
  const id = await save(owner, watch("isolation01"));
  assert.equal(await read(other, id), undefined);
  assert.equal(await analyze(id, { explicit: true }, other), "unchanged");
  const { data: claim } = await clientFor(owner).rpc("claim_reference_analysis", { p_reference_id: id, p_explicit: false });
  const { data } = await clientFor(other).rpc("finish_reference_analysis", {
    p_reference_id: id, p_token: claim.token, p_status: "failed",
  });
  assert.equal(data, false);
  assert.equal((await read(owner, id)).ai_status, "processing");
});

test("expired claims can be reclaimed only explicitly and stale workers cannot finalize", async () => {
  const id = await save(owner, watch("expiredjob1"));
  const { data: claim } = await clientFor(owner).rpc("claim_reference_analysis", { p_reference_id: id, p_explicit: false });
  await db.query("update saved_references set ai_claim_until = now() - interval '1 second' where id = $1", [id]);
  assert.equal(await analyze(id), "unchanged");
  assert.equal(await analyze(id, { explicit: true, generate: async ({ folders }) => {
    const { data } = await clientFor(owner).rpc("finish_reference_analysis", {
      p_reference_id: id, p_token: claim.token, p_status: "failed",
    });
    assert.equal(data, false);
    return { ...modelResult, folderIndex: folders.findIndex(({ name }) => name === "Motion Design"), newFolder: "" };
  } }), "ready");
  assert.deepEqual((await read(owner, id)).folders, ["Motion Design"]);
});

test("provider failures preserve the link and require an explicit retry", async () => {
  const id = await save(owner, watch("retrymodel1"));
  assert.equal(await analyze(id, { apiKey: "" }), "disabled");
  assert.equal((await read(owner, id)).ai_status, "pending");
  assert.equal(await analyze(id, { generate: async () => { throw new Error("Provider unavailable"); } }), "failed");
  assert.equal((await read(owner, id)).title, null);
  assert.equal(await analyze(id), "unchanged");
  assert.equal(await analyze(id, { explicit: true }), "ready");
});

test("sparse YouTube metadata permits only verified short public video fallback", async () => {
  for (const [id, duration, privacyStatus, expected] of [
    ["shortvideo1", "PT1M", "public", "video"],
    ["longvideo01", "PT1M1S", "public", "unavailable"],
    ["hiddenclip1", "PT30S", "unlisted", "unavailable"],
    ["unknownvid1", "live", "public", "unavailable"],
  ]) {
    const row = await save(owner, watch(id));
    const status = await analyze(row, {
      fetcher: (url) => new URL(url).hostname === "www.googleapis.com"
        ? youtube({ duration, privacyStatus, title: "YouTube", description: "" })(url)
        : html("<head></head>"),
      generate: async (input) => {
        assert.equal(expected, "video");
        assert.equal(input.source, "video");
        assert.equal(input.videoUrl, watch(id));
        return modelResult;
      },
    });
    assert.equal(status, expected === "video" ? "ready" : "unavailable");
    const saved = await read(owner, row);
    assert.equal(saved.ai_source, expected === "video" ? "video" : null);
  }
});

test("a resolved share carries manual folders into analysis", async () => {
  const [folder] = await asAccount(owner, "select id from folders where name = 'My picks'");
  const share = await save(owner, "https://vm.tiktok.com/example/", [folder.id]);
  const id = await save(owner, "https://www.tiktok.com/@creator/video/123", [], share);
  assert.equal(await read(owner, share), undefined);
  assert.equal(await analyze(id, {
    fetcher: async (url) => {
      assert.equal(new URL(url).pathname, "/oembed");
      return response({ title: "How to stagger typography for a launch campaign" });
    },
    generate: async ({ folders }) => { assert.equal(folders, null); return modelResult; },
  }), "ready");
  assert.deepEqual((await read(owner, id)).folders, ["My picks"]);
});

test("metadata only treats generic posts as video with evidence, and cannot redirect thumbnail fetches", async () => {
  const link = { url: "https://www.pinterest.com/pin/123/", platform: "pinterest", post_id: "123" };
  const options = { signal: AbortSignal.timeout(5000) };
  const imagePost = await getVideoMetadata(link, { ...options, fetcher: async () => html(
    '<head><meta property="og:title" content="Shapes &amp; lines"></head><body><meta property="og:video" content="ignored"></body>',
  ) });
  assert.equal(imagePost.video, false);
  assert.equal(imagePost.title, "Shapes & lines");
  const video = await getVideoMetadata(link, { ...options, fetcher: async (url, request) => {
    assert.equal(url, link.url);
    assert.equal(request.redirect, "error");
    return html('<head><meta property="og:video" content="https://example.com/video.mp4"><meta property="og:image" content="https://i.pinimg.com.evil.example/thumb.jpg"></head>');
  } });
  assert.equal(video.video, true);
  assert.equal(video.thumbnail, null);
  assert.equal(safeThumbnail("pinterest", "https://i.pinimg.com/a.jpg"), "https://i.pinimg.com/a.jpg");
});

test("Gemini receives the canonical YouTube URL and a bounded structured request", async () => {
  const url = watch("shortvideo1");
  const result = await generateVideoAnalysis({ source: "video", videoUrl: url, platform: "youtube", folders: [] }, {
    apiKey: "stub",
    signal: AbortSignal.timeout(5000),
    fetcher: async (endpoint, request) => {
      assert.match(endpoint, /\/models\/gemini-3\.5-flash-lite:generateContent$/);
      const body = JSON.parse(request.body);
      assert.deepEqual(body.contents[0].parts[0].fileData, { mimeType: "video/mp4", fileUri: url });
      assert.equal(body.generationConfig.mediaResolution, "MEDIA_RESOLUTION_LOW");
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.ok(body.generationConfig.maxOutputTokens < 1000);
      return response({
        candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(modelResult) }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 50, totalTokenCount: 850 },
      });
    },
  });
  assert.deepEqual(result, modelResult);
});
