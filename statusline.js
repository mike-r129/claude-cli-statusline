#!/usr/bin/env node
// Claude Code statusline.
//
//   🤖 model | 🧠 context bar | 🎯 effort | 🐱 5-hour limit → reset | 📅 weekly limit → reset
//   💰 $session / $today / $block (ccusage) | 💬 turns
//
// Setup: "statusLine": { "type": "command", "command": "node ~/.claude/statusline.js" }
// Needs Node 18+. ccusage (npm i -g ccusage) is optional and only adds the today/block totals.
// Set STATUSLINE_DEBUG=1 to save each input to ~/.claude/statusline-input.json.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const CC_CACHE = path.join(CLAUDE_DIR, "ccusage-cache.txt");
const CC_LOCK = path.join(CLAUDE_DIR, "ccusage-cache.lock");
const CC_REFRESH_SECS = 300;
const CC_LOCK_STALE_SECS = 600;
const CC_TIMEOUT_MS = 120_000;

// Colored 10-segment bar + percentage for a 0-100 value.
function makeBar(pct) {
  const segments = 10;
  const filled = Math.max(0, Math.min(segments, Math.floor((pct * segments + 50) / 100)));
  const color = pct < 50 ? "\x1b[32m" : pct < 80 ? "\x1b[33m" : "\x1b[31m";
  return `${color}${"▰".repeat(filled)}${"▱".repeat(segments - filled)}\x1b[0m ${pct}%`;
}

const fmtTime = (epoch) =>
  epoch ? new Date(epoch * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
const fmtDateTime = (epoch) =>
  epoch
    ? new Date(epoch * 1000).toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + fmtTime(epoch)
    : "";

// Turns = prompts you typed: skip tool results, meta/sidechain entries,
// slash-command echoes, reminders and interrupt markers.
function countTurns(transcriptPath) {
  let n = 0;
  for (const line of fs.readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.includes('"type":"user"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "user" || e.isMeta || e.isSidechain) continue;
    const c = e.message?.content;
    const text = typeof c === "string" ? c
      : Array.isArray(c) && !c.some((x) => x.type === "tool_result") ? c.map((x) => x.text || "").join(" ") : null;
    if (text == null) continue;
    const t = text.trim();
    if (/^<(command-|local-command|system-reminder)/.test(t) || t.startsWith("[Request interrupted")) continue;
    n++;
  }
  return n;
}

const ageSecs = (p) => {
  try { return (Date.now() - fs.statSync(p).mtimeMs) / 1000; } catch { return Infinity; }
};

// ccusage re-parses every transcript (hundreds of MB), so never run it inline:
// serve the cached line, and refresh it in a detached child at most every 5 minutes,
// one run at a time (mkdir is an atomic lock; stale locks expire after 10 minutes).
// --no-offline fetches current prices; the built-in table lags new models.
function cachedCcusage(input) {
  if (fs.existsSync(CC_LOCK) && ageSecs(CC_LOCK) > CC_LOCK_STALE_SECS) {
    try { fs.rmdirSync(CC_LOCK); } catch {}
  }
  if (ageSecs(CC_CACHE) > CC_REFRESH_SECS) {
    let locked = false;
    try { fs.mkdirSync(CC_LOCK); locked = true; } catch {}
    if (locked) {
      spawn(process.execPath, [__filename, "--refresh-ccusage"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, STATUSLINE_INPUT: input },
      }).unref();
    }
  }
  try { return fs.readFileSync(CC_CACHE, "utf8"); } catch { return ""; }
}

function refreshCcusage() {
  try {
    const r = spawnSync("ccusage", ["statusline", "--no-offline"], {
      input: process.env.STATUSLINE_INPUT || "",
      encoding: "utf8",
      timeout: CC_TIMEOUT_MS,
      shell: process.platform === "win32", // ccusage is a .cmd shim on Windows
      windowsHide: true,
    });
    const out = (r.stdout || "").trim();
    if (r.status === 0 && out) {
      fs.writeFileSync(CC_CACHE + ".tmp", out);
      fs.renameSync(CC_CACHE + ".tmp", CC_CACHE);
    }
  } finally {
    try { fs.rmdirSync(CC_LOCK); } catch {}
  }
}

function render(input) {
  let data = {};
  try { data = JSON.parse(input); } catch {}

  const model = data.model?.display_name || "Unknown";
  const rawCtx = data.context_window?.used_percentage;
  const ctxPct = rawCtx != null ? Math.round(rawCtx) : 0;

  // Prefer the live effort level; fall back to settings.json.
  let effort = data.effort?.level || "";
  if (!effort) {
    try { effort = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, "settings.json"), "utf8")).effortLevel || ""; } catch {}
  }

  const parts = [`🤖 ${model}`, `🧠 ${makeBar(ctxPct)}`, `🎯 ${effort === "max" ? "MAX" : effort || "-"}`];

  // Usage-limit bars appear once subscription data arrives (after the first API response).
  const r = data.rate_limits || {};
  if (r.five_hour?.used_percentage != null) {
    const reset = fmtTime(r.five_hour.resets_at);
    parts.push(`🐱 ${makeBar(Math.round(r.five_hour.used_percentage))}` + (reset ? ` → ${reset}` : ""));
  }
  if (r.seven_day?.used_percentage != null) {
    const reset = fmtDateTime(r.seven_day.resets_at);
    parts.push(`📅 ${makeBar(Math.round(r.seven_day.used_percentage))}` + (reset ? ` → ${reset}` : ""));
  }

  // Live session cost from Claude Code; ccusage adds today/block from its cache.
  const sessionCost = typeof data.cost?.total_cost_usd === "number" ? data.cost.total_cost_usd.toFixed(2) : "";
  let costs = cachedCcusage(input).match(/\$[^|]*block[^|]*\)/)?.[0] || "";
  if (sessionCost && costs) {
    const i = costs.indexOf(" session / ");
    costs = `$${sessionCost} session / ${i >= 0 ? costs.slice(i + " session / ".length) : costs}`;
  } else if (sessionCost) {
    costs = `$${sessionCost} session`;
  }

  let turns = "";
  try { if (data.transcript_path) turns = String(countTurns(data.transcript_path)); } catch {}

  const line2 = [costs && `💰 ${costs}`, turns && `💬 ${turns} turns`].filter(Boolean).join(" | ");
  return parts.join(" | ") + "\n" + (line2 ? line2 + "\n" : "");
}

if (process.argv[2] === "--refresh-ccusage") {
  refreshCcusage();
} else {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (input += d));
  process.stdin.on("end", () => {
    if (process.env.STATUSLINE_DEBUG === "1") {
      try { fs.writeFileSync(path.join(CLAUDE_DIR, "statusline-input.json"), input); } catch {}
    }
    process.stdout.write(render(input));
  });
}
