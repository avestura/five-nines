// Makes the social preview (public/og.png, 1200x630) and the README screenshot
// (docs/screenshot.png). Needs `npm run preview -- --port 5199` running.
import puppeteer from 'puppeteer-core';
import { levelById } from '../src/levels';
import { encodeDesign } from '../src/share';

const code = encodeDesign(levelById('3-5')!.reference);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, defaultViewport: { width: 1200, height: 630 } });
const p = await b.newPage();
await p.goto('http://localhost:5199/', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.setItem('five-nines-v1', JSON.stringify({ seenLearn: true })));
await p.goto(`http://localhost:5199/#L=3-5&d=${code}`);
await p.reload({ waitUntil: 'networkidle0' });
await p.click('.modal .btn.primary');

// README screenshot: the real UI.
await p.setViewport({ width: 1440, height: 900 });
await p.evaluate(() => { (document.querySelectorAll('.speed button')[2] as HTMLElement).click(); });
await p.evaluate(() => { [...document.querySelectorAll('.topbar button')].find((x) => x.textContent === 'Run')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await new Promise((r) => setTimeout(r, 3500));
await p.screenshot({ path: 'docs/screenshot.png' });

// Social card: just the board, with the title laid over it.
await p.setViewport({ width: 1200, height: 630 });
await p.addStyleTag({ content: `
  body, #app { background: #f3efe4 !important; }
  .topbar, .tray, .forecast, .banner { display: none !important; }
  .game { display: block !important; }
  .board { position: fixed !important; inset: 90px 20px 90px 450px !important; }
  .card-og { position: fixed; left: 34px; top: 50%; transform: translateY(-50%); width: 392px; background: #f3efe4; border: 3px solid #22252b; box-shadow: 8px 8px 0 #22252b; padding: 24px 26px 22px; z-index: 50; }
  .card-og h1 { font: 400 62px/1 "Special Elite", monospace; color: #1f3a93; margin: 0 0 10px; letter-spacing: 2px; }
  .card-og .sub { font: 600 14px "IBM Plex Mono", monospace; color: #5b5f68; margin: 0 0 14px; }
  .card-og .tag { font: 400 21px/1.4 "IBM Plex Sans", sans-serif; color: #22252b; margin: 0; }
` });
await p.evaluate(() => {
  const d = document.createElement('div');
  d.className = 'card-og';
  d.innerHTML = '<h1>FIVE NINES</h1><p class="sub">99.999% &middot; about 5 minutes of downtime a year</p><p class="tag">A browser game about keeping a concert ticket startup online. Draw the system, press Run, survive the on-sale.</p>';
  document.body.append(d);
});
await new Promise((r) => setTimeout(r, 600));
await p.screenshot({ path: 'public/og.png' });
await b.close();
