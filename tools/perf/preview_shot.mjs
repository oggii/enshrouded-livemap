// Screenshot of a local HTML file: node preview_shot.mjs <file.html> <out.png>
import { chromium } from "playwright-core";
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { pathToFileURL } from "node:url";
const [file, out] = process.argv.slice(2);
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const dir = fs.readdirSync(root).filter(d => d.startsWith("chromium-")).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, dir, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 360 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.resolve(file)).href);
await page.waitForFunction(() => document.title === "ready", null, { timeout: 15000 });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
