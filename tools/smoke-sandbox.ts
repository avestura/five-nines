// Opens the sandbox (unlocking it first), places a web server with a hotkey,
// wires Fans to it, runs, kills it from the chaos panel.
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE ?? 'http://localhost:5199/';
const OUT = process.env.OUT ?? '.';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.setItem('five-nines-v1', JSON.stringify({ stars: { '1-1': 1, '1-2': 1, '1-3': 1, '1-4': 1, '1-5': 1 }, designs: {}, seenCards: [], naming: 'aws', muted: true })));
await page.reload({ waitUntil: 'networkidle0' });
await page.screenshot({ path: `${OUT}/20-map-unlocked.png` });
await page.evaluate(() => ([...document.querySelectorAll('button')].find((b) => b.textContent === 'Sandbox') as HTMLButtonElement).click());
await page.click('.modal .btn.primary');
const v = await page.evaluate(() => {
  const r = document.querySelector('.board canvas')!.getBoundingClientRect();
  const s = Math.min(r.width / 1152, r.height / 672);
  return { left: r.left + (r.width - 1152 * s) / 2, top: r.top + (r.height - 672 * s) / 2, s };
});
const W = (x: number, y: number) => [v.left + x * v.s, v.top + y * v.s] as const;
await page.mouse.move(...W(480, 336));
await page.keyboard.press('1'); // web at pointer
await page.mouse.move(...W(96 + 42, 336));
await page.mouse.down();
await page.mouse.move(...W(480, 336), { steps: 6 });
await page.mouse.up();
await page.keyboard.press('Space');
await new Promise((r) => setTimeout(r, 1500));
await page.mouse.click(...W(480, 336));
await page.evaluate(() => ([...document.querySelectorAll('.sandbox button')].find((b) => b.textContent === 'Kill') as HTMLButtonElement).click());
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}/21-sandbox.png` });
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
