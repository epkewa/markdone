import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parsePlanRequest, sendVideoPlan } from "../lib/video-planner/service.js";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const owner = randomUUID();
const other = randomUUID();
let db, montage, privateMatch, summaryOnly;

async function query(account, sql, args = [], role = "authenticated") {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [account]);
    return (await tx.query(sql, args)).rows;
  });
}

const book = {
  startSeconds: 5.5,
  endSeconds: 8,
  observation: "The subject changes on each drum beat in a montage.",
  materials: ["Three close-ups", "Music bed"],
  steps: [
    { title: "Mark beats", action: "Place a marker on each heavy kick." },
    { title: "Trim shots", action: "Use the markers to line up every cut." },
    { title: "Check it", action: "Listen for a cut ahead of a beat." },
  ],
};

async function addReference(account, postId, title, summary, playbook) {
  const [{ id }] = await query(account, `insert into public.saved_references
    (platform, post_id, kind, url, title, ai_summary, ai_playbook, ai_status, ai_source, ai_version)
    values ('youtube', $1, 'shorts', $2, $3, $4, $5, 'ready', $6, 1) returning id`,
  [postId, `https://www.youtube.com/shorts/${postId}`, title, summary, playbook, playbook ? "video" : "metadata"]);
  return id;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $fn$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $fn$;
    grant usage on schema auth to authenticated, anon, service_role;
  `);
  await db.query("insert into auth.users values ($1), ($2)", [owner, other]);
  for (const filename of (await readdir(migrations)).sort()) {
    await db.exec(await readFile(new URL(filename, migrations), "utf8"));
  }
  montage = await addReference(owner, "coffee00001", "Beat-synced coffee preparation", "A slow coffee making routine.", book);
  summaryOnly = await addReference(owner, "gymmeta0001", "Gym montage", "Training and beat cuts.", null);
  privateMatch = await addReference(other, "gymother001", "Gym montage", "Training and beat cuts.", book);
  await addReference(owner, "typing00001", "Typography reveal", "A centered title fades in.", {
    ...book, observation: "The letters fade in with a stagger.",
    materials: ["Type layer"],
    steps: book.steps.map((step) => ({ ...step, action: "Render the titles." })),
  });
});

after(async () => db?.close());

const search = (account, terms) => query(account, "select * from public.search_video_playbooks($1)", [terms]);

async function append(account, input, reply) {
  const [row] = await query(account, "select public.append_video_plan_turn($1,$2,$3,$4,$5) as data",
    [input.chatId, input.expectedTurn, input.requestId, input.prompt, reply]);
  return row.data;
}

function clientFor(account) {
  return {
    rpc(name, args) {
      return { async abortSignal() {
        const data = name === "search_video_playbooks" ? await search(account, args.p_terms) :
          await append(account, {
            chatId: args.p_chat_id, expectedTurn: args.p_expected_turn, requestId: args.p_request_id, prompt: args.p_prompt,
          }, args.p_reply);
        return { data };
      } };
    },
    from(table) {
      assert.ok(["video_plan_turns", "saved_references"].includes(table));
      let selected, ids, limit, single = false;
      const filters = new Map();
      const builder = {
        select(fields) { selected = fields; return this; },
        eq(key, value) { filters.set(key, value); return this; },
        order(key, options) { assert.equal(key, "turn_number"); assert.equal(options.ascending, false); return this; },
        limit(value) { limit = value; return this; },
        in(key, values) { assert.equal(key, "id"); ids = values; return this; },
        not() { return this; },
        abortSignal() { return this; },
        maybeSingle() { single = true; return this; },
        async then(resolve, reject) {
          assert.equal(filters.get("owner_id"), account);
          const work = table === "saved_references"
            ? query(account, `select ${selected} from public.saved_references where id = any($1::uuid[]) and ai_playbook is not null`, [ids])
            : single
              ? query(account, `select ${selected} from public.video_plan_turns where request_id = $1`, [filters.get("request_id")])
              : query(account, `select ${selected} from public.video_plan_turns where chat_id = $1 order by turn_number desc limit $2`,
                [filters.get("chat_id"), limit]);
          await work.then((data) => resolve({ data: single ? data[0] ?? null : data }), reject);
        },
      };
      return builder;
    },
  };
}

const newRequest = (prompt = "What references should I use for my next gym motivation video?") =>
  ({ chatId: null, expectedTurn: 0, requestId: randomUUID(), prompt });
const starterPlan = {
  references: [],
  hook: "Open tight on a hand chalking up.",
  shots: ["Film your first lift from the side."],
  edit: [{ action: "Cut to the lift on a heavy kick.", candidates: [] }],
  playbackCheck: "Check that every cut lands on the beat.",
};
const sourcedPlan = {
  ...starterPlan,
  references: [{
    candidate: 1, why: "The short beat cuts build intensity.", borrow: "Line up the action with each kick.",
    title: "Invented title", url: "https://example.invalid/", startSeconds: 900, endSeconds: 999,
  }],
  edit: [{ action: "Cut to the lift on a heavy kick.", candidates: [1] }],
};

function gemini(...steps) {
  return async (url, request) => {
    assert.equal(new URL(url).hostname, "generativelanguage.googleapis.com");
    const body = JSON.parse(request.body);
    assert.equal(body.store, false);
    assert.equal(body.input.length, 1);
    const reply = steps.shift();
    assert.ok(reply, "Unexpected Gemini request");
    if (reply instanceof Error) throw reply;
    const result = typeof reply === "function" ? await reply(JSON.parse(body.input[0].text)) : reply;
    return Response.json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(result) }] }] });
  };
}
const send = (input, fetcher, account = owner) => sendVideoPlan(clientFor(account), account, input, { apiKey: "stub", fetcher });
const readTurn = async (account, chatId, turn) => (await query(account,
  "select prompt, reply from public.video_plan_turns where chat_id = $1 and turn_number = $2", [chatId, turn]))[0];

test("search uses playbook text and excludes summary-only or other accounts' references", async () => {
  assert.deepEqual((await search(owner, ["gym", "montage"])).map(({ id }) => id), [montage]);
  assert.deepEqual((await search(other, ["gym", "montage"])).map(({ id }) => id), [privateMatch]);
  assert.deepEqual(await search(owner, ["the", "&&"]), []);
  await assert.rejects(() => query("", "select * from public.search_video_playbooks(array['gym'])", [], "anon"), /permission denied/);
});

test("gym plan is grounded in a transferable playbook and retries return the saved turn", async () => {
  const input = newRequest();
  assert.deepEqual(parsePlanRequest(input), input);
  const result = await send(input, gemini(
    ({ prompt }) => { assert.match(prompt, /gym motivation/); return { terms: ["gym", "montage"] }; },
    ({ candidates }) => {
      assert.equal(candidates.length, 1);
      assert.match(candidates[0].title, /coffee/);
      assert.equal(candidates[0].playbook.observation, book.observation);
      return sourcedPlan;
    },
  ));
  assert.equal(result.status, "saved");
  const { reply } = await readTurn(owner, result.chatId, 1);
  assert.deepEqual(reply.references, [{
    id: montage, title: "Beat-synced coffee preparation", startSeconds: 5.5, endSeconds: 8,
    why: "The short beat cuts build intensity.", borrow: "Line up the action with each kick.",
  }]);
  assert.deepEqual(reply.edit[0].referenceIds, [montage]);
  assert.equal(reply.references.some(({ id }) => [privateMatch, summaryOnly].includes(id)), false);
  assert.deepEqual(await send(input, gemini()), result);
  assert.equal(await readTurn(other, result.chatId, 1), undefined);
  assert.deepEqual(await query(other, "select id from public.video_plan_chats where id = $1", [result.chatId]), []);
  assert.deepEqual(await send({ ...newRequest(), chatId: result.chatId, expectedTurn: 1 }, gemini(), other), { status: "conflict" });
});

test("follow-ups use the saved conversation and only one stale-tab write can win", async () => {
  const first = await send(newRequest(), gemini({ terms: ["montage"] }, sourcedPlan));
  const followUp = { ...newRequest("Can I shoot this alone in 30 seconds?"), chatId: first.chatId, expectedTurn: 1 };
  const results = await Promise.all([followUp, { ...followUp, requestId: randomUUID() }].map((input) =>
    send(input, gemini(
      ({ conversation }) => { assert.equal(conversation[0].reply.hook, starterPlan.hook); return { terms: ["tripod"] }; },
      ({ candidates }) => { assert.match(candidates[0].title, /coffee/); return sourcedPlan; },
    )),
  ));
  assert.deepEqual(results.map(({ status }) => status).sort(), ["conflict", "saved"]);
  assert.equal((await readTurn(owner, first.chatId, 2)).prompt, followUp.prompt);
  assert.equal(await readTurn(owner, first.chatId, 3), undefined);
});

test("provider failure and invalid citations do not save anything; same prompt can be retried", async () => {
  const input = newRequest("Make a niche astronomy explainer");
  await assert.rejects(() => send(input, gemini(new Error("offline"))), /offline/);
  await assert.rejects(() => send(input, gemini({ terms: ["astronomy"] }, sourcedPlan)), /Invalid reference/);
  await assert.rejects(() => send(input, gemini({ terms: [] }, { ...starterPlan, edit: sourcedPlan.edit })), /Invalid edit citation/);
  assert.deepEqual(await query(owner, "select id from public.video_plan_chats where title = $1", [input.prompt]), []);
  const retry = await send(input, gemini({ terms: ["astronomy"] }, ({ candidates }) => {
    assert.deepEqual(candidates, []);
    return starterPlan;
  }));
  const { reply } = await readTurn(owner, retry.chatId, 1);
  assert.deepEqual(reply.references, []);
  assert.equal(reply.hook, starterPlan.hook);
});

test("deleting a reference preserves saved advice and deleting a chat removes its turns", async () => {
  const first = await send(newRequest(), gemini({ terms: ["montage"] }, sourcedPlan));
  await query(owner, "delete from public.saved_references where id = $1", [montage]);
  assert.equal((await readTurn(owner, first.chatId, 1)).reply.references[0].id, montage);
  const second = await send({ ...newRequest(), chatId: first.chatId, expectedTurn: 1 }, gemini({ terms: [] }, ({ candidates }) => {
    assert.deepEqual(candidates, []);
    return starterPlan;
  }));
  assert.equal(second.status, "saved");
  await query(other, "delete from public.video_plan_chats where id = $1", [first.chatId]);
  assert.ok(await readTurn(owner, first.chatId, 1));
  await query(owner, "delete from public.video_plan_chats where id = $1", [first.chatId]);
  assert.equal(await readTurn(owner, first.chatId, 1), undefined);
});
