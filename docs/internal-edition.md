# Internal edition

This fork, branded Wukong, runs only on company machines. It has no device pairing, Wukong itself sends nothing to cloud services, the only providers are Claude Code and Devin CLI, and the only git forge is the company's self-hosted GitLab.

To build the npm tarballs and install them, see [Wukong: build and install with npm](../README.md#wukong-build-and-install-with-npm).

## Where the policy lives

`packages/protocol/src/internal-edition.ts` holds every switch. The server, app, CLI, and desktop all read it, so this fork changes behavior in one place instead of patching each feature. Each site that enforces the policy has a comment starting with `Internal edition:`. Run `rg "INTERNAL_EDITION|Internal edition:"` to find them all when you merge upstream.

| Switch                                  | Value                 | Effect                                                                                                                 |
| --------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `INTERNAL_EDITION_ALLOWED_PROVIDER_IDS` | `["claude", "devin"]` | The daemon leaves every other provider out of the registry (built-in, plugin, custom)                                  |
| `INTERNAL_EDITION_ALLOWED_FORGE_IDS`    | `["gitlab"]`          | The daemon registers only the GitLab adapter, and only for the hosts in `forge.gitlab`; every other host is "no forge" |
| `pairingEnabled`                        | `false`               | Relay locked off; pairing UI, `paseo pair`, and `paseo daemon pair` removed                                            |
| `cloudServicesEnabled`                  | `false`               | Blocks every Paseo-initiated cloud request listed below                                                                |
| `customProvidersEnabled`                | `false`               | Hides "Add provider" in host settings                                                                                  |
| `loopbackOnly`                          | `true`                | Daemon and service proxy refuse any listen address outside loopback or a local socket                                  |
| `forgeRepositoryClone`                  | `true`                | Add Project and `paseo clone` use the GitLab forge RPCs instead of the GitHub ones                                     |

## Brand

`INTERNAL_EDITION_BRAND` in the same module holds the name, the CLI name, and the repository and upstream links. Only what a person sees uses the brand: UI copy in every locale, the logo, the web title and manifest, the CLI's `wukong` command, and the help and issue links. Code identifiers, `PASEO_*` env vars, `~/.paseo`, package names, and protocol names keep the upstream name, so upstream merges stay small. The `paseo` command still works as an alias.

The logo geometry lives in `packages/app/src/components/icons/wukong-logo-geometry.ts`; the logo component and the web splash mask both draw from it. Favicons drop the ears and use heavier strokes so the mark holds at 16 px.

When you merge upstream, new UI copy arrives with "Paseo" in it. Replace the brand name inside string values in `packages/app/src/i18n/resources/*.ts`, never in keys such as `inPaseo`.

## What is blocked

| Traffic                                             | Where it is enforced                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relay (`relay.paseo.sh`)                            | `packages/server/src/server/config.ts` forces `relayEnabled: false`, immutable                                                                                                    |
| Paseo Hub (`hub.paseo.sh`)                          | `DisabledHubRelationshipRemote` in `hub/relationship-remote.ts`                                                                                                                   |
| Expo push (`exp.host`)                              | `push/index.ts` drops deliveries                                                                                                                                                  |
| OpenAI speech                                       | `speech-config-resolver.ts` forces every speech feature to `local`                                                                                                                |
| Speech model downloads (GitHub)                     | `sherpa/model-downloader.ts` refuses to fetch                                                                                                                                     |
| Plugin installs from npm, Git, registry             | `plugins/managed-source/edition.ts`; local directories and `file:` Git still work                                                                                                 |
| Built-in plugins (usage sources, Antigravity, Muse) | `plugins/builtin/index.ts` starts none                                                                                                                                            |
| Public service URLs                                 | `config.ts` drops `serviceProxy.publicBaseUrl`                                                                                                                                    |
| Desktop auto-update feed                            | `packages/desktop/src/features/auto-updater.ts` reports no update                                                                                                                 |
| GitHub (`gh`, `git` clone of any URL)               | `services/github-service-disabled.ts` replaces the shared GitHub service; `session.ts` refuses `project.github.clone`; `websocket-server.ts` advertises no GitHub clone or search |
| Changelog (`raw.githubusercontent.com`)             | `changelog-source.ts` skips the fetch; "What's new" entries are hidden                                                                                                            |

## What is not blocked

- The agents themselves. Claude Code talks to Anthropic (or the endpoint you set in `ANTHROPIC_BASE_URL`) and Devin CLI talks to Cognition. Route them through your company gateway with each CLI's own settings or with `agents.providers.<id>.env`.
- `git` itself. It talks to whatever remote a repository has; only the forge features (pull request status, merge, search, clone shorthand) are limited to the configured GitLab.
- Links a person clicks, such as docs and issue links.
- Direct connections and SSH remote hosts. They reach a daemon you name; a remote daemon is still bound to its own loopback.

## Setting up Devin CLI

Install Devin CLI so `devin acp` works on `PATH`. Paseo launches `devin acp` and reads modes and models over ACP. To use a different binary, set the command in config.json:

```json
{ "agents": { "providers": { "devin": { "command": ["/opt/devin/bin/devin", "acp"] } } } }
```

An existing `devin` entry with `extends: "acp"` keeps working; its command and env now apply to the built-in provider.

## Setting up GitLab

Paseo reaches GitLab through the python-gitlab CLI (`gitlab`), because `glab` cannot be installed here. Paseo never stores a GitLab token and never puts one on a command line. python-gitlab owns the credentials.

### On each machine that runs a daemon

1. Install the CLI for the user that runs the daemon: `uv tool install python-gitlab`. The daemon looks for `gitlab` on the `PATH` it starts with, which for a desktop launcher is shorter than your shell's. Put `~/.local/bin` on it, or set `forge.gitlab.command` to an absolute path such as `["/home/dev/.local/bin/gitlab"]`.
2. Create a personal access token with the `api` scope. Merge, squash, create, and cancel auto-merge need write access.
3. Write `~/.python-gitlab.cfg`:

   ```ini
   [global]
   default = corp

   [corp]
   url = https://gitlab.corp.example
   private_token = helper: pass show gitlab/corp-token
   ssl_verify = /etc/ssl/certs/corp-ca.pem
   ```

   - `url` is required in the section even though Paseo passes its own URL.
   - Keep the token out of the file with `helper:`, which runs the command with no terminal. A plain `private_token = glpat-...` also works. `GITLAB_PRIVATE_TOKEN` in the daemon's environment works too.
   - `ssl_verify` takes `true`, `false`, or a CA bundle path. Use the path for a private CA.
   - Set `forge.gitlab.configSection`, or make the `[global] default` section the company GitLab. Without `-g`, python-gitlab sends the default section's token to the configured URL.

4. Check it: `gitlab current-user get` prints your user as JSON.
5. Tell the daemon where GitLab is, in `$PASEO_HOME/config.json`:

   ```json
   {
     "forge": {
       "gitlab": {
         "url": "https://gitlab.corp.example",
         "sshHost": "gitlab.corp.example:2222",
         "configSection": "corp"
       }
     }
   }
   ```

   | Field           | Required | Meaning                                                                                                |
   | --------------- | -------- | ------------------------------------------------------------------------------------------------------ |
   | `url`           | yes      | `https` URL of GitLab. A sub-path such as `https://host/gitlab` works.                                 |
   | `sshHost`       | no       | `host` or `host:port` for SSH remotes and clone URLs. Defaults to the host of `url`.                   |
   | `configSection` | no       | python-gitlab section to read the token from (`--gitlab`).                                             |
   | `command`       | no       | Command that starts python-gitlab, `["gitlab"]` by default. Extra entries go before the Paseo options. |

   An invalid value stops the daemon at load with the field named. Without `forge.gitlab`, no forge resolves.

Only the hosts in `url` and `sshHost` are forge hosts. GitHub, gitlab.com, Gitea, Forgejo, Codeberg, and every other host resolve to no forge, and Paseo makes no request to them. An SSH alias in `~/.ssh/config` resolves through `ssh -G`.

### Behavior to know

- Merge and squash only. Squash sets the merge request's squash flag, then merges. If the merge fails, the flag stays set. Rebase is rejected by the daemon and hidden in the app.
- No background polling. The refresh button in the pull request pane reads status again. One status read runs about five CLI invocations at roughly 0.4 s startup each.
- Add Project searches `project list --membership` and clones `group/sub/project` shorthand to `https://<url>/<path>.git`, or to SSH when `sshHost` is set (`ssh://git@host:port/<path>.git` with a port). Full URLs are cloned only when their host is the configured one.
- python-gitlab reads an option value that starts with `@` from that file. Paseo doubles a leading `@`, so a title or branch name never reads a local file.
- The pipeline for a merge request is its newest one, read from the project the pipeline reports, so fork and detached pipelines show their jobs.

### Acceptance checklist for GitLab 19.0

The adapter was built and tested against recorded REST shapes and a local fake server, not a 19.0 instance. Run these on the company network before relying on it.

1. `gitlab --version` and `gitlab current-user get` work as the daemon's user, from the environment the daemon starts in (desktop launcher, not only a shell).
2. A checkout whose `origin` is on the configured host shows its merge request in the pull request pane: title, state, checks, approvals.
3. `gitlab -o json project-merge-request get --project-id <group/project> --iid <n>` includes `detailed_merge_status`, `head_pipeline`, `references.full`, `blocking_discussions_resolved`, `has_conflicts`, `draft`, and `squash`. The adapter reads `detailed_merge_status` first and falls back to `merge_status` only when it is absent.
4. The same response carries `auto_merge_enabled` or `merge_when_pipeline_succeeds`. The adapter prefers the first.
5. Enable auto-merge on a merge request with a running pipeline. python-gitlab's `merge` offers only `--merge-when-pipeline-succeeds`, the parameter GitLab is deprecating in favor of `auto_merge`. Confirm GitLab 19.0 still accepts it and the merge request shows auto-merge afterward. If it does not, upgrade python-gitlab or tell the maintainers; the CLI has no way to send `auto_merge`.
6. Cancel auto-merge from the app; the merge request leaves the auto-merge state.
7. Squash merge a mergeable request: the squash flag is set, then the merge lands as one commit. Boolean options reach GitLab as the strings `"true"` and `"false"`; confirm 19.0 accepts them.
8. Direct merge (merge commit) works, and the app refuses it while GitLab reports the request as not mergeable.
9. A merge request from a fork shows its pipeline jobs. The jobs are read from the project the pipeline reports.
10. The timeline lists discussions, resolved state, and diff positions.
11. The approvals endpoint answers or fails quietly; approval counts fall back to zero.
12. Search finds issues and merge requests. Issue links open at `/-/work_items/<n>` or `/-/issues/<n>`.
13. Add Project lists your projects, filters by search text, and clones by shorthand over SSH (with and without a port in `sshHost`) and by HTTPS. A GitHub URL is refused.
14. A private CA works through `ssl_verify` in the section, with no change to Paseo.
15. A token supplied by `helper:` works with the daemon, which has no terminal.
16. Create a merge request from Paseo with a title that starts with `@` and a description that is empty or starts with `-`. The text arrives literally.
17. With the CLI missing, the pull request pane says to run `uv tool install python-gitlab`. With a bad token, it reports an authentication failure.

## Publishing to npm

`.github/workflows/publish-wukong.yml` publishes every push to `internal-edition`. It verifies first (typecheck, lint, format, and the edition tests), then packs the seven packages, installs them together as a smoke test, and publishes them in dependency order. It does nothing until you set `NPM_SCOPE`.

The packages are named `@getpaseo/*` in source, and you cannot publish under that scope. The workflow rewrites the scope to yours in its own checkout with `scripts/rename-npm-scope.mjs` before it installs, so the committed source stays identical to upstream and merges stay small. Never commit the rewritten tree.

Each build publishes `<upstream version without prerelease>-wukong.<run number>`, for example `0.11.0-wukong.58`, on the `latest` tag. A re-run of a half-finished release skips packages that already exist at that version. The run number does not reset on a re-run, but it does restart at 1 if you delete and recreate the workflow; set the version suffix by hand then, because a registry refuses to overwrite a published version.

### What you need

| Setting        | Where                                   | Value                                                                                                                           |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `NPM_SCOPE`    | Repository variable                     | Your scope without the `@`. Required. Published names become `@<scope>/cli`, `@<scope>/server`, and so on.                      |
| `NPM_REGISTRY` | Repository variable                     | Defaults to `https://registry.npmjs.org`. For GitHub Packages use `https://npm.pkg.github.com`.                                 |
| `NPM_ACCESS`   | Repository variable                     | `restricted` (default) or `public`. npm needs a paid organization for `restricted` scoped packages. GitHub Packages ignores it. |
| `NPM_TOKEN`    | Secret in the `npm-publish` environment | A token that may publish to the scope. Not needed for GitHub Packages, which accepts the workflow's own token.                  |

Create the `npm-publish` environment under Settings → Environments. Put `NPM_TOKEN` there, and add required reviewers if a person should approve each release.

Pick one registry:

- **GitHub Packages.** No extra account and no secret. The scope must equal the repository owner, lowercase. A person installing needs a token with `read:packages`, even for a public package.
- **npmjs.com.** Needs an npm organization that owns the scope and a granular access token with publish permission. Public packages publish the company edition to everyone.
- **An internal registry** such as Nexus or Artifactory. GitHub-hosted runners reach only the internet, so you need a self-hosted runner that can reach the registry: change `runs-on` in the `publish` job, and set `NPM_REGISTRY` and `NPM_TOKEN`. The server tarball is about 15 MB; raise the registry's upload limit above 20 MB, because a registry that rejects it with `413` leaves the release half published (Verdaccio's default is 10 MB).

### Before the first release

1. Set the variables and the secret above.
2. Disable the upstream workflows you do not use under Actions. Several trigger on `v*` tags or on `main`, and need Cloudflare, Apple, Expo, or Docker credentials this fork does not have. The Wukong workflow never creates a `v*` tag; do not tag this branch with one.
3. Run the workflow by hand with `dry_run` on. It builds, smoke-tests the tarballs, and runs `npm publish --dry-run` without publishing.

### Installing from the registry

Point the scope at the registry, then install the CLI. Its dependencies come from the same scope.

```bash
npm config set @<scope>:registry https://npm.pkg.github.com   # or your registry
npm install -g @<scope>/cli
```

## Provisioning speech models

Dictation and voice use local models only, and the daemon does not download them. Copy the model directories into `$PASEO_HOME/models/local-speech` (or the directory in `PASEO_LOCAL_MODELS_DIR`) before turning those features on.

## Licensing

Wukong is built on Paseo, which is Apache-2.0. Keep `LICENSE` in every copy you distribute, keep the upstream copyright line, and keep the `Internal edition:` comments, which mark the files this fork changed (Apache-2.0 §4(b)). The license grants no right to the Paseo name or logo (§6), which is why user-visible branding is Wukong. Settings → About credits Paseo and its license. "Wukong" is a common name (for example _Black Myth: Wukong_); have legal check it before any release outside the company.
