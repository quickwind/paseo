# Installing Wukong on Windows

Wukong is installed from seven npm tarballs (`wukong-*.tgz`). They must be installed together.

## Before you start

- **Node.js 22 or newer** (`node --version`).
- **Git for Windows** (`git --version`).
- **Claude Code** installed and signed in (`claude --version`). Devin CLI is optional.
- **python-gitlab**, only if you want GitLab search, clone and merge requests:
  `pip install python-gitlab` (or `uv tool install python-gitlab`), then set up
  `%USERPROFILE%\.python-gitlab.cfg` as you normally would.

## Build the tarballs yourself (optional)

Instead of receiving the files, build them from the repository:

```powershell
git clone -b wukong https://github.com/quickwind/wukong.git
cd wukong
node wukong/scripts/pack-local.mjs --out ..\wukong-dist
```

This takes about ten minutes the first time and leaves the seven `wukong-*.tgz` files in
`..\wukong-dist`. Commit first if you changed anything: only committed work is built.

## Install

Open PowerShell in the folder that holds the seven `.tgz` files.

```powershell
$env:ONNXRUNTIME_NODE_INSTALL = "skip"   # skips a large voice download Wukong does not use
$files = (Get-ChildItem .\wukong-*.tgz).FullName
npm install -g $files
wukong --version
```

`wukong --version` should print `0.11.2-wukong.<number>`.

## First run

```powershell
wukong daemon start
```

Open **http://127.0.0.1:6899** in a browser.

Wukong keeps to itself, so it can sit next to a Paseo you already run:

- the command is `wukong` (it does not install a `paseo` command);
- its data lives in `%USERPROFILE%\.wukong` (Paseo uses `%USERPROFILE%\.paseo`);
- it listens on port 6899 (Paseo uses 6767).
- it ignores the `PASEO_HOME` and `PASEO_HOST` variables that a terminal opened inside Paseo
  carries, so it never talks to Paseo's daemon by accident. To use another folder, set
  `WUKONG_HOME` (or pass `--home`).

Other commands:

```powershell
wukong daemon status
wukong daemon stop
```

The log is `%USERPROFILE%\.wukong\daemon.log`.

## Connect GitLab (optional)

Two files, both in your user folder.

**1. `%USERPROFILE%\.python-gitlab.cfg`**: python-gitlab's own settings, with your token. Wukong
never sees the token.

```ini
[global]
default = corp

[corp]
url = https://gitlab.your-company.com
private_token = <your personal access token, scope: api>
api_version = 4
```

Check it works before going further: `gitlab -g corp current-user get` should print your user.

**2. `%USERPROFILE%\.wukong\wukong.json`**: tells Wukong which GitLab and which section.
Escape backslashes in JSON.

```json
{
  "gitlab": {
    "url": "https://gitlab.your-company.com",
    "configSection": "corp",
    "cloneRoot": "D:\\projects"
  }
}
```

- `url` must be https and the same server as in `.python-gitlab.cfg`.
- `configSection` is the section name above; leave it out to use `[global] default`.
- `cloneRoot` is where "Clone from GitLab" puts projects (default `%USERPROFILE%\projects`).
- `sshHost` (optional, `host` or `host:port`) clones over ssh instead of https.

Then run `wukong daemon stop` and `wukong daemon start`. The file may be saved with or without a
byte order mark.

## What to try

1. **Open folder.** Add project, then **Open folder**: the Windows folder dialog should appear.
   If nothing appears, open `%USERPROFILE%\.wukong\daemon.log` and look for lines starting with
   `[wukong-gitlab] folder dialog`: they say whether the dialog was started and how it ended.
2. **Search for directory.** Add project, then **Search for directory**, and type a path such as
   `D:\`.
3. **A Claude Code agent.** Open a project, start a chat, send a message.
4. **A terminal.** Open a terminal in a workspace; the profile list should offer Claude Code only.
5. **GitLab** (after the step above). Add project, then **Clone from GitLab**; search, clone, and
   the project opens. A team (group) project also has a **Fork clone** button: it forks the project
   into your own namespace, waits for GitLab to build the fork, clones your fork, and adds an
   `upstream` remote that points at the original. If you already have a fork it is reused.
6. **Settings.** There should be no Pair device section, no Usage section, and the Providers page
   should list only Claude and Devin CLI.

If something fails, send the text of the error and the last lines of
`%USERPROFILE%\.wukong\daemon.log`.

## Update or remove

To update, run the same install command with the newer tarballs, then restart the daemon.

```powershell
npm uninstall -g @wukong/cli @wukong/server @wukong/client @wukong/protocol @wukong/relay @wukong/plugin @wukong/highlight
```
