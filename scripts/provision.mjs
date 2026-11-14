import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { parseLink } from "../lib/references.js";
import { demoFolders } from "../lib/demo-folders.js";

const {
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
  SUPABASE_SECRET_KEY: secret,
  MARKDONE_OWNER_EMAIL: ownerEmail,
  MARKDONE_DEMO_EMAIL: demoEmail = "judges@markdone.example",
} = process.env;

const credentialFile = ".env.markdone-accounts.json";
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

async function credentials() {
  let accounts;
  try {
    accounts = JSON.parse(await readFile(credentialFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const create = (email) => ({ email, password: `Md1!${randomBytes(24).toString("base64url")}` });
    accounts = { project: url, owner: create(ownerEmail), demo: create(demoEmail) };
    await writeFile(credentialFile, JSON.stringify(accounts, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  if (accounts.project !== url || accounts.owner.email !== ownerEmail || accounts.demo.email !== demoEmail) {
    throw new Error(`The existing ${credentialFile} belongs to a different project or account pair.`);
  }
  return accounts;
}

async function provisionUser(admin, account) {
  const client = createClient(url, publicKey, { auth });
  const existing = await client.auth.signInWithPassword(account);
  if (existing.data.user) return { client, user: existing.data.user };

  const { data, error } = await admin.auth.admin.createUser({ ...account, email_confirm: true });
  if (error) throw error;

  const signIn = await client.auth.signInWithPassword(account);
  if (signIn.error) throw signIn.error;
  return { client, user: data.user };
}

async function seedDemo(admin, { client, user }) {
  const { data: existing, error } = await admin.from("folders").select("id,name").eq("owner_id", user.id);
  if (error) throw error;
  const ids = new Map(existing.map(({ id, name }) => [name.trim().toLowerCase(), id]));

  const folderIds = new Map();
  for (const { key, name } of demoFolders) {
    let id = ids.get(name.toLowerCase());
    if (!id) {
      const { data, error } = await client.from("folders").insert({ name }).select("id").single();
      if (error) throw error;
      id = data.id;
    }
    folderIds.set(key, id);
  }

  const { data: examples, error: catalogError } = await client.from("demo_references")
    .select("url,title,folders").order("sort_order").order("id");
  if (catalogError) throw catalogError;
  for (const example of examples) {
    const link = parseLink(example.url);
    if (!link) throw new Error("A demo post URL is invalid.");
    const { data: id, error } = await client.rpc("save_reference", {
      p_platform: link.platform,
      p_post_id: link.id,
      p_kind: link.kind,
      p_url: link.url,
      p_folder_ids: example.folders.map((key) => folderIds.get(key)),
    });
    if (error) throw error;
    const { error: updateError } = await client.from("saved_references").update({ title: example.title })
      .eq("id", id).neq("ai_status", "ready");
    if (updateError) throw updateError;
  }
}

async function main() {
  if (![url, publicKey, secret, ownerEmail, demoEmail].every(Boolean) || ownerEmail.toLowerCase() === demoEmail.toLowerCase()) {
    throw new Error("Provide both Supabase keys, the project URL, and a distinct owner email.");
  }
  const accounts = await credentials();
  const admin = createClient(url, secret, { auth });
  await provisionUser(admin, accounts.owner);
  await seedDemo(admin, await provisionUser(admin, accounts.demo));
  console.log(`Both accounts are ready. Credentials are stored in ${credentialFile}.`);
}

main().catch((error) => {
  console.error("Provisioning failed:", error.message);
  process.exitCode = 1;
});
