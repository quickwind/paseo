// Devin usage for the account the Devin CLI is signed in to. Devin has no public API for a
// member's own quota; this makes the same request the CLI's /usage view makes, using the login
// the CLI stored. The key goes to an allowlisted https host and nowhere else, is never logged,
// and is not kept after the request. This plugin runs outside the daemon's egress guard, so the
// allowlist here is the only thing standing between the key and a stray host.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  unavailable,
  type UsageAccount,
  type UsageReport,
  type UsageScope,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import type { UsageInput } from "../shared/input.js";

const DEFAULT_HOSTS = ["server.codeium.com", "api.devin.ai"];
const STATUS_PATH = "/exa.seat_management_pb.SeatManagementService/GetUserStatus";
const WARNING_PCT = 80;
const DANGER_PCT = 95;

export interface DevinLogin {
  apiKey: string;
  serverUrl: string;
}

export interface UsageDeps {
  fetchApi?: typeof fetch;
  readLogin?: () => Promise<DevinLogin | null>;
  cliVersion?: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

/** Hosts the key may be sent to: Devin's own, plus any a company adds for its deployment. */
export function allowedHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const extra = (env["WUKONG_DEVIN_API_HOSTS"] ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_HOSTS, ...extra]);
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") {
    return join(
      env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"),
      "devin",
      "credentials.toml",
    );
  }
  return join(
    env["XDG_DATA_HOME"] || join(homedir(), ".local", "share"),
    "devin",
    "credentials.toml",
  );
}

// The file is flat `key = "value"` lines; that is all this reads.
function tomlString(text: string, key: string): string | undefined {
  return text.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, "m"))?.[1];
}

export async function readDevinLogin(path = credentialsPath()): Promise<DevinLogin | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const apiKey = tomlString(text, "windsurf_api_key");
  const serverUrl = tomlString(text, "api_server_url");
  return apiKey && serverUrl ? { apiKey, serverUrl } : null;
}

let cachedVersion: string | undefined;

async function devinCliVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const { stdout } = await promisify(execFile)("devin", ["--version"], {
      timeout: 5_000,
      shell: process.platform === "win32",
    });
    const version = stdout.match(/\d+\.\d+\.\d+/)?.[0];
    if (version) cachedVersion = version;
    return version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// Proto3 JSON leaves out zero values, so a missing number means zero.
const UserStatusSchema = z.object({
  userStatus: z
    .object({
      planStatus: z
        .object({
          acuConsumed: z.number().optional(),
          acuLimit: z.number().optional(),
          planStart: z.string().optional(),
          planEnd: z.string().optional(),
          planInfo: z.object({ planName: z.string().optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
});

function validIso(value: string | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function format(acu: number): string {
  return Number.isInteger(acu) ? String(acu) : acu.toFixed(2);
}

function toneFor(usedPct: number): UsageWindow["tone"] {
  if (usedPct >= DANGER_PCT) return "danger";
  if (usedPct >= WARNING_PCT) return "warning";
  return undefined;
}

export function reportFromStatus(body: unknown): UsageReport {
  const parsed = UserStatusSchema.safeParse(body);
  const plan = parsed.success ? parsed.data.userStatus?.planStatus : undefined;
  if (!plan) throw new Error("Devin usage response has no plan status; the API may have changed");
  const limit = plan.acuLimit ?? 0;
  if (limit <= 0) {
    return unavailable({ kind: "no_quota", detail: "This Devin plan reports no ACU limit" });
  }
  const consumed = plan.acuConsumed ?? 0;
  const usedPct = Math.min(100, (consumed / limit) * 100);
  const window: UsageWindow = {
    id: "acu-period",
    label: "Monthly ACU",
    shortLabel: "ACU",
    summary: true,
    usedPct,
    remainingPct: Math.max(0, 100 - usedPct),
    resetsAt: validIso(plan.planEnd),
  };
  const tone = toneFor(usedPct);
  if (tone) window.tone = tone;
  return {
    status: "available",
    planLabel: plan.planInfo?.planName,
    windows: [window],
    details: [
      {
        id: "acu",
        label: "ACU used",
        value: `${format(consumed)} / ${format(limit)}`,
        ...(tone ? { tone } : {}),
      },
    ],
  };
}

export async function fetchUsage(_input: UsageInput, deps: UsageDeps = {}): Promise<UsageReport> {
  const login = await (deps.readLogin ?? readDevinLogin)();
  if (!login) throw new Error("Devin CLI is not signed in; run `devin auth login`");
  const url = new URL(login.serverUrl);
  if (url.protocol !== "https:" || !allowedHosts(deps.env).has(url.hostname.toLowerCase())) {
    throw new Error(
      `Refusing to send the Devin login to ${url.hostname}; it is not an allowed host`,
    );
  }
  const version = await (deps.cliVersion ?? devinCliVersion)();
  const response = await (deps.fetchApi ?? fetch)(`${url.origin}${STATUS_PATH}`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Connect-Protocol-Version": "1",
    },
    body: JSON.stringify({
      metadata: {
        apiKey: login.apiKey,
        ideName: "devin",
        ideVersion: version,
        extensionVersion: version,
        locale: "en",
      },
    }),
  });
  if (response.status === 401 || response.status === 403) {
    return unavailable({ kind: "rejected", status: response.status });
  }
  if (!response.ok) throw new Error(`Devin usage API returned ${response.status}`);
  return reportFromStatus(await response.json());
}

/** One account when the CLI is signed in. A session query only matches Devin sessions. */
export async function discover(
  scope: UsageScope,
  readLogin: () => Promise<DevinLogin | null> = readDevinLogin,
): Promise<UsageAccount[]> {
  if (scope.kind === "session" && scope.provider !== "devin") return [];
  if (!(await readLogin())) return [];
  return [{ key: "default", label: "Devin CLI", harness: "Devin", input: { store: "devin-cli" } }];
}
