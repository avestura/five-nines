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
const wires = await page.evaluate(() => document.querySelector('.banner')!.textContent!.includes('cannot reach'));
console.log(wires ? 'refused: ok' : 'NOT REFUSED');
if (process.argv[2]) await page.screenshot({ path: process.argv[2] });
await browser.close();

// Part two: Fans get one wire. In the sandbox, place two web servers and try
// to wire Fans to both.
{
  const b2 = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, defaultViewport: { width: 1440, height: 900 } });
  const p = await b2.newPage();
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.setItem('five-nines-v1', JSON.stringify({ stars: { '1-1': 1, '1-2': 1, '1-3': 1, '1-4': 1, '1-5': 1 }, designs: {}, seenCards: [], naming: 'generic', muted: true })));
  await p.reload({ waitUntil: 'networkidle0' });
  await p.evaluate(() => ([...document.querySelectorAll('button')].find((b) => b.textContent === 'Sandbox') as HTMLButtonElement).click());
  await p.click('.modal .btn.primary');
  const q = await p.evaluate(() => { const r = document.querySelector('.board canvas')!.getBoundingClientRect(); const s = Math.min(r.width / 1152, r.height / 672); return { l: r.left + (r.width - 1152 * s) / 2, t: r.top + (r.height - 672 * s) / 2, s }; });
  const P = (x: number, y: number) => [q.l + x * q.s, q.t + y * q.s] as const;
  await p.mouse.move(...P(480, 240)); await p.keyboard.press('1');
  await p.mouse.move(...P(480, 432)); await p.keyboard.press('1');
  for (const y of [240, 432]) {
    await p.mouse.move(...P(138, 336)); await p.mouse.down(); await p.mouse.move(...P(480, y), { steps: 6 }); await p.mouse.up();
  }
  const msg = await p.$eval('.banner', (e) => e.textContent ?? '');
  console.log(msg.includes('one address') ? 'second fans wire refused: ok' : `NOT REFUSED: ${msg}`);
  if (process.argv[3]) await p.screenshot({ path: process.argv[3] });
  await b2.close();
}

// Part three: the Debug button opens a dump with the CODE line.
{
  const b3 = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, defaultViewport: { width: 1440, height: 900 } });
  const p = await b3.newPage();
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.setItem('five-nines-v1', JSON.stringify({ debug: true })));
  await p.reload({ waitUntil: 'networkidle0' });
  await p.click('.sheet');
  await p.click('.modal .btn.primary');
  const btn = await p.evaluateHandle(() => [...document.querySelectorAll('.topbar button')].find((b) => b.textContent === 'Debug'));
  await (btn as any).click();
  const dump = await p.$eval('.modal textarea', (e) => (e as HTMLTextAreaElement).value);
  console.log(dump.includes('CODE 1-1') && dump.includes('CHECK') ? 'debug dump: ok' : 'DEBUG DUMP MISSING\n' + dump);
  await b3.close();
}
