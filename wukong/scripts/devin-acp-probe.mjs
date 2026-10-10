// Probe: does `devin acp` expose /usage, and what does it send back?
// Usage: node wukong/scripts/devin-acp-probe.mjs [--cmd devin] [--prompt /usage] [--cwd .]
// Prints every JSON-RPC message in both directions. No tokens are read or sent by this script;
// the devin process uses its own stored login.
import { spawn } from "node:child_process";
import process from "node:process";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const command = arg("cmd", "devin");
const prompt = arg("prompt", "/usage");
const cwd = arg("cwd", process.cwd());
const quietMs = 4000;

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
let quietTimer;

const show = (direction, message) => console.log(`${direction} ${JSON.stringify(message)}`);
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const message = { jsonrpc: "2.0", id, method, params };
    show(">>", message);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline;
  while ((newline = buffer.indexOf("\n")) > -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.log(`?? ${line}`);
      continue;
    }
    show("<<", message);
    clearTimeout(quietTimer);
    if (message.id !== undefined && pending.has(message.id) && message.method === undefined) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    } else if (message.id !== undefined && message.method) {
      // Agent asked us something (permissions, fs): refuse politely so it can't hang.
      const reply = {
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "not supported by probe" },
      };
      show(">>", reply);
      child.stdin.write(`${JSON.stringify(reply)}\n`);
    }
  }
});

try {
  await send("initialize", { protocolVersion: 1, clientCapabilities: {} });
  const session = await send("session/new", { cwd, mcpServers: [] });
  console.log(`-- session ${session.sessionId}; waiting for the command list`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(`-- sending prompt: ${prompt}`);
  const result = await send("session/prompt", {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: prompt }],
  });
  console.log(`-- prompt finished: ${JSON.stringify(result)}`);
} catch (error) {
  console.log(`-- failed: ${error.message}`);
}
quietTimer = setTimeout(() => {
  child.kill();
  process.exit(0);
}, quietMs);
