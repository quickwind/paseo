// The system folder dialog, shown on the machine the daemon runs on. Wukong's daemon listens on
// loopback only, so that is the machine the user is sitting at. Windows uses the Explorer folder
// dialog, macOS the Finder one, Linux zenity or kdialog.

import { execFile } from "node:child_process";

const DIALOG_TIMEOUT_MS = 10 * 60 * 1000;

export interface DialogCommand {
  file: string;
  args: string[];
}

export function windowsDialogScript(title: string): string {
  const quoted = title.replaceAll("'", "''");
  return [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    // A topmost, invisible owner keeps the dialog in front of the browser window.
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.TopMost = $true",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    `$dialog.Description = '${quoted}'`,
    "$dialog.ShowNewFolderButton = $true",
    "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
  ].join("; ");
}

/** The commands to try, in order, for a platform. The first one that exists is used. */
export function folderDialogCommands(platform: NodeJS.Platform, title: string): DialogCommand[] {
  if (platform === "win32") {
    const encoded = Buffer.from(windowsDialogScript(title), "utf16le").toString("base64");
    return [
      {
        file: "powershell.exe",
        // -WindowStyle Hidden hides only PowerShell's own console, not the folder dialog.
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-STA",
          "-WindowStyle",
          "Hidden",
          "-EncodedCommand",
          encoded,
        ],
      },
    ];
  }
  if (platform === "darwin") {
    const prompt = title.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    return [
      {
        file: "osascript",
        args: ["-e", `POSIX path of (choose folder with prompt "${prompt}")`],
      },
    ];
  }
  return [
    { file: "zenity", args: ["--file-selection", "--directory", `--title=${title}`] },
    { file: "kdialog", args: ["--getexistingdirectory", ".", "--title", title] },
  ];
}

/** Dialog output to a path: trims the newline, drops macOS's trailing slash, empty means cancel. */
export function parseDialogOutput(stdout: string, platform: NodeJS.Platform): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const isRoot = trimmed === "/" || /^[A-Za-z]:[\\/]?$/u.test(trimmed);
  return !isRoot && platform === "darwin" ? trimmed.replace(/\/+$/u, "") : trimmed;
}

type Exec = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; code: number | string | null; missing: boolean }>;

const defaultExec: Exec = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      // No windowsHide: on Windows it hides the dialog's window as well as the console.
      { timeout: DIALOG_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const code = (error as NodeJS.ErrnoException | null)?.code ?? null;
        resolve({ stdout, code, missing: code === "ENOENT" });
      },
    );
  });

export async function pickFolder(
  title = "Choose a folder",
  platform: NodeJS.Platform = process.platform,
  exec: Exec = defaultExec,
): Promise<string | null> {
  for (const command of folderDialogCommands(platform, title)) {
    const result = await exec(command.file, command.args);
    if (result.missing) continue;
    // Cancelling exits non-zero (osascript, zenity) or prints nothing (PowerShell).
    return parseDialogOutput(result.stdout, platform);
  }
  throw new Error(
    platform === "linux"
      ? "No folder dialog is available. Install zenity or kdialog."
      : "The system folder dialog could not be started.",
  );
}
