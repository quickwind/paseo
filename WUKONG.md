# Wukong: read this first

This repository is **Wukong**, a company-internal fork of [Paseo](https://github.com/getpaseo/paseo).
It lives on the `wukong` branch of `quickwind/wukong` (a fork of `getpaseo/paseo`; remotes are
`origin` = the fork, `upstream` = Paseo). Whoever you are, human or AI agent, and whichever tool you
use, this file comes first. Where it disagrees with upstream's `CLAUDE.md`/`AGENTS.md`, this file
wins; where it is silent, upstream's rules apply.

## What Wukong is for

Paseo on company Windows machines, where nothing may be sent to cloud services:

- Agent providers: **Claude Code and Devin CLI only** (Devin runs as the ACP provider `devin acp`).
- The only forge is the **company GitLab**, driven through python-gitlab. No `glab`, no GitHub.
- **No traffic from the daemon to the internet.** Loopback only, plus an explicit allowlist.
- Delivered as **seven npm tarballs** (`@wukong/*`), installed with `npm install -g`. No desktop or
  mobile app. The team uses Windows and has no administrator rights.
- Runs next to a normal Paseo install: own command (`wukong`), home (`~/.wukong`), port (6899).

## The prime rule: the smallest possible footprint on upstream

We want to merge upstream often and cheaply. Every line changed in an upstream file is a future
merge conflict. An earlier attempt (the `internal-edition` branch, kept only for reference) edited
126 upstream files and was abandoned for exactly that reason. This branch edits **21 upstream
files, about 170 lines**; everything else is new files.

Before editing an upstream file, go down this ladder and stop at the first rung that works:

1. **Add a new file** under a Wukong-owned path (below) and wire it in from existing extension
   points: the `ForgeRegistry`, the plugin system, provider config, `runner` injection.
2. **Configure instead of code:** environment, defaults, or the daemon's own settings.
3. **Gate by edition:** `isWukongActive()` on the server, `WUKONG_BUILD` in the app. Upstream
   behaviour must stay byte-for-byte the same when the gate is off.
4. **Swap, don't edit:** `upstreamOnly(Component)` replaces one component with nothing by
   changing a tag name; `HIDDEN_ROW_STYLE` hides a row with a one-line style. Neither moves
   upstream's markup.
5. **Last resort: edit upstream, as little as possible.** One to a few lines, a `// Wukong: why`
   comment on them, no renames, no moving code, no reformatting. If the formatter re-indents a
   wrapped block, undo the change and use rung 4 (a 3-line change once became 20 lines that way).

Also: build-time changes beat source changes. The brand (name, icons, logo, strings) is applied to
a throwaway checkout when packaging, never committed into upstream's files. The npm scope
(`@getpaseo` to `@wukong`) is rewritten the same way.

### Checking the rule

```sh
git fetch upstream
node wukong/scripts/upstream-footprint.mjs     # lists every upstream file we modify
```

It fails if an upstream file is deleted or renamed, if a modified upstream file has no `Wukong`
marker in the lines added, or if the totals pass the budget (30 files, 300 lines; change with
`--max-files`/`--max-lines`). **Run it before every commit that touches upstream files** and when
you add one, add it to the table below. `rg "Wukong:"` finds every marker.

## Where Wukong lives

| Path                             | What                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `WUKONG.md`                      | This guide                                                                        |
| `wukong/`                        | Brand assets, scripts (pack, publish, brand, sync helpers), README, install guide |
| `wukong/README.md`               | Configuration, GitLab setup, building, publishing                                 |
| `wukong/INSTALL-WINDOWS.md`      | What the team does on Windows: install, update, first run, usage, plugins         |
| `packages/server/src/wukong/`    | Daemon policy: egress guard, providers, plugins, GitLab adapter, clone policy     |
| `packages/cli/src/wukong/`       | `wukong` command defaults (home, port, ignore Paseo's environment)                |
| `packages/app/src/wukong/`       | Web UI switches (`WUKONG_BUILD`, `upstreamOnly`, hiding helpers)                  |
| `plugins/wukong-gitlab/`         | Bundled plugin: Add project from GitLab, Fork clone, Open folder dialog           |
| `plugins/wukong-devin-usage/`    | Bundled plugin: Devin ACU usage, forecast                                         |
| `.github/workflows/wukong-*.yml` | Publish to npm; weekly sync with upstream                                         |

## Upstream files we touch (the whole list)

`upstream-footprint.mjs` is the source of truth; this is the why. Paths are under `packages/`
(`server/src/...`, `app/src/...`) unless they start with `CLAUDE.md`.

| File                                                                                                                       | Why                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `CLAUDE.md` (`AGENTS.md` links to it)                                                                                      | One line at the top pointing agents here                                     |
| `server/daemon-worker.ts`                                                                                                  | Imports the edition entry first (egress guard, policy)                       |
| `server/config.ts`                                                                                                         | Terminal profiles fixed to Claude Code                                       |
| `server/session.ts`                                                                                                        | Clone requests only from the company GitLab                                  |
| `server/agent/provider-registry.ts`                                                                                        | Restrict to Claude and Devin; Devin as configured ACP                        |
| `server/plugins/index.ts`                                                                                                  | No managed sources; only Wukong's bundled plugins                            |
| `server/plugins/compiler.ts`                                                                                               | Lets plugins written for `@getpaseo/plugin` build here                       |
| `server/services/forge-registry.ts`                                                                                        | GitLab is the only forge                                                     |
| `server/scripts/supervisor.ts`                                                                                             | `windowsHide` so Windows shows no daemon console window                      |
| `app/add-project-flow/options.ts`, `components/add-project-flow.tsx`                                                       | "Clone from GitLab" in place of GitHub                                       |
| `app/components/sidebar/sidebar-help-menu.tsx`, `community-links.tsx`, `changelog/.../changelog-source.ts`                 | No upstream links, no What's new request                                     |
| `app/components/add-host-method-modal.tsx`                                                                                 | No pairing-link option (it reaches the public relay)                         |
| `app/composer/input-mode.ts`                                                                                               | No dictation or voice mode                                                   |
| `app/screens/settings-screen.tsx`, `settings/host-page.tsx`, `settings/providers-section.tsx`, `settings/plugins-page.tsx` | No pairing, locked providers and terminal profiles, local-folder plugin text |
| `app/usage/queries.ts`                                                                                                     | Pinned usage re-reads on a timer (Wukong builds only)                        |

## Design decisions, and why

- **Egress guard** (`packages/server/src/wukong/egress-guard.ts`; everything named `wukong/...` in
  this section is under `packages/server/src/`): one hook on `net.Socket#connect` in the daemon
  process refuses non-loopback hosts unless allowlisted (`WUKONG_ALLOWED_HOSTS`, the GitLab host,
  the Devin hosts). It also refuses to listen anywhere but loopback. It covers whatever upstream
  adds later. It **does not cover** child processes (provider CLIs, `git`, `python-gitlab`,
  `npm`) or **third-party plugins**, which run in their own forked process (verified: one reached
  the internet). The bundled plugins run inside the daemon and are covered.
- **Providers:** removed from the registry, not merely disabled. Terminal profiles are fixed to
  Claude Code. The Providers page and Add provider catalog are hidden.
- **Plugins:** local folders only. npm, Git and registry sources are switched off because they run
  child processes the guard cannot see. A friendly error says so. Plugins written for Paseo still
  work: `wukong/plugin-sdk-alias.ts` maps `@getpaseo/plugin` to the local SDK name. The upstream
  scope there is written as `["@get", "paseo/plugin"].join("")` so the publish-time rename does not
  rewrite it; do not "simplify" it into one string (lint also rejects `"@get" + "paseo"`).
- **GitLab:** upstream's `createGitLabService` takes a `runner`. `gitlab/glab-runner.ts` answers
  the `glab` command lines that service issues with python-gitlab calls, so upstream's ~1400 lines
  of GitLab logic run unchanged and no `glab` executable exists to clash with a user's own.
  Contract tests drive upstream's service through it, so an upstream change to a command line fails
  a test instead of failing silently. Rebase merge is not supported. Configuration is
  `<home>/wukong.json` or `WUKONG_GITLAB_*`; the URL must be https.
- **Add project:** upstream's dialog is kept (search a directory, New directory). Its GitHub entry
  becomes Clone from GitLab, which opens the plugin screen with search, Clone and Fork clone
  (fork, wait, clone your fork, add `upstream`; shown for any project outside your namespace) and
  a progress dialog. **Open folder** pops the OS folder dialog from the daemon because a browser
  cannot learn a real path. Plugin RPCs time out after 30 s, so long jobs are start + poll.
- **Devin usage** (`plugins/wukong-devin-usage`): Devin has no public per-member quota API. The
  plugin makes the call the CLI's `/usage` makes (`GetUserStatus`, from the host in the CLI's own
  `credentials.toml`) and sends the key only to an allowlisted https host. The allowlist exists in
  two places that must agree: the plugin and `wukong/devin-hosts.ts` (a test checks). Reset is the
  first of the calendar month (UTC); `planEnd` is the contract end, not a cycle. A limit of 0
  shows as fully used. Forecast weather is projected month-end use against the limit.
- **Packaging:** `node wukong/scripts/pack-local.mjs --out <dir>` builds seven tarballs from the
  last commit in a throwaway folder (scope `@wukong`, brand applied, web UI built with
  `EXPO_PUBLIC_WUKONG=1`). Version is `<upstream core>-wukong.<timestamp>`; the app package keeps
  upstream's version because Expo rejects other forms. All seven must be installed together or npm
  fetches upstream packages and the guard's promise is gone.
- **Isolation from Paseo:** only a `wukong` binary (no `paseo`), home `~/.wukong` or
  `WUKONG_HOME`, port 6899, and the CLI ignores `PASEO_HOME`/`PASEO_HOST` inherited from a
  terminal opened inside Paseo.
- **Web UI:** served by the daemon, on by default. English only: Wukong's added strings are not in
  the translation tables, to keep i18n files untouched.

## Lessons that cost time (do not relearn them)

- `npm run typecheck:server` does **not** compile `packages/server/scripts/`. Also run
  `npx tsc -p packages/server/tsconfig.scripts.json --noEmit`, or packaging fails late.
- A "background task completed" notice means the shell command ended, not that it succeeded. Check
  the exit code and the output file, then install the tarballs into a temp prefix before reporting.
- A mocked test can hide a real bug: the guard blocked a bundled plugin and tests that only used
  loopback never saw it. For network or UI behaviour, run the real daemon (and a real browser for
  UI) in a temp home on another port.
- `fetch failed` hides the cause in `error.cause`; surface the code (certificate, refused, DNS).
- proto3 JSON omits zero values, so a missing number is zero.
- Windows: a detached process has no console, so child console programs open a window unless
  `windowsHide` is set; Git for Windows checks out CRLF (hash checks must ignore line endings);
  `npm` is a `.cmd` (needs a shell); path length limits (260) argue for short build folders;
  PowerShell redirection writes UTF-16.
- Shell: macOS `sed -i` needs `''`; zsh does not word-split `$VAR`; `npx oxlint` fails outside the
  repo root (config), so use the npm scripts.

## Before you commit or pack

Follow upstream's rules (`CLAUDE.md`: lint and typecheck after every change, **run only the test
files you changed**, never the whole suite, use the npm scripts for lint and format). Also:

1. `npm run lint`, `npm run format:check`, `npm run typecheck:server` (and the `tsc -p` above).
2. The Wukong tests you touched: `npx vitest run <file>` in `packages/server`, `packages/app` or
   `plugins`; `node --test "wukong/scripts/*.test.mjs"`.
3. `node wukong/scripts/upstream-footprint.mjs` if you touched an upstream file.
4. For anything user-visible, run it for real: temp home, own port, never `6767` (the main Paseo
   daemon; do not restart it) and not `6899` if someone is using it.
5. Packaging: `node wukong/scripts/pack-local.mjs --out ~/wukong-dist` (one batch only; it clears
   earlier tarballs there), then install them into a temp `--prefix` and run `wukong --version`.
6. Commit with a message that says why; push to `origin wukong`.

## Syncing with upstream: the SOP

**Cadence.** Weekly, and before every release. Do not let it drift past a month: the cost grows
with the gap. Reference points: the first sync (92 upstream commits) had 4 text conflicts and
took most of a day to check; a later one (13 commits, 100 files) merged clean and only one file
we touch had changed upstream.

**Who does what.** `wukong-sync-upstream.yml` (Mondays, or run it by hand) mirrors `main` to
upstream, merges upstream into `sync/upstream-<date>`, builds, runs the Wukong checks and opens a
PR, or opens an issue naming the conflicting files. A green PR is **not** a reviewed merge. The
workflow cannot judge the things in step 4; a person or agent must.

**Rules that never bend**

- Merge with a **merge commit**. Never rebase `wukong` onto upstream and never squash-merge a
  sync: either one erases the merge base and the next sync re-fights every old conflict.
- Merge in a throwaway branch or worktree, never straight into `wukong`. Nothing lands until
  step 5 passes. `wukong` stays unchanged until then, which is also the rollback.
- Never touch the Paseo daemon on port 6767, and keep test daemons on their own home and port.
- Take upstream's side, then re-apply our hook. Never "keep ours" for a whole upstream file.

**Steps**

1. **Look first.** `git fetch upstream --tags`, `git config rerere.enabled true`. See the size
   (`git log --oneline wukong..upstream/main`) and try the merge without making it:
   `git merge-tree --write-tree --name-only wukong upstream/main`. Clean prints a tree id and
   exits 0; conflicts list the files.
2. **Merge in a worktree.**
   `git worktree add -b sync/upstream-<date> ../wk-sync wukong && cd ../wk-sync && git merge upstream/main`.
3. **Resolve conflicts.** Take upstream's version of the file, then re-apply our hook: one to a few
   lines with a `Wukong:` marker (the table above says what each hook is for). If upstream moved
   or rewrote what a hook sat on (the forge registry, plugin loader, Add Project flow, usage), find
   the new place and go back down the ladder. Resolutions are remembered by rerere.
4. **Review what a clean merge can still get wrong.**
   - Hooks intact: `node wukong/scripts/upstream-footprint.mjs` passes, and the file count and
     `rg "Wukong:"` still match the table above. A lost marker means a lost hook.
   - Files we hook that upstream also changed:
     `comm -12 <(git diff --name-only <old-base> upstream/main | sort) <(git diff --name-only <old-base> wukong | sort)`.
     Read those diffs; they are where auto-merge is most likely to be wrong.
   - **New outbound traffic.** The guard stops the daemon, not the browser or child processes. In
     what upstream added: `git diff -U0 <old-base> upstream/main -- packages ':!packages/website' ':!*.test.*' ':!*.md' ':!packages/app/src/i18n' | rg '^\+' | rg -o 'https?://[^"` ]+|fetch\(|new WebSocket\('`.
     Look for new hosts, update checks, telemetry, relay, Hub, push, speech downloads, registries.
     Then load the built web UI in a browser against a temp daemon and confirm no request leaves
     localhost.
   - **New providers, built-in plugins, usage sources, forges.** Providers and bundled plugins are
     allowlists (`WUKONG_PROVIDER_IDS`, `WUKONG_BUILTIN_PLUGINS`), so new ones stay off; confirm
     they did, and that nothing new bypasses the allowlist or the `ForgeRegistry`.
   - **Contracts we lean on.** `glab-runner.test.ts` fails if upstream changes a `glab` command
     line it issues. Also read upstream's changes to the plugin SDK (`UsageSourceRegistration`,
     RPC timeouts), `usage/window-bar.tsx` (`runsOutAt`) and `usage/queries.ts`, the Add Project
     flow, `supervisor.ts` and the provider registry.
   - Version bump? Check `pack-local` and the app config still accept the new version form.
5. **Verify**, in the worktree: `node scripts/npm-retry.mjs ci --ignore-scripts`, `npm run postinstall`,
   `npm run build:server` (it also compiles `packages/server/scripts`), `npm run typecheck`,
   `npm run lint`, `npm run format:check`, `node --test "wukong/scripts/*.test.mjs"`, the Wukong
   tests (`packages/server`: `src/wukong`; `plugins`: `wukong-gitlab wukong-devin-usage`;
   `packages/app`: `src/wukong src/usage`), and the footprint script. Do not run the whole suite.
6. **Package and smoke test.** `node wukong/scripts/pack-local.mjs --out <dir>`, install the
   tarballs into a temp `--prefix`, then start that daemon on a temp home and port. Check:
   `wukong --version`; only `claude` and `devin` providers; `wukong-gitlab` and
   `wukong-devin-usage` loaded; no `Wukong blocked` line in `daemon.log` at startup; the page
   title is Wukong. Anything you changed by hand in step 3 gets a real run, not just tests.
7. **Land it.** Push the sync branch and merge it into `wukong` with a merge commit (PR, or a
   local `--no-ff` merge). Then fast-forward nothing else: `main` is the workflow's to mirror.
8. **Finish.** Tag the result (`wukong-<date>`, annotated, naming the upstream version), repack
   into `~/wukong-dist` with the same `pack-local` command, update the upstream-files table here
   if the footprint changed, and tell the team to update with `windows-update.ps1`.

**If it goes wrong.** More conflicts than expected, or upstream rewrote a subsystem we hook: stop,
leave `wukong` alone, and settle it in the worktree; never force-push. A build failure that is
upstream's own: fix it with the smallest marked change and consider sending it upstream. A step
you could not run goes into "Known gaps" below; do not report the sync as verified without it.

**What the workflow covers.** Steps 1, 2, most of 5 (brand tests, build, typecheck, lint, the
Wukong tests, the footprint check) and opening the PR or issue. It does not do 3, 4, 6, 7 or 8.

## Known gaps (as of this writing)

Not verified, so do not claim otherwise:

- No run against the real company GitLab (19.0). Auto-merge is the likeliest to break
  (python-gitlab only takes the older parameter). The 17-item acceptance checklist is in
  `docs/internal-edition.md` on the old `internal-edition` branch.
- Devin usage was checked against the real service only through a probe and the team's use;
  `GetUserStatus` is unofficial and may change.
- The GitHub workflows (publish, sync, the Windows job) have never run on GitHub; nothing has been
  published to npm. `wukong/scripts/disable-upstream-workflows.sh` has not been run.
- Third-party plugins are not covered by the guard (see above); only install ones you trust.
- Claude usage is off (upstream's `claude-usage-source` is not enabled).
- Settings has "Enable terminal agent hooks", which edits the user's agent config files. It is
  upstream's and installs hooks only when switched on (unset means off). Keep it off while Paseo
  is installed beside Wukong, or both write hooks into the same Claude config.

## Working agreements with the maintainer

- Say what was verified and what was not. Never present "tests pass" as "works" for behaviour you
  did not run. Report failures with the output.
- Confirm before anything outward-facing or hard to reverse: publishing to npm, changing GitHub
  repository settings, force-pushing, deleting someone's data. Pushing commits to `origin wukong`
  is routine.
- Reading a person's login token (Devin's `credentials.toml`, a Claude keychain entry) needs their
  say-so, and the token must never be printed or logged.
- Reply in the language the maintainer writes in (Chinese so far). The team's product UI is
  English.
- Keep the footprint small even for nice-to-haves. If a feature needs a bigger upstream change,
  say so and offer the alternative before building.
