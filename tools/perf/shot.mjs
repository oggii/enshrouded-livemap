// Screenshot of the map at a given view: node shot.mjs <url> <lat> <lng> <zoom> <out.png>
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const [url, lat, lng, zoom, out] = process.argv.slice(2);
const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
const dir = fs.readdirSync(root).filter(d => d.startsWith("chromium-")).sort().pop();
const exe = ["chrome-win64", "chrome-win"].map(s => path.join(root, dir, s, "chrome.exe")).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url);
await page.waitForTimeout(5000);
const info = await page.evaluate(([la, ln, z]) => {
  const L = window.livemap;
  for (const cb of document.querySelectorAll("input[type=checkbox]")) {
    const t = cb.parentElement.textContent;
    if (/wooden|flint|looted chests/i.test(t) && !/hide/i.test(t) && !cb.checked) cb.click();
  }
  L.map.setView([la, ln], z, { animate: false });
  return new Promise(r => setTimeout(() => {
    L.poiLayer._draw();
    const rows = [...document.querySelectorAll("input[type=checkbox]")].map(cb => cb.parentElement.textContent.trim())
      .filter(t => /flint|wooden|looted/i.test(t));
    const h = L.poiLayer._hits, near = [];
    for (let i = 0; i < h.n; i++) near.push(h.p ? h.p[i] && h.p[i][4] : i);
    r({ rows, hits: h.n, labels: near.slice(0, 8) });
  }, 1000));
}, [Number(lat), Number(lng), Number(zoom)]);
console.log(JSON.stringify(info));
await page.screenshot({ path: out });
await browser.close();
