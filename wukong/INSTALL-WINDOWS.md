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

Give Wukong its own folder and port, so it does not mix with a Paseo you may already run (Paseo
uses port 6767):

```powershell
$wukongHome = "$env:USERPROFILE\.wukong"
New-Item -ItemType Directory -Force $wukongHome | Out-Null
'{"version":1,"daemon":{"listen":"127.0.0.1:6899"}}' | Set-Content -Encoding ascii "$wukongHome\config.json"
wukong daemon start --home $wukongHome
```

Open **http://127.0.0.1:6899** in a browser.

Other commands (always pass the same `--home`):

```powershell
wukong daemon status --home $wukongHome
wukong daemon stop --home $wukongHome
```

The log is `%USERPROFILE%\.wukong\daemon.log`.

## Connect GitLab (optional)

Create `%USERPROFILE%\.wukong\wukong.json`. Escape backslashes in JSON:

```json
{
  "gitlab": {
    "url": "https://gitlab.your-company.com",
    "configSection": "your-python-gitlab-section",
    "cloneRoot": "D:\\projects"
  }
}
```

Then stop and start the daemon again. `configSection` is the section name in your
`.python-gitlab.cfg`; leave it out to use the default section.

## What to try

1. **Open folder.** Add project, then **Open folder**: the Windows folder dialog should appear.
   If it does not, look for it behind the browser window.
2. **Search for directory.** Add project, then **Search for directory**, and type a path such as
   `D:\`.
3. **A Claude Code agent.** Open a project, start a chat, send a message.
4. **A terminal.** Open a terminal in a workspace; the profile list should offer Claude Code only.
5. **GitLab** (after the step above). Add project, then **Clone from GitLab**; search, clone, and
   the project opens.
6. **Settings.** There should be no Pair device section, no Usage section, and the Providers page
   should list only Claude and Devin CLI.

If something fails, send the text of the error and the last lines of
`%USERPROFILE%\.wukong\daemon.log`.

## Update or remove

To update, run the same install command with the newer tarballs, then restart the daemon.

```powershell
npm uninstall -g @wukong/cli @wukong/server @wukong/client @wukong/protocol @wukong/relay @wukong/plugin @wukong/highlight
```
