// Browser smoke test: loads the built game, plays a level with its reference
// design through the real UI, and saves screenshots. Needs `npm run preview`.
import puppeteer from 'puppeteer-core';
import { LEVELS } from '../src/levels';
import { encodeDesign } from '../src/share';

const BASE = process.env.BASE ?? 'http://localhost:5199/';
const OUT = process.env.OUT ?? '.';
const id = process.argv[2] ?? '1-2';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const level = LEVELS.find((l) => l.id === id)!;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.screenshot({ path: `${OUT}/01-map.png` });

await page.goto(`${BASE}#L=${id}&d=${encodeDesign(level.reference)}`, { waitUntil: 'networkidle0' });
await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/02-intro.png` });
await page.click('.modal .btn.primary');
await page.screenshot({ path: `${OUT}/03-build.png` });

// x4, run
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.speed button')].find((x) => x.textContent === 'x4') as HTMLButtonElement;
  b.click();
});
await page.keyboard.press('Space');
await new Promise((r) => setTimeout(r, (level.duration * 1000) / 8));
await page.screenshot({ path: `${OUT}/04-run.png` });
await page.waitForSelector('.bigstamp', { timeout: level.duration * 1000 });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: `${OUT}/05-debrief.png`, fullPage: false });
const stamp = await page.$eval('.bigstamp', (e) => e.textContent);
console.log('result:', stamp);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
