// Plays level 1.1 from scratch with real mouse input: drag parts from the
// tray, wire port to node, run, and expect an APPROVED stamp.
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://localhost:5199/';
const OUT = process.env.OUT ?? '.';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await page.click('.sheet');
await page.click('.modal .btn.primary');

const view = await page.evaluate(() => {
  const r = document.querySelector('.board canvas')!.getBoundingClientRect();
  const s = Math.min(r.width / 1152, r.height / 672);
  return { left: r.left, top: r.top, s, ox: (r.width - 1152 * s) / 2, oy: (r.height - 672 * s) / 2 };
});
const W = (x: number, y: number) => ({ x: view.left + view.ox + x * view.s, y: view.top + view.oy + y * view.s });

async function dragFromTray(i: number, x: number, y: number) {
  const box = await (await page.$$('.part'))[i].boundingBox();
  await page.mouse.move(box!.x + 20, box!.y + 20);
  await page.mouse.down();
  const p = W(x, y);
  await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.up();
}
async function wire(fx: number, fy: number, tx: number, ty: number) {
  const a = W(fx + 42, fy); // port on the right edge
  const b = W(tx, ty);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

await dragFromTray(0, 480, 336); // web
await dragFromTray(1, 816, 336); // db
await wire(96, 336, 480, 336); // fans -> web
await wire(480, 336, 816, 336); // web -> db
await page.mouse.click(10, 10);
await page.screenshot({ path: `${OUT}/10-edit.png` });
const counts = await page.evaluate(() => document.querySelectorAll('.part .meta').length);
console.log('tray items', counts);
await page.evaluate(() => {
  ([...document.querySelectorAll('.speed button')].find((x) => x.textContent === 'x4') as HTMLButtonElement).click();
});
await page.keyboard.press('Space');
await page.waitForSelector('.bigstamp', { timeout: 30000 });
console.log('result:', await page.$eval('.bigstamp', (e) => e.textContent));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
