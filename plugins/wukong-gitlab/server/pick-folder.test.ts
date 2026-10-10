import { describe, expect, it } from "vitest";

import {
  folderDialogCommands,
  parseDialogOutput,
  pickFolder,
  windowsDialogScript,
} from "./pick-folder.js";

describe("folderDialogCommands", () => {
  it("uses the Explorer folder dialog on Windows through an encoded PowerShell script", () => {
    const [command] = folderDialogCommands("win32", "Pick it");
    expect(command?.file).toBe("powershell.exe");
    expect(command?.args).toEqual(
      expect.arrayContaining(["-NoProfile", "-STA", "-EncodedCommand"]),
    );
    const encoded = command?.args.at(-1) ?? "";
    expect(Buffer.from(encoded, "base64").toString("utf16le")).toContain("FolderBrowserDialog");
  });

  it("quotes a title with an apostrophe in the PowerShell script", () => {
    expect(windowsDialogScript("Bob's folder")).toContain("'Bob''s folder'");
  });

  it("uses Finder's chooser on macOS and escapes the title", () => {
    const [command] = folderDialogCommands("darwin", 'Say "hi"');
    expect(command?.file).toBe("osascript");
    expect(command?.args[1]).toContain('prompt "Say \\"hi\\""');
  });

  it("tries zenity, then kdialog, on Linux", () => {
    expect(folderDialogCommands("linux", "t").map((command) => command.file)).toEqual([
      "zenity",
      "kdialog",
    ]);
  });
});

describe("parseDialogOutput", () => {
  it("treats empty output as a cancelled dialog", () => {
    expect(parseDialogOutput("", "win32")).toBeNull();
    expect(parseDialogOutput("\n", "linux")).toBeNull();
  });

  it("keeps a Windows path as printed and trims macOS's trailing slash", () => {
    expect(parseDialogOutput("C:\\Users\\me\\proj", "win32")).toBe("C:\\Users\\me\\proj");
    expect(parseDialogOutput("/Users/me/proj/\n", "darwin")).toBe("/Users/me/proj");
    expect(parseDialogOutput("/\n", "darwin")).toBe("/");
  });
});

describe("pickFolder", () => {
  it("returns the chosen path", async () => {
    const path = await pickFolder("t", "win32", async () => ({
      stdout: "D:\\work\\app",
      code: 0,
      missing: false,
    }));
    expect(path).toBe("D:\\work\\app");
  });

  it("returns null when the user cancels", async () => {
    expect(
      await pickFolder("t", "darwin", async () => ({ stdout: "", code: 1, missing: false })),
    ).toBeNull();
  });

  it("falls through to the next Linux dialog when the first is not installed", async () => {
    const tried: string[] = [];
    const path = await pickFolder("t", "linux", async (file) => {
      tried.push(file);
      return file === "zenity"
        ? { stdout: "", code: "ENOENT", missing: true }
        : { stdout: "/home/me/p\n", code: 0, missing: false };
    });
    expect(tried).toEqual(["zenity", "kdialog"]);
    expect(path).toBe("/home/me/p");
  });

  it("says what to install when no Linux dialog exists", async () => {
    await expect(
      pickFolder("t", "linux", async () => ({ stdout: "", code: "ENOENT", missing: true })),
    ).rejects.toThrow(/zenity or kdialog/);
  });
});
