#!/usr/bin/env node
// One-off helper: encrypts and uploads the three Actions secrets to the repo via
// the GitHub API, so no secret is ever pasted into a chat or the web UI.
//
// Usage (env):
//   GH_TOKEN   fine-grained PAT scoped to the repo (Secrets: read/write)
//   GH_REPO    "owner/repo"
//   SUPABASE_CONN, VERCEL_TOKEN, TELEGRAM_BOT_TOKEN  the secret values
//
// Requires: npm i libsodium-wrappers  (dev-only, not needed by the workflow)

import sodium from "libsodium-wrappers";

const token = process.env.GH_TOKEN;
const repo = process.env.GH_REPO;
if (!token || !repo) throw new Error("set GH_TOKEN and GH_REPO");

const secrets = {
  SUPABASE_CONN: process.env.SUPABASE_CONN,
  VERCEL_TOKEN: process.env.VERCEL_TOKEN,
  VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
  VERCEL_PROJECTS: process.env.VERCEL_PROJECTS,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
};

const api = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });

async function main() {
  await sodium.ready;

  const keyRes = await api("/actions/secrets/public-key");
  if (!keyRes.ok) throw new Error(`public-key HTTP ${keyRes.status}: ${await keyRes.text()}`);
  const { key, key_id } = await keyRes.json();

  const pubKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);

  for (const [name, value] of Object.entries(secrets)) {
    if (!value) {
      console.log(`skip ${name} (no value)`);
      continue;
    }
    const enc = sodium.crypto_box_seal(sodium.from_string(value), pubKey);
    const encrypted_value = sodium.to_base64(enc, sodium.base64_variants.ORIGINAL);
    const res = await api(`/actions/secrets/${name}`, {
      method: "PUT",
      body: JSON.stringify({ encrypted_value, key_id }),
    });
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`set ${name} HTTP ${res.status}: ${await res.text()}`);
    }
    console.log(`set ${name} -> ${res.status}`);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
