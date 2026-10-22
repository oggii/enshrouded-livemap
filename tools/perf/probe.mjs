// Opens the page in a given browser at a given device scale factor and reports what the page
// drew plus every console message. Usage: node probe.mjs <url> [--chrome <exe>] [--dpr 1.25]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const url = args.find(a => a.startsWith("http"));
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const dpr = Number(opt("--dpr", 1));
let exe = opt("--chrome", process.env.CHROME_PATH);
if (!exe) {
  const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  const d = fs.readdirSync(root).filter(x => /^chromium-\d+$/.test(x)).sort().pop();
  exe = path.join(root, d, "chrome-win64", "chrome.exe");
}
const browser = await chromium.launch({ executablePath: exe, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr });
const page = await context.newPage();
const messages = [];
page.on("console", m => messages.push(m.type() + ": " + m.text()));
page.on("pageerror", e => messages.push("pageerror: " + e.message));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const r = await page.evaluate(() => {
  const lm = window.livemap;
  const c = document.querySelector(".poi-canvas");
  return {
    hits: lm && lm.poiLayer._hits.n, zoom: lm && lm.map.getZoom(), zooming: lm && lm.poiLayer._zooming,
    pending: lm && lm.poiLayer._pending, canvas: c && [c.width, c.height, c.style.width, c.style.opacity, c.style.transform],
    checked: [...document.querySelectorAll("#poiList input")].filter(b => b.checked).length,
    dpr: window.devicePixelRatio, ua: navigator.userAgent.slice(0, 80),
  };
});
console.log(JSON.stringify(r, null, 1));
console.log("console:", messages.length ? messages : "(none)");
await page.screenshot({ path: path.join(os.tmpdir(), "livemap-probe.png") });
console.log("screenshot", path.join(os.tmpdir(), "livemap-probe.png"));
await browser.close();
