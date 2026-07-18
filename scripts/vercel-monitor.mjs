#!/usr/bin/env node
// Vercel deploy monitor (GitHub Actions edition).
// Alerts on NEW failed (ERROR) production+preview deploys. Sends Telegram HTML
// directly via the Bot API. State in ./state/vercel.json (committed by workflow).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sendTelegram } from "./lib/telegram.mjs";

// Identifiers come from env (kept out of a public repo). Fallbacks keep local
// dev working if you export them.
const TEAM_ID = process.env.VERCEL_TEAM_ID || "";
const PROJECTS = (process.env.VERCEL_PROJECTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const STATE_FILE = process.env.VERCEL_STATE_FILE || resolve("state/vercel.json");
const FAIL_STATES = new Set(["ERROR"]);
const MAX_REMEMBERED = 300;

function loadToken() {
  const t = process.env.VERCEL_TOKEN;
  if (!t) throw new Error("VERCEL_TOKEN not set");
  return t;
}
function loadState() {
  if (!existsSync(STATE_FILE)) return { initialized: false, alerted: [] };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { initialized: false, alerted: [] };
  }
}
function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}
async function fetchDeployments(token, app) {
  const url = `https://api.vercel.com/v6/deployments?app=${encodeURIComponent(app)}&teamId=${TEAM_ID}&limit=20`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`vercel API ${app}: HTTP ${res.status}`);
  const json = await res.json();
  return json.deployments || [];
}
function fmtTime(ms) {
  return new Date(ms).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

async function main() {
  const token = loadToken();
  if (!TEAM_ID || PROJECTS.length === 0) {
    console.log("VERCEL_TEAM_ID / VERCEL_PROJECTS not set — skipping deploy check");
    return;
  }
  const state = loadState();
  const alertedSet = new Set(state.alerted || []);

  const failures = [];
  for (const app of PROJECTS) {
    try {
      const deployments = await fetchDeployments(token, app);
      for (const d of deployments) {
        const st = d.readyState || d.state;
        if (FAIL_STATES.has(st)) {
          failures.push({
            app,
            uid: d.uid,
            state: st,
            created: d.created,
            target: d.target || "preview",
            url: d.url ? `https://${d.url}` : "",
          });
        }
      }
    } catch (e) {
      console.error(e.message);
    }
  }

  // First run: baseline everything currently failed, alert nothing.
  if (!state.initialized) {
    saveState({ initialized: true, alerted: failures.map((f) => f.uid).slice(-MAX_REMEMBERED) });
    console.log("baseline established, no alert");
    return;
  }

  const fresh = failures.filter((f) => !alertedSet.has(f.uid));
  if (fresh.length > 0) {
    for (const f of fresh) alertedSet.add(f.uid);
    saveState({ initialized: true, alerted: Array.from(alertedSet).slice(-MAX_REMEMBERED) });
  }

  if (fresh.length === 0) {
    console.log("no new failed deploys");
    return;
  }

  const lines = ["🛰 <b>Deploy Vercel com falha</b>", ""];
  for (const f of fresh) {
    lines.push(`❌ <b>${f.app}</b> (${f.target}) — ${f.state}\n   ${fmtTime(f.created)}${f.url ? `\n   ${f.url}` : ""}`);
  }
  await sendTelegram(lines.join("\n"));
  console.log(`alert sent (${fresh.length} failed deploy(s))`);
}

main().catch((e) => {
  console.error(`vercel-monitor error: ${e.message}`);
  process.exit(1);
});
