import { CloudServiceDisabledError } from "@getpaseo/protocol/internal-edition";
import type { GitHubService } from "./github-service.js";

// Internal edition: GitHub is not a forge here, so the shared GitHub service the
// daemon hands to sessions, worktree creation and archive never runs `gh`.
// Every method that would reach github.com rejects with CloudServiceDisabledError;
// invalidate, dispose and poll retention do nothing. Callers already treat a
// rejected forge call as an error response.

const DISABLED_FORGE_SERVICE = Symbol("paseo.disabledForgeService");

const NO_OP_METHODS = new Set<string | symbol>(["invalidate", "dispose"]);

// Optional synchronous members: they must read as absent, not as a rejecting function,
// or `supportsCrossRepoCheckoutWithoutRefs` reads truthy and the optional hooks return
// a promise where callers expect a value.
const ABSENT_MEMBERS = new Set<string | symbol>([
  "supportsCrossRepoCheckoutWithoutRefs",
  "defaultCheckoutRefs",
  "buildPrLocalBranchName",
]);

function reject(): Promise<never> {
  return Promise.reject(new CloudServiceDisabledError("GitHub"));
}

export function createDisabledGitHubService(): GitHubService {
  const methods: Record<string | symbol, unknown> = {
    [DISABLED_FORGE_SERVICE]: true,
    authProbeCanThrow: false,
    invalidate: () => {},
    dispose: () => {},
    retainCurrentPullRequestStatusPoll: () => ({ unsubscribe: () => {} }),
  };
  // Proxy so every ForgeService/GitHubService method is covered, including ones
  // added upstream later: anything not listed above rejects.
  return new Proxy(methods, {
    // Wrappers that probe with `in` (test stubs, spread helpers) must see every method.
    has(target, property) {
      if (ABSENT_MEMBERS.has(property)) {
        return false;
      }
      return typeof property === "string" ? property !== "then" : property in target;
    },
    get(target, property) {
      if (property in target) {
        return target[property];
      }
      if (
        typeof property === "symbol" ||
        NO_OP_METHODS.has(property) ||
        ABSENT_MEMBERS.has(property) ||
        property === "then"
      ) {
        return undefined;
      }
      return reject;
    },
  }) as unknown as GitHubService;
}

/** True for the service {@link createDisabledGitHubService} returns. */
export function isDisabledForgeService(service: unknown): boolean {
  return (
    typeof service === "object" &&
    service !== null &&
    (service as Record<symbol, unknown>)[DISABLED_FORGE_SERVICE] === true
  );
}
