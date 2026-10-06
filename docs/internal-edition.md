# Internal edition

This fork runs only on company machines. It has no device pairing, Paseo itself sends nothing to cloud services, and the only providers are Claude Code and Devin CLI.

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

## What is blocked

| Traffic                                             | Where it is enforced                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| Relay (`relay.paseo.sh`)                            | `packages/server/src/server/config.ts` forces `relayEnabled: false`, immutable    |
| Paseo Hub (`hub.paseo.sh`)                          | `DisabledHubRelationshipRemote` in `hub/relationship-remote.ts`                   |
| Expo push (`exp.host`)                              | `push/index.ts` drops deliveries                                                  |
| OpenAI speech                                       | `speech-config-resolver.ts` forces every speech feature to `local`                |
| Speech model downloads (GitHub)                     | `sherpa/model-downloader.ts` refuses to fetch                                     |
| Plugin installs from npm, Git, registry             | `plugins/managed-source/edition.ts`; local directories and `file:` Git still work |
| Built-in plugins (usage sources, Antigravity, Muse) | `plugins/builtin/index.ts` starts none                                            |
| Public service URLs                                 | `config.ts` drops `serviceProxy.publicBaseUrl`                                    |
| Desktop auto-update feed                            | `packages/desktop/src/features/auto-updater.ts` reports no update                 |
| Changelog (`raw.githubusercontent.com`)             | `changelog-source.ts` skips the fetch; "What's new" entries are hidden            |

## What is not blocked

- The agents themselves. Claude Code talks to Anthropic (or the endpoint you set in `ANTHROPIC_BASE_URL`) and Devin CLI talks to Cognition. Route them through your company gateway with each CLI's own settings or with `agents.providers.<id>.env`.
- Git forge features. They run `git` and `gh` against whatever remote the repository uses.
- Links a person clicks, such as docs and issue links.
- Direct connections and SSH remote hosts. They reach a daemon you name; a remote daemon is still bound to its own loopback.

## Setting up Devin CLI

Install Devin CLI so `devin acp` works on `PATH`. Paseo launches `devin acp` and reads modes and models over ACP. To use a different binary, set the command in config.json:

```json
{ "agents": { "providers": { "devin": { "command": ["/opt/devin/bin/devin", "acp"] } } } }
```

An existing `devin` entry with `extends: "acp"` keeps working; its command and env now apply to the built-in provider.

## Provisioning speech models

Dictation and voice use local models only, and the daemon does not download them. Copy the model directories into `$PASEO_HOME/models/local-speech` (or the directory in `PASEO_LOCAL_MODELS_DIR`) before turning those features on.

## Licensing

Paseo is Apache-2.0. Keep `LICENSE` in every copy you distribute, keep the upstream copyright line, and keep the `Internal edition:` comments, which mark the files this fork changed (Apache-2.0 §4(b)). The license grants no right to the Paseo name or logo (§6); rebrand before you ship builds outside the company.
