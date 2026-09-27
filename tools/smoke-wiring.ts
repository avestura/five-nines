// Regression: wiring Fans straight to a database must be refused with a
// message, and no wire is added. Needs `npm run preview` on :5199.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await page.click('.sheet');
await page.click('.modal .btn.primary');
const v = await page.evaluate(() => { const r = document.querySelector('.board canvas')!.getBoundingClientRect(); const s = Math.min(r.width / 1152, r.height / 672); return { l: r.left + (r.width - 1152 * s) / 2, t: r.top + (r.height - 672 * s) / 2, s }; });
const W = (x: number, y: number) => [v.l + x * v.s, v.t + y * v.s] as const;
const box = await (await page.$$('.part'))[1].boundingBox();
await page.mouse.move(box!.x + 20, box!.y + 20); await page.mouse.down(); await page.mouse.move(...W(600, 336), { steps: 6 }); await page.mouse.up();
await page.mouse.move(...W(138, 336)); await page.mouse.down(); await page.mouse.move(...W(600, 336), { steps: 6 }); await page.mouse.up();
const banner = await page.$eval('.banner', (e) => (e as HTMLElement).style.display + ' | ' + e.textContent);
console.log('banner:', banner);
const wires = await page.evaluate(() => document.querySelector('.banner')!.textContent!.includes('cannot wire'));
console.log(wires ? 'refused: ok' : 'NOT REFUSED');
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
await browser.close();
