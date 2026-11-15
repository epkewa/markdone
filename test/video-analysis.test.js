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
let db, original, legacy;

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
    claim_reference_analysis: "select claim_reference_analysis($1,$2,$3) as result",
    finish_reference_analysis: "select finish_reference_analysis($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) as result",
  };
  return {
    async rpc(name, params) {
      const args = name === "claim_reference_analysis"
        ? [params.p_reference_id, params.p_explicit, params.p_refresh_legacy ?? false]
        : [params.p_reference_id, params.p_token, params.p_status, params.p_playbook ?? null, params.p_title ?? null,
          params.p_summary ?? null, params.p_source ?? null, params.p_folder_id ?? null, params.p_folder_name ?? null];
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
  playbook: null,
  folderIndex: -1,
  newFolder: "Motion Design",
};
const whipPan = {
  ...modelResult,
  title: "Whip-pan Match Cut",
  summary: "A fast pan hides a change from an interior to an exterior shot.",
  playbook: {
    startSeconds: 5.75,
    endSeconds: 6.5,
    observation: "The doorway and the railing sweep left through the frame on either side of the cut.",
    materials: ["Two clips with rightward pans"],
    steps: [
      { title: "Find the matching pans", action: "Scrub both clips and mark the first frame with strong leftward streaks." },
      { title: "Cut inside the blur", action: "Trim the outgoing clip to end on its streak and align the incoming clip’s streak on V1." },
      { title: "Check the join", action: "Play across the edit. Use the Rolling Edit tool to shift the cut if a sharp frame flashes." },
    ],
  },
};

const response = (value) => Response.json(value);
const html = (value) => new Response(value, { headers: { "Content-Type": "text/html" } });

function youtube({ title = "Typography transitions in a product launch",
  description = "A practical example of staggered typography in a product launch campaign.",
  duration, privacyStatus = "public", liveBroadcastContent = "none", thumbnail } = {}) {
  return async (url) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.hostname, "www.googleapis.com");
    assert.equal(endpoint.searchParams.get("part"), "snippet,contentDetails,status");
    return response({ items: [{
      snippet: { title, description, liveBroadcastContent, thumbnails: { medium: { url: thumbnail } } },
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
    select r.title, r.ai_summary, r.ai_steps, r.ai_playbook, r.ai_version, r.ai_source, r.ai_status,
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
    if (filename.endsWith("_reference_recreation_playbooks.sql")) {
      legacy = await save(owner, watch("oldresult01"));
      const [claim] = await asAccount(owner, "select claim_reference_analysis($1, false) as data", [legacy]);
      await asAccount(owner, `
        select finish_reference_analysis($1, $2, 'ready', 'Old title'::text,
          'Old summary', array['An old tip'], 'metadata', null, 'Legacy folder')
      `, [legacy, claim.data.token]);
    }
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
    title: modelResult.title, ai_summary: modelResult.summary, ai_steps: [], ai_playbook: null, ai_version: 1,
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

test("an empty YouTube post is saved without spending a model call", async () => {
  const row = await save(owner, watch("sparsevid01"));
  let calls = 0;
  const status = await analyze(row, {
    fetcher: (url) => new URL(url).hostname === "www.googleapis.com"
      ? youtube({ title: "YouTube", description: "" })(url)
      : html("<head></head>"),
    generate: async () => { calls++; return modelResult; },
  });
  assert.equal(status, "unavailable");
  assert.equal(calls, 0);
  assert.equal((await read(owner, row)).ai_source, null);
  assert.equal(await analyze(row), "unchanged");
  assert.equal(await analyze(row, { explicit: true }), "ready");
});

test("an older Pin can be rechecked when its public metadata starts identifying a video", async () => {
  const id = await save(owner, "https://www.pinterest.com/pin/88421/");
  await db.query("update saved_references set ai_status = 'not_video' where id = $1", [id]);
  const options = {
    fetcher: async () => html('<head><meta property="og:type" content="video.other"><meta property="og:title" content="Typography for a launch campaign"></head>'),
  };
  assert.equal(await analyze(id, options), "unchanged");
  assert.equal(await analyze(id, { ...options, explicit: true }, other), "unchanged");
  assert.equal(await analyze(id, { ...options, explicit: true }), "ready");
  assert.equal((await read(owner, id)).ai_summary, modelResult.summary);
  assert.equal(await analyze(id, { ...options, explicit: true }), "unchanged");
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
  const instagram = { url: "https://www.instagram.com/p/abc/", platform: "instagram", post_id: "abc" };
  const imagePost = await getVideoMetadata(instagram, { ...options, fetcher: async () => html(
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

test("Pinterest video metadata can appear late and must match the requested or canonical Pin", async () => {
  const link = { url: "https://www.pinterest.com/pin/123/", platform: "pinterest", post_id: "123" };
  const canonical = "https://www.pinterest.com/pin/456/";
  const unrelated = '<script type="application/ld+json">{"@type":"VideoObject","@id":"https://www.pinterest.com/pin/789/","name":"Other video"}</script>';
  const head = "<head></head><body>";
  const padding = " ".repeat(1200 * 1024);
  const video = `<meta property="og:url" content="${canonical}"><script type="application/ld+json">{"@type":"VideoObject","@id":"${canonical}","name":"Motion design","thumbnailUrl":["https://i.pinimg.com/motion.jpg"]}</script>`;
  const get = (body) => getVideoMetadata(link, { fetcher: async () => html(head + padding + body) });
  assert.equal((await get(unrelated)).video, false);
  const result = await get(unrelated + video);
  assert.equal(result.video, true);
  assert.equal(result.title, "Motion design");
  assert.equal(result.thumbnail, "https://i.pinimg.com/motion.jpg");
});

function geminiResponse(result) {
  return response({
    status: "completed",
    steps: [
      { type: "thought" },
      { type: "model_output", content: [{ type: "text", text: JSON.stringify(result) }] },
    ],
  });
}

test("Gemini receives a thumbnail and a bounded structured request", async () => {
  const result = await generateVideoAnalysis({
    title: "Typography transitions", platform: "youtube", folders: [],
    thumbnail: { data: Uint8Array.of(255, 216, 255), mediaType: "image/jpeg" },
  }, {
    apiKey: "stub",
    signal: AbortSignal.timeout(5000),
    fetcher: async (endpoint, request) => {
      assert.equal(new URL(endpoint).hostname, "generativelanguage.googleapis.com");
      assert.equal(new URL(endpoint).pathname, "/v1beta/interactions");
      assert.equal(new Headers(request.headers).get("x-goog-api-key"), "stub");
      const body = JSON.parse(request.body);
      assert.equal(body.model, "gemini-3.5-flash-lite");
      assert.deepEqual(body.input[1], { type: "image", mime_type: "image/jpeg", data: "/9j/" });
      assert.equal(body.response_format.mime_type, "application/json");
      assert.deepEqual(body.generation_config, {
        thinking_level: "minimal", max_output_tokens: 1000,
      });
      assert.equal(body.store, false);
      return geminiResponse(modelResult);
    },
  });
  assert.deepEqual(result, modelResult);
});

test("a public Short uses one Gemini video request and persists a grounded playbook", async () => {
  const id = await save(owner, "https://www.youtube.com/shorts/whipPan0001?si=example");
  const getMetadata = youtube({ duration: "PT3M" });
  let requests = 0;
  const fetcher = async (url, request) => {
    if (new URL(url).hostname === "www.googleapis.com") return getMetadata(url);
    requests++;
    // The mock title and description mention typography, but the video is a whip-pan.
    const body = JSON.parse(request.body);
    assert.equal(JSON.parse(body.input[0].text).durationSeconds, 180);
    assert.equal(body.input.length, 2);
    assert.deepEqual(body.input[1], {
      type: "video", uri: watch("whipPan0001"),
      resolution: "low", processing: { type: "static", fps: 4 },
    });
    return geminiResponse(whipPan);
  };
  const options = { fetcher, generate: generateVideoAnalysis };
  assert.equal(await analyze(id, options), "ready");
  const stored = await read(owner, id);
  assert.equal(stored.title, whipPan.title);
  assert.equal(stored.ai_source, "video");
  assert.equal(stored.ai_version, 1);
  assert.deepEqual(stored.ai_playbook, whipPan.playbook);
  assert.equal(await analyze(await save(owner, watch("whipPan0001")), options), "unchanged");
  assert.equal(requests, 1);
});

test("YouTube video input requires verified public, non-live content at most three minutes long", async () => {
  const link = { platform: "youtube", url: watch("eligibility"), post_id: "eligibility" };
  for (const [metadata, durationSeconds] of [
    [{ duration: "PT9S" }, 9],
    [{ duration: "PT2M60S" }, 180],
    [{ duration: "PT3M1S" }, null],
    [{ duration: "PT1H" }, null],
    [{ duration: "PT0S" }, null],
    [{ duration: "00:02:00" }, null],
    [{ duration: "PT15S", privacyStatus: "unlisted" }, null],
    [{ duration: "PT15S", privacyStatus: "private" }, null],
    [{ duration: "PT15S", liveBroadcastContent: "upcoming" }, null],
    [{ duration: "PT15S", liveBroadcastContent: "live" }, null],
    [{}, null],
  ]) {
    const result = await getVideoMetadata(link, { youtubeKey: "stub", fetcher: youtube(metadata) });
    assert.deepEqual(result.videoInput, durationSeconds ? { url: link.url, durationSeconds } : null);
    assert.ok(result.description);
  }
});

test("metadata-only analysis cannot save a playbook or claim video as its source", async () => {
  const id = await save(owner, watch("longvideo01"));
  assert.equal(await analyze(id, {
    fetcher: youtube({ duration: "PT10M" }),
    generate: async ({ videoInput }) => { assert.equal(videoInput, null); return whipPan; },
  }), "ready");
  const stored = await read(owner, id);
  assert.equal(stored.ai_source, "metadata");
  assert.equal(stored.ai_playbook, null);
});

test("video summaries survive incomplete, out-of-bounds, or omitted playbooks", async () => {
  for (const [id, playbook] of [
    ["badtime0001", { ...whipPan.playbook, endSeconds: 12 }],
    ["badsteps001", { ...whipPan.playbook, steps: whipPan.playbook.steps.slice(0, 2) }],
    ["nodetail001", null],
  ]) {
    const reference = await save(owner, watch(id));
    assert.equal(await analyze(reference, {
      fetcher: youtube({ duration: "PT10S" }),
      generate: async () => ({ ...whipPan, playbook }),
    }), "ready");
    const stored = await read(owner, reference);
    assert.equal(stored.ai_source, "video");
    assert.equal(stored.ai_summary, whipPan.summary);
    assert.equal(stored.ai_playbook, null);
  }
});

test("a rejected YouTube clip uses post details without a second paid request", async () => {
  const id = await save(owner, watch("noaccess001"));
  const description = "A short preview from a typography campaign.";
  const getMetadata = youtube({ duration: "PT15S", description });
  let requests = 0;
  const fetcher = async (url) => {
    if (new URL(url).hostname === "www.googleapis.com") return getMetadata(url);
    requests++;
    return Response.json({ error: { message: "Unable to fetch the YouTube video" } }, { status: 400 });
  };
  assert.equal(await analyze(id, { fetcher, generate: generateVideoAnalysis }), "ready");
  const stored = await read(owner, id);
  assert.equal(stored.ai_summary, description);
  assert.equal(stored.ai_source, "metadata");
  assert.equal(stored.ai_playbook, null);
  assert.equal(requests, 1);
});

test("when Gemini abstains, credible post details still give a new reference a summary", async () => {
  const id = await save(owner, watch("abstained01"));
  const title = "Speed ramp with Time Remapping";
  const description = "A Premiere Pro tutorial on changing playback speed with keyframes.";
  assert.equal(await analyze(id, {
    fetcher: youtube({ title, description }),
    generate: async () => ({ sufficient: false }),
  }), "ready");
  const stored = await read(owner, id);
  assert.equal(stored.title, title);
  assert.equal(stored.ai_summary, description);
  assert.equal(stored.ai_source, "metadata");
  assert.equal(stored.ai_playbook, null);
});

test("legacy analysis remains visible during refresh and survives a failed update", async () => {
  const previous = await read(owner, legacy);
  assert.equal(previous.ai_version, 0);
  assert.deepEqual(previous.ai_steps, ["An old tip"]);
  assert.equal(await analyze(legacy, { explicit: true }), "unchanged");

  assert.equal(await analyze(legacy, {
    explicit: true, refreshLegacy: true,
    generate: async () => {
      assert.deepEqual(await read(owner, legacy), { ...previous, ai_status: "processing" });
      throw new Error("Model timeout");
    },
  }), "refresh_failed");
  assert.deepEqual(await read(owner, legacy), previous);

  const upgrade = { explicit: true, refreshLegacy: true };
  assert.equal(await analyze(legacy, {
    ...upgrade, generate: async () => ({ sufficient: false }),
  }), "refresh_unavailable");
  assert.deepEqual(await read(owner, legacy), previous);
  assert.equal(await analyze(legacy, upgrade, other), "unchanged");
  assert.equal(await analyze(legacy, upgrade), "ready");
  const updated = await read(owner, legacy);
  assert.equal(updated.ai_version, 1);
  assert.equal(updated.ai_summary, modelResult.summary);
  assert.deepEqual(updated.folders, previous.folders);
  assert.deepEqual(updated.ai_steps, []);
  assert.equal(await analyze(legacy, upgrade), "unchanged");
});
