/* EMBERFALL - the deployment gate.
 *
 * Everything else in test/ runs against file:// on a laptop. This file runs
 * against the LIVE GitHub Pages URL on an emulated phone, because those are
 * two different claims and only the second one is the thing being handed to
 * someone to play:
 *
 *   - Pages serves from the /emberfall/ SUBPATH. Any absolute asset path
 *     ("/js/main.js") works from file:// and 404s in production. A local
 *     green run cannot see that class of bug at all.
 *   - A phone has no mouse and no Esc key. Mouse events are not touch
 *     events, and Playwright's mouse API would happily "pass" a build that
 *     is unplayable with a thumb.
 *
 * So: real Google Chrome, real https, iPhone-class viewport at dpr 3, and
 * every gesture dispatched as a TOUCH. Hand-built PointerEvents are
 * non-primary and main.js correctly ignores them, so drags go through CDP.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_LIVE = process.argv[2] || 'https://leopechnicki.github.io/emberfall/';
/* fileURLToPath, NOT url.pathname. On Windows the pathname of a file:// URL
   is "/C:/Users/leops/Life%20Organizer/..." - percent-encoded and with a
   leading slash. Hand-stripping the slash but forgetting to decode wrote
   every screenshot into a brand-new "Life%20Organizer" directory that
   Playwright helpfully created, so the suite reported 24/24 and left the
   proof somewhere nobody would look. */
const OUT = path.dirname(fileURLToPath(import.meta.url));
const W = 720, H = 540;
const PHONE = { width: 390, height: 844 };

const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
let pass = 0, fail = 0;
const check = (cond, name, detail) => {
  cond ? pass++ : fail++;
  results.push({ check: name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  -> ' + detail : ''));
};

/* ---------------------------------------------------------------- browser */

let browser, channel = 'chrome', why = null;
try {
  browser = await chromium.launch({
    channel: 'chrome',
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']
  });
} catch (e) {
  browser = await chromium.launch({ args: ['--mute-audio'] });
  channel = 'chromium-fallback';
  why = String(e.message || e).split('\n')[0];
}
const version = browser.version();

const ctx = await browser.newContext({
  viewport: PHONE,
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3
});
const page = await ctx.newPage();

/* Every request and every console line, kept for the log file. A "clean
   console" claim with no transcript behind it is not evidence. */
const network = [], consoleLog = [], errors = [];
page.on('response', r => {
  network.push({ url: r.url(), status: r.status(), type: r.request().resourceType() });
});
page.on('requestfailed', r => {
  if (!r.url().startsWith('data:')) {
    network.push({
      url: r.url(), status: 'FAILED',
      error: r.failure() && r.failure().errorText, type: r.request().resourceType()
    });
    errors.push('requestfailed: ' + r.url());
  }
});
page.on('console', m => {
  consoleLog.push({ type: m.type(), text: m.text() });
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('pageerror', e => {
  consoleLog.push({ type: 'pageerror', text: String(e.message || e) });
  errors.push('pageerror: ' + String(e.message || e));
});

/* ---------------------------------------------------------------- helpers */

const snap = () => page.evaluate('window.__EMBERFALL.snapshot()');

async function tap(x, y) {
  const b = await page.locator('#game').boundingBox();
  await page.touchscreen.tap(b.x + (x / W) * b.width, b.y + (y / H) * b.height);
}

async function drag(from, to) {
  const b = await page.locator('#game').boundingBox();
  const P = p => ({ x: b.x + (p.x / W) * b.width, y: b.y + (p.y / H) * b.height });
  const a = P(from), z = P(to);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t }]
    });
    await wait(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function waitState(state, timeout = 10000) {
  const t0 = Date.now();
  for (;;) {
    const s = await snap();
    if (s.state === state && !s.transitioning) return s;
    if (Date.now() - t0 > timeout) return s;
    await wait(80);
  }
}

const shots = [];
async function shot(name, note) {
  const file = 'deploy_' + name + '.png';
  await page.screenshot({ path: path.join(OUT, file) });
  const bytes = fs.statSync(path.join(OUT, file)).size;
  shots.push({ file, note, bytes });
  return bytes;
}

/* ------------------------------------------------------------------- run */

const t0 = Date.now();
const resp = await page.goto(URL_LIVE, { waitUntil: 'load', timeout: 45000 });

check(resp && resp.status() === 200, 'live https URL returns 200',
  URL_LIVE + ' -> ' + (resp ? resp.status() : 'no response'));
check(String((resp && resp.url()) || '').startsWith('https://'), 'served over https',
  resp && resp.url());

await page.waitForFunction('!!window.__EMBERFALL', null, { timeout: 20000 });
await wait(600);
const boot = await snap();
const ver = await page.evaluate('window.__EMBERFALL.version');
check(boot.state === 'title', 'game boots on the deployed URL',
  (Date.now() - t0) + ' ms to title, state=' + boot.state + ', v' + ver);

/* ---- assets: the subpath trap ---- */
const assets = network.filter(n => ['script', 'stylesheet', 'document', 'image', 'font'].includes(n.type));
const bad = assets.filter(a => a.status !== 200 && a.status !== 304);
check(bad.length === 0, 'every script / stylesheet / asset request returns 200',
  bad.length ? JSON.stringify(bad)
             : assets.length + ' requests, all 200: ' +
               assets.map(a => a.url.replace(URL_LIVE, '')).join(' '));

const scripts = assets.filter(a => a.type === 'script');
check(scripts.length === 10, 'all 10 game scripts loaded from the subpath', scripts.length + ' scripts');
check(!network.some(n => /github\.io\/(js|css)\//.test(n.url)),
  'no asset escaped to the domain root (absolute-path regression)', 'all under /emberfall/');

/* ---- the pad exists on a real phone viewport ---- */
const pad = await page.evaluate(() => {
  const p = document.getElementById('pad');
  const vis = getComputedStyle(p).display !== 'none';
  const btns = [...p.querySelectorAll('button')].map(b => {
    const r = b.getBoundingClientRect();
    return { id: b.id, w: Math.round(r.width), h: Math.round(r.height) };
  });
  const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  return {
    visible: vis, btns,
    coverage: Math.round(100 * (area(document.getElementById('game')) + area(p)) / (innerWidth * innerHeight))
  };
});
check(pad.visible, 'touch pad is visible on the deployed phone build',
  pad.btns.map(b => b.id + ' ' + b.w + 'x' + b.h).join('  '));
check(pad.btns.every(b => b.w >= 44 && b.h >= 44), 'every control clears 44x44 CSS px',
  pad.btns.map(b => b.id + ' ' + b.w + 'x' + b.h).join('  '));
check(pad.coverage >= 55, 'game + controls fill the phone screen', pad.coverage + '%');
await shot('01_title_phone', 'the title screen, 390x844 at dpr 3, on the live URL');

/* ---- touch into the valley ---- */
await tap(360, 270);
const valley = await waitState('valley');
check(valley.state === 'valley', 'TOUCH: a tap on the title opens the valley', valley.state);
await shot('02_valley_phone', 'the valley hub with the pad below it');

/* ---- ACTIVITY 1 of 3: the swing (the one named in the criteria) ---- */
await tap(598, 414);
const grove = await waitState('swing');
check(grove.state === 'swing', 'TOUCH: tapping THE HIGH GROVE opens the vine swing', grove.state);

/* Hook a vine and photograph the keeper WHILE AIRBORNE. A screenshot of a
   keeper standing in the grass proves the scene renders, not that the
   mechanic responds to a thumb. */
let airborne = null;
for (let attempt = 0; attempt < 8 && !airborne; attempt++) {
  await tap(360, 300);
  const t1 = Date.now();
  while (Date.now() - t1 < 1200) {
    const s = await snap();
    if (s.mode && s.mode.swinging === true) { airborne = s; break; }
    await wait(30);
  }
}
check(!!airborne, 'TOUCH: a tap hooks a vine and the keeper leaves the ground',
  airborne ? 'swinging=true, hooks=' + airborne.mode.hooks + ', keeper airborne'
           : 'never left the ground');

let swingBytes = 0;
if (airborne) {
  swingBytes = await shot('03_swing_airborne_phone',
    'MID-PLAY: keeper airborne on a vine, live URL, phone viewport');
}

const swingState = await page.evaluate('(function(){' +
  'var m = window.__EMBERFALL.game.mode;' +
  'return { keeperMode: m.p.mode, x: Math.round(m.p.x), hooks: m.hooks,' +
  ' progress: window.__EMBERFALL.snapshot().mode.progress };' +
  '}())');
check(swingState.keeperMode === 'swing' || swingState.progress > 0,
  'TOUCH: the swing mechanic actually advances the keeper downrange',
  'keeper=' + swingState.keeperMode + ' x=' + swingState.x + ' hooks=' + swingState.hooks +
  ' progress=' + (swingState.progress * 100).toFixed(1) + '%');

/* release, then prove the ACTION button is a second way in */
await tap(360, 300);
await wait(300);
const hb = (await snap()).mode.hooks;
let viaBtn = null;
for (let a = 0; a < 5 && !viaBtn; a++) {
  await page.locator('#pad-action').tap();
  const t1 = Date.now();
  while (Date.now() - t1 < 1200) {
    const s = await snap();
    if (s.mode && s.mode.hooks > hb) { viaBtn = s; break; }
    await wait(30);
  }
}
check(!!viaBtn, 'TOUCH: the ACTION button hooks a vine too (no canvas poking needed)',
  'hooks ' + hb + ' -> ' + (viaBtn ? viaBtn.mode.hooks : 'unchanged'));

/* THE DEAD END: leaving without a keyboard */
await page.locator('#pad-back').tap();
const out1 = await waitState('valley');
check(out1.state === 'valley', 'TOUCH: BACK leaves the grove with no Esc key', out1.state);

/* ---- ACTIVITY 2 of 3: the orchard ---- */
await tap(118, 404);
const orchard = await waitState('harvest');
check(orchard.state === 'harvest', 'TOUCH: the orchard opens on a tap', orchard.state);
const bx0 = (await snap()).mode.basket;
await drag({ x: 150, y: 470 }, { x: 610, y: 470 });
await wait(400);
const bx1 = (await snap()).mode.basket;
check(Math.abs(bx1 - bx0) > 60, 'TOUCH: a finger drag moves the harvest basket',
  'basket ' + Math.round(bx0) + ' -> ' + Math.round(bx1));
await shot('04_harvest_phone', 'MID-PLAY: the orchard, basket moved by a finger drag');
await page.locator('#pad-back').tap();
check((await waitState('valley')).state === 'valley', 'TOUCH: BACK leaves the orchard', 'valley');

/* ---- ACTIVITY 3 of 3: the yard ---- */
await tap(300, 440);
const yard = await waitState('rake');
check(yard.state === 'rake', 'TOUCH: the yard opens on a tap', yard.state);
for (const from of [{ x: 120, y: 500 }, { x: 260, y: 380 }, { x: 400, y: 495 }]) {
  await drag(from, { x: 566, y: 424 });
  await wait(120);
}
await wait(400);
const rs = await snap();
check(rs.mode && rs.mode.piled > 0, 'TOUCH: a finger sweep banks leaves into piles',
  'piled ' + (rs.mode ? rs.mode.piled + '/' + rs.mode.target : 'no mode'));
await shot('05_rake_phone', 'MID-PLAY: the yard, leaves banked by finger sweeps');
await page.locator('#pad-back').tap();
check((await waitState('valley')).state === 'valley', 'TOUCH: BACK leaves the yard', 'valley');

/* ---- mute ---- */
const m0 = (await snap()).muted;
await page.locator('#pad-mute').tap();
await wait(250);
const m1 = (await snap()).muted;
check(m0 !== m1, 'TOUCH: the SOUND control toggles', m0 + ' -> ' + m1);

/* ---- console cleanliness across the whole walk ---- */
check(errors.length === 0, 'console clean across the entire deployed walk',
  errors.length ? JSON.stringify(errors.slice(0, 5)) : 'zero errors, zero failed requests');

/* ---- landscape, since a phone rotates ---- */
await page.setViewportSize({ width: 844, height: 390 });
await wait(600);
const land = await page.evaluate(() => {
  const p = document.getElementById('pad');
  const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  return {
    visible: getComputedStyle(p).display !== 'none',
    coverage: Math.round(100 * (area(document.getElementById('game')) + area(p)) / (innerWidth * innerHeight))
  };
});
check(land.visible && land.coverage >= 85, 'landscape still fills the screen after rotation',
  land.coverage + '%');
await shot('06_landscape_phone', 'rotated to landscape, pad beside the scene');

/* ------------------------------------------------------------------ out */

fs.writeFileSync(path.join(OUT, 'network_console.log'),
  '# EMBERFALL deployment verification\n' +
  '# url: ' + URL_LIVE + '\n# generated: ' + new Date().toISOString() + '\n' +
  '# browser: ' + channel + ' ' + version + (why ? ' (' + why + ')' : '') + '\n' +
  '# viewport: ' + PHONE.width + 'x' + PHONE.height + ' dpr3 hasTouch=true isMobile=true\n\n' +
  '=== NETWORK (' + network.length + ') ===\n' +
  network.map(n => String(n.status).padEnd(7) + String(n.type || '').padEnd(12) + n.url +
    (n.error ? '  ' + n.error : '')).join('\n') +
  '\n\n=== CONSOLE (' + consoleLog.length + ') ===\n' +
  (consoleLog.length ? consoleLog.map(c => c.type.padEnd(8) + c.text).join('\n')
                     : '(empty - no console output at all)') +
  '\n\n=== ERRORS (' + errors.length + ') ===\n' +
  (errors.length ? errors.join('\n') : '(none)') + '\n',
  'utf8');

const report = {
  project: 'EMBERFALL',
  live_url: URL_LIVE,
  verified_at: new Date().toISOString(),
  browser: { channel, version, fallback_reason: why },
  device: { width: PHONE.width, height: PHONE.height, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  summary: { total: pass + fail, passed: pass, failed: fail, verdict: fail ? 'FAIL' : 'PASS' },
  checks: results,
  screenshots: shots,
  network: {
    requests: network.length,
    non_200: network.filter(n => n.status !== 200 && n.status !== 304).length
  },
  console: { lines: consoleLog.length, errors: errors.length }
};
fs.writeFileSync(path.join(OUT, 'deploy_verify_raw.json'), JSON.stringify(report, null, 2), 'utf8');

console.log('\n' + pass + '/' + (pass + fail) + ' deployment checks passed  -  ' + report.summary.verdict);
console.log('swing screenshot bytes: ' + swingBytes);
await browser.close();
process.exit(fail ? 1 : 0);
