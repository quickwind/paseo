import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowedHosts,
  discover,
  fetchUsage,
  readDevinLogin,
  reportFromStatus,
  type DevinLogin,
} from "./usage.js";

const input = { store: "devin-cli" } as const;
const login: DevinLogin = { apiKey: "SECRET-KEY", serverUrl: "https://server.codeium.com" };

// The shape the real account returned (strings the probe masked are made up).
const realStatus = {
  userStatus: {
    planStatus: {
      planInfo: { planName: "Cognition Platform (Enterprise)", isEnterprise: true },
      planStart: "2026-10-01T00:00:00Z",
      planEnd: "2026-11-01T00:00:00Z",
      availablePromptCredits: -1,
      acuConsumed: 9.314008,
      acuLimit: 30,
    },
  },
};

function respond(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

const deps = (fetchApi: typeof fetch, readLogin = async () => login) => ({
  fetchApi,
  readLogin,
  cliVersion: async () => "3000.6.2",
});

describe("reportFromStatus", () => {
  it("turns ACU used and limit into one monthly window and a detail", () => {
    const report = reportFromStatus(realStatus);
    expect(report.status).toBe("available");
    if (report.status !== "available") return;
    expect(report.planLabel).toBe("Cognition Platform (Enterprise)");
    expect(report.windows).toHaveLength(1);
    const [window] = report.windows;
    expect(window?.label).toBe("Monthly ACU");
    expect(window?.usedPct).toBeCloseTo(31.05, 1);
    expect(window?.remainingPct).toBeCloseTo(68.95, 1);
    expect(window?.resetsAt).toBe("2026-11-01T00:00:00.000Z");
    expect(window?.tone).toBeUndefined();
    expect(report.details?.[0]).toMatchObject({ label: "ACU used", value: "9.31 / 30" });
  });

  it("warns from 80 percent and flags danger from 95", () => {
    const at = (acuConsumed: number) => {
      const report = reportFromStatus({
        userStatus: { planStatus: { acuConsumed, acuLimit: 30 } },
      });
      return report.status === "available" ? report.windows[0]?.tone : "not available";
    };
    expect(at(23.9)).toBeUndefined();
    expect(at(24)).toBe("warning");
    expect(at(28.4)).toBe("warning");
    expect(at(28.5)).toBe("danger");
    expect(at(40)).toBe("danger");
  });

  it("caps the bar at 100 percent when the account is over its limit", () => {
    const report = reportFromStatus({
      userStatus: { planStatus: { acuConsumed: 40, acuLimit: 30 } },
    });
    if (report.status !== "available") throw new Error("expected available");
    expect(report.windows[0]?.usedPct).toBe(100);
    expect(report.details?.[0]?.value).toBe("40 / 30");
  });

  it("treats a missing consumed value as zero, as proto3 JSON omits zeros", () => {
    const report = reportFromStatus({ userStatus: { planStatus: { acuLimit: 30 } } });
    if (report.status !== "available") throw new Error("expected available");
    expect(report.windows[0]?.usedPct).toBe(0);
    expect(report.details?.[0]?.value).toBe("0 / 30");
  });

  it("ignores an unreadable plan end instead of showing a bad date", () => {
    const report = reportFromStatus({
      userStatus: { planStatus: { acuLimit: 30, planEnd: "soon" } },
    });
    if (report.status !== "available") throw new Error("expected available");
    expect(report.windows[0]?.resetsAt).toBeNull();
  });

  it("says so when the plan has no ACU limit rather than showing zero", () => {
    expect(reportFromStatus({ userStatus: { planStatus: { planInfo: {} } } })).toEqual({
      status: "unavailable",
      problem: { kind: "no_quota", detail: "This Devin plan reports no ACU limit" },
    });
  });

  it("fails loudly when the response no longer has a plan status", () => {
    expect(() => reportFromStatus({ userStatus: {} })).toThrow(/API may have changed/);
    expect(() => reportFromStatus("nope")).toThrow(/API may have changed/);
  });
});

describe("fetchUsage", () => {
  it("posts the login to the stored server and returns the report", async () => {
    const fetchApi = respond(realStatus);
    const report = await fetchUsage(input, deps(fetchApi));
    expect(report.status).toBe("available");
    const [url, init] = vi.mocked(fetchApi).mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus",
    );
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({
      metadata: {
        apiKey: "SECRET-KEY",
        ideName: "devin",
        ideVersion: "3000.6.2",
        extensionVersion: "3000.6.2",
        locale: "en",
      },
    });
  });

  it("never sends the key to a host that is not allowed", async () => {
    for (const serverUrl of [
      "https://evil.example.com",
      "http://server.codeium.com",
      "https://server.codeium.com.evil.example.com",
    ]) {
      const fetchApi = respond(realStatus);
      await expect(
        fetchUsage(
          input,
          deps(fetchApi, async () => ({ ...login, serverUrl })),
        ),
      ).rejects.toThrow(/Refusing to send/);
      expect(fetchApi).not.toHaveBeenCalled();
    }
  });

  it("allows an extra host a company configures, and only exactly that host", async () => {
    const env = { WUKONG_DEVIN_API_HOSTS: "devin.corp.example, other.corp.example" };
    expect(allowedHosts(env).has("devin.corp.example")).toBe(true);
    expect(allowedHosts(env).has("corp.example")).toBe(false);
    const fetchApi = respond(realStatus);
    const report = await fetchUsage(input, {
      ...deps(fetchApi, async () => ({ ...login, serverUrl: "https://devin.corp.example" })),
      env,
    });
    expect(report.status).toBe("available");
  });

  it("reports a rejected login instead of an error", async () => {
    for (const status of [401, 403]) {
      expect(await fetchUsage(input, deps(respond({}, status)))).toEqual({
        status: "unavailable",
        problem: { kind: "rejected", status },
      });
    }
  });

  it("errors on a server failure without echoing the response or the key", async () => {
    const error = await fetchUsage(input, deps(respond({ echo: "SECRET-KEY" }, 500))).catch(
      (e: Error) => e,
    );
    expect((error as Error).message).toBe("Devin usage API returned 500");
  });

  it("asks the user to sign in when there is no login", async () => {
    await expect(
      fetchUsage(
        input,
        deps(respond({}), async () => null as never),
      ),
    ).rejects.toThrow(/not signed in/);
  });
});

describe("login file and discovery", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function credentials(text: string): string {
    dir = mkdtempSync(join(tmpdir(), "devin-creds-"));
    const path = join(dir, "credentials.toml");
    writeFileSync(path, text);
    return path;
  }

  it("reads the key and server from credentials.toml", async () => {
    const path = credentials(
      'windsurf_api_key = "abc123"\napi_server_url = "https://server.codeium.com"\nother = 1\r\n',
    );
    expect(await readDevinLogin(path)).toEqual({
      apiKey: "abc123",
      serverUrl: "https://server.codeium.com",
    });
  });

  it("returns null for a missing file or one without both values", async () => {
    expect(await readDevinLogin(join(tmpdir(), "no-such-devin-file.toml"))).toBeNull();
    expect(await readDevinLogin(credentials('windsurf_api_key = "abc"\n'))).toBeNull();
  });

  it("offers one account when signed in, and never exposes the key or an email", async () => {
    const accounts = await discover({ kind: "global" }, async () => login);
    expect(accounts).toEqual([
      { key: "default", label: "Devin CLI", harness: "Devin", input: { store: "devin-cli" } },
    ]);
    expect(JSON.stringify(accounts)).not.toContain("SECRET-KEY");
  });

  it("offers nothing when signed out, or for a session on another provider", async () => {
    expect(await discover({ kind: "global" }, async () => null)).toEqual([]);
    expect(
      await discover({ kind: "session", provider: "claude", env: {} }, async () => login),
    ).toEqual([]);
    expect(
      (await discover({ kind: "session", provider: "devin", env: {} }, async () => login)).length,
    ).toBe(1);
  });
});
