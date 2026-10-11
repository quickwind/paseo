// Probe: what does `devin acp` send back? Used to find out why something Paseo shows from an ACP
// agent (the context-window ring, usage) is missing for Devin.
//
//   node devin-acp-probe.mjs [--prompt /context] [--prompt "Reply with the word OK"] \
//        [--out probe.txt] [--cmd devin] [--cwd .] [--raw]
//
// Starts `devin acp`, opens a session, sends each --prompt in turn (default: /usage) and prints a
// short report: which kinds of update arrived, any usage_update in full, the reply text, and every
// field whose name mentions usage, token, context, cost, acu or credit. --raw prints every message.
// --out writes the report as UTF-8 (PowerShell's `>` writes UTF-16). A plain prompt makes Devin
// answer, which uses a little of your ACU; slash commands such as /context should not.
//
// No login token is read or sent by this script; the devin process uses its own stored login.
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const values = (name) =>
  argv.flatMap((item, index) => (item === `--${name}` && argv[index + 1] ? [argv[index + 1]] : []));
const first = (name, fallback) => values(name)[0] ?? fallback;

const command = first("cmd", "devin");
const prompts = values("prompt").length > 0 ? values("prompt") : ["/usage"];
const cwd = first("cwd", process.cwd());
const outFile = first("out");
const raw = flag("raw");
const PROMPT_TIMEOUT_MS = 180_000;
const SETTLE_MS = 2_500;
const INTERESTING = /usage|token|context|cost|acu|credit|window|quota/iu;
const NOISY_METHODS = new Set(["_cognition.ai/output", "_cognition.ai/mcp/serversChanged"]);

if (outFile) writeFileSync(outFile, "");
const say = (line) => {
  console.log(line);
  if (outFile) appendFileSync(outFile, `${line}\n`);
};
const clip = (value, max = 600) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}... (${text.length} chars)` : text;
};

// Field paths whose name looks like usage/context information, with a short value.
function interestingFields(value, prefix = "") {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const at = prefix ? `${prefix}.${key}` : key;
    const own = INTERESTING.test(key) ? [`${at} = ${clip(child, 160)}`] : [];
    return [...own, ...interestingFields(child, at)];
  });
}

const counts = new Map();
const count = (name) => counts.set(name, (counts.get(name) ?? 0) + 1);
let usageUpdates = 0;

function report(message) {
  if (raw) {
    say(`<< ${JSON.stringify(message)}`);
    return;
  }
  if (message.method === "session/update") {
    const update = message.params?.update ?? {};
    const kind = update.sessionUpdate ?? "(unknown)";
    count(`update:${kind}`);
    if (kind === "usage_update") {
      usageUpdates += 1;
      say(`<< usage_update ${clip(update, 400)}`);
    } else if (kind === "agent_message_chunk") {
      say(`<< agent says: ${clip(update.content?.text ?? update.content, 400)}`);
    } else if (kind === "available_commands_update") {
      const names = (update.availableCommands ?? []).map((c) => c.name);
      const wanted = names.filter(
        (n) => INTERESTING.test(n) || /^(status|session-stats)$/u.test(n),
      );
      say(`<< ${names.length} commands; related: ${wanted.join(", ") || "(none)"}`);
    } else {
      const fields = interestingFields(update);
      if (fields.length > 0) say(`<< ${kind}: ${fields.join("; ")}`);
    }
    return;
  }
  if (message.method) {
    count(`notification:${message.method}`);
    if (NOISY_METHODS.has(message.method)) return;
    say(`<< ${message.method} ${clip(message.params, 500)}`);
  }
}

const child = spawn(command, ["acp"], {
  stdio: ["pipe", "pipe", "inherit"],
  shell: process.platform === "win32",
});
child.on("error", (error) => {
  console.error(`could not start '${command} acp': ${error.message}`);
  process.exit(1);
});

let nextId = 1;
const pending = new Map();
let buffer = "";

const write = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
const send = (method, params, timeoutMs = 60_000) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} got no answer in ${timeoutMs / 1000}s`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => (clearTimeout(timer), resolve(value)),
      reject: (error) => (clearTimeout(timer), reject(error)),
    });
    if (raw) say(`>> ${JSON.stringify({ id, method, params })}`);
    write({ jsonrpc: "2.0", id, method, params });
  });

function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    say(`?? ${clip(line, 200)}`);
    return;
  }
  if (message.id !== undefined && message.method === undefined) {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (raw) say(`<< ${JSON.stringify(message)}`);
    if (!waiter) return;
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
    return;
  }
  if (message.id !== undefined && message.method) {
    // The agent is asking us something (permission, file access). Decline so it carries on.
    const decline =
      message.method === "session/request_permission"
        ? { result: { outcome: { outcome: "cancelled" } } }
        : { error: { code: -32601, message: "not supported by probe" } };
    write({ jsonrpc: "2.0", id: message.id, ...decline });
    count(`request-declined:${message.method}`);
    return;
  }
  report(message);
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline;
  while ((newline = buffer.indexOf("\n")) > -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) handleLine(line);
  }
});

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const init = await send("initialize", { protocolVersion: 1, clientCapabilities: {} });
  say(`initialize: agent ${clip(init.agentInfo, 200)}`);
  const initFields = interestingFields(init);
  if (initFields.length > 0) say(`  related fields: ${initFields.join("; ")}`);
  const session = await send("session/new", { cwd, mcpServers: [] });
  say(
    `session/new: ${session.sessionId}; related fields: ${interestingFields(session).join("; ") || "(none)"}`,
  );
  await settle(SETTLE_MS);
  for (const text of prompts) {
    say(`\n-- prompt: ${text}`);
    try {
      const result = await send(
        "session/prompt",
        { sessionId: session.sessionId, prompt: [{ type: "text", text }] },
        PROMPT_TIMEOUT_MS,
      );
      say(`-- prompt result: ${clip(result, 1200)}`);
    } catch (error) {
      say(`-- prompt failed: ${error.message}`);
    }
    await settle(SETTLE_MS);
  }
} catch (error) {
  say(`-- failed: ${error.message}`);
}

say("\n== summary");
for (const [name, n] of [...counts].sort()) say(`  ${String(n).padStart(3)}  ${name}`);
say(
  `usage_update messages seen: ${usageUpdates}${usageUpdates === 0 ? "  (Paseo's context ring has nothing to show)" : ""}`,
);
child.kill();
process.exit(0);
