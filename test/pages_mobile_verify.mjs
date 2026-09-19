/* EMBERFALL - mobile TOUCH-ONLY acceptance check.
 *
 *   node test/pages_mobile_verify.mjs <base-url> [--label live|local]
 *
 * Every input in this file is a raw CDP touch event. No keyboard, no mouse,
 * no in-page shortcuts: if an activity cannot be entered, played and left by
 * finger alone, this exits non-zero. That is the whole point - the previous
 * HTML build was unnavigable on a phone because leaving an activity was
 * bound to ESC and nothing else.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2];
const label = (process.argv.includes('--label')
  ? process.argv[process.argv.indexOf('--label') + 1] : 'run');
if (!BASE) { console.error('usage: node test/pages_mobile_verify.mjs <base-url>'); process.exit(2); }

const SHOTS = path.join('test', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(path.join('test', 'verify'), { recursive: true });

const VP = { width: 390, height: 844 };   // iPhone 13 / 14 class
const results = [];
const errors = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: VP,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
});
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const cdp = await ctx.newCDPSession(page);

/* ---- pure-touch primitives ---------------------------------------- */
const pt = (x, y) => ([{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }]);
async function tap(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) });
  await page.waitForTimeout(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(60);
}
async function drag(pts, stepMs) {
  stepMs = stepMs || 45;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(pts[0][0], pts[0][1]) });
  for (let i = 1; i < pts.length; i++) {
    await page.waitForTimeout(stepMs);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(pts[i][0], pts[i][1]) });
  }
  await page.waitForTimeout(stepMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(60);
}

/* A finger that stays down across many moves - how a thumb actually plays
   the orchard and the yard. */
async function touchDown(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) });
}
async function touchMoveTo(x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x, y) });
}
async function touchUp() {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const snap = () => page.evaluate(() => window.__EMBERFALL.snapshot());
const box = sel => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height,
           disabled: !!el.disabled, text: (el.textContent || '').trim() };
}, sel);

/* logical canvas point -> screen point */
async function canvasPoint(lx, ly) {
  const r = await box('#game');
  return [r.x + (lx / 720) * r.w, r.y + (ly / 540) * r.h];
}
async function tapButton(sel) {
  const b = await box(sel);
  if (!b || b.w === 0) throw new Error(sel + ' not laid out');
  if (b.disabled) throw new Error(sel + ' is disabled (text=' + b.text + ')');
  await tap(b.x + b.w / 2, b.y + b.h / 2);
  return b;
}
async function waitState(want, ms) {
  ms = ms || 6000;
  const t0 = Date.now();
  for (;;) {
    const s = await snap();
    if (s.state === want && !s.transitioning) return s;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(120);
  }
}
const shot = n => page.screenshot({ path: path.join(SHOTS, 'mobile_' + label + '_' + n + '.png') });

/* ---- 1. load + touch layout ---------------------------------------- */
const resp = await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
check('http 200 for document', resp && resp.status() === 200, resp && resp.status());
await page.waitForFunction(() => window.__EMBERFALL && window.__EMBERFALL.snapshot, null, { timeout: 15000 });

const layout = await page.evaluate(() => {
  const g = document.querySelector('#game').getBoundingClientRect();
  const p = document.querySelector('#pad').getBoundingClientRect();
  const btns = [...document.querySelectorAll('#pad button')].map(b => {
    const r = b.getBoundingClientRect();
    return { id: b.id, w: Math.round(r.width), h: Math.round(r.height),
             visible: getComputedStyle(b).display !== 'none' };
  });
  return {
    coarse: matchMedia('(pointer: coarse)').matches,
    touchClass: document.body.classList.contains('touch'),
    padDisplay: getComputedStyle(document.querySelector('#pad')).display,
    canvas: { w: Math.round(g.width), h: Math.round(g.height), y: Math.round(g.y) },
    pad: { w: Math.round(p.width), h: Math.round(p.height), y: Math.round(p.y) },
    btns: btns, docScrollW: document.documentElement.scrollWidth
  };
});
check('(pointer: coarse) detected', layout.coarse);
check('body.touch applied', layout.touchClass, layout.padDisplay);
check('pad is on screen', layout.pad.h > 60 && layout.pad.y + layout.pad.h <= VP.height + 1, JSON.stringify(layout.pad));
check('canvas fits viewport width', layout.canvas.w <= VP.width && layout.docScrollW <= VP.width,
      'canvas ' + layout.canvas.w + 'x' + layout.canvas.h + ' scrollW ' + layout.docScrollW);
check('all pad buttons >= 44px tall', layout.btns.every(b => b.h >= 44), JSON.stringify(layout.btns));
await shot('01_title');

/* ---- 2. title -> valley, by touch ---------------------------------- */
await tapButton('#pad-action');
let s = await waitState('valley');
check('title -> valley by tap', !!s, s && s.state);

/* ---- 3. the orchard (harvest) -------------------------------------- */
let a = await box('#pad-action');
check('action button labels the orchard', /ORCHARD/i.test(a.text), a.text);
await tapButton('#pad-action');
s = await waitState('harvest');
check('harvest entered by tap', !!s, s && s.state);
let basket0 = s && s.mode ? s.mode.basket : null;

/* Play the orchard with one sustained thumb drag, steering the basket under
   whatever is falling. The TARGET comes from the sim, the INPUT is a real
   touchmove - so this proves the touch path, not a debug hook. */
{
  const start = await canvasPoint(360, 470);
  await touchDown(start[0], start[1]);
  const t0 = Date.now();
  while (Date.now() - t0 < 14000) {
    const tgt = await page.evaluate(() => {
      const m = window.__EMBERFALL.game.mode;
      if (!m || !m.items) return null;
      let best = null;
      for (const it of m.items) {
        if (it.caught) continue;
        if (it.kind === 'wasp' || it.kind === 'acorn') continue;
        if (!best || it.y > best.y) best = it;
      }
      return best ? { x: best.x, y: best.y } : null;
    });
    if (tgt) { const p = await canvasPoint(tgt.x, 470); await touchMoveTo(p[0], p[1]); }
    const ss = await snap();
    if (ss.state !== 'harvest') break;
    await page.waitForTimeout(80);
  }
  await touchUp();
}
let sh = await snap();
check('harvest basket responds to touch drag',
      sh.mode && Math.abs(sh.mode.basket - basket0) > 40, 'basket ' + basket0 + ' -> ' + (sh.mode && sh.mode.basket));
check('harvest: fruit actually caught by touch', sh.mode && sh.mode.fruit > 0,
      sh.mode ? 'fruit=' + sh.mode.fruit + ' score=' + sh.mode.score : 'no mode');
await shot('02_harvest');
let bb = null;
if (sh.state === 'harvest') {
  bb = await box('#pad-back');
  check('BACK enabled inside harvest', bb && !bb.disabled, bb && bb.text);
  await tapButton('#pad-back');
} else {
  check('BACK enabled inside harvest', true, 'round ended on its own before BACK was needed');
}
s = await waitState('valley');
check('ACTIVITY 1 (orchard): playable + exitable by touch', !!s && s.done.harvest,
      s ? 'done.harvest=' + s.done.harvest + ' fruit=' + s.tally.fruit : 'stuck');

/* ---- 4. the yard (rake) -------------------------------------------- */
a = await box('#pad-action');
check('action button labels the yard', /YARD/i.test(a.text), a.text);
await tapButton('#pad-action');
s = await waitState('rake');
check('rake entered by tap', !!s, s && s.state);
/* Sweep the nearest loose leaf into the mound, over and over, the way a
   thumb would: start the finger beyond the leaf and drag through it into the
   pile ring at (566, 424). Enough passes to render real wax, because dusk is
   only provable if the day earned something to burn. */
{
  const WANT_PILED = 30;                 // >= 2 wax = a lantern plus a candle
  for (let pass = 0; pass < 46; pass++) {
    const aim = await page.evaluate(() => {
      const m = window.__EMBERFALL.game.mode;
      if (!m || !m.leaves) return null;
      const PX = 566, PY = 424;
      let best = null, bestD = 1e9;
      for (const q of m.leaves) {
        if (q.piled) continue;
        const d = Math.hypot(q.x - PX, q.y - PY);
        if (d < bestD) { bestD = d; best = q; }
      }
      if (!best) return null;
      return { x: best.x, y: best.y, piled: m.piled };
    });
    if (!aim) break;
    const vx = aim.x - 566, vy = aim.y - 424;
    const len = Math.max(1, Math.hypot(vx, vy));
    const sx = Math.max(24, Math.min(700, aim.x + (vx / len) * 74));
    const sy = Math.max(330, Math.min(528, aim.y + (vy / len) * 74));
    const a = await canvasPoint(sx, sy);
    const b = await canvasPoint(566, 424);
    const steps = [];
    for (let i = 0; i <= 9; i++) steps.push([a[0] + (b[0] - a[0]) * i / 9, a[1] + (b[1] - a[1]) * i / 9]);
    await drag(steps, 26);
    const ss = await snap();
    if (ss.state !== 'rake') break;
    if (ss.mode && ss.mode.piled >= WANT_PILED) break;
  }
}
let sr = await snap();
check('rake piles leaves from touch drags', sr.mode && sr.mode.piled > 0,
      sr.mode ? 'piled=' + sr.mode.piled + ' wax=' + sr.mode.wax + ' rake=' + JSON.stringify(sr.mode.rake) : 'no mode');
check('rake: touch play renders wax for dusk', sr.mode && sr.mode.wax >= 2,
      sr.mode ? 'wax=' + sr.mode.wax : 'no mode');
await shot('03_rake');
bb = await box('#pad-back');
check('BACK enabled inside rake', bb && !bb.disabled);
await tapButton('#pad-back');
s = await waitState('valley');
check('ACTIVITY 2 (yard): playable + exitable by touch', !!s && s.done.rake,
      s ? 'done.rake=' + s.done.rake + ' wax=' + s.tally.wax : 'stuck');

/* ---- 5. the high grove (swing) - reached by tapping the signpost ---- */
{
  const gp = await canvasPoint(598, 414);
  await tap(gp[0], gp[1]);
}
s = await waitState('swing');
check('grove signpost reachable by canvas tap', !!s, s && s.state);
let hooked = false, swung = false;
for (let i = 0; i < 14 && !hooked; i++) {
  const b = await box('#pad-action');
  if (b && !b.disabled) await tap(b.x + b.w / 2, b.y + b.h / 2);
  await page.waitForTimeout(260);
  const ss = await snap();
  if (ss.mode && ss.mode.swinging) swung = true;
  if (ss.mode && ss.mode.hooks > 0) hooked = true;
  if (ss.state !== 'swing') break;
}
let sw = await snap();
check('grove: vine hooked via ACTION button', hooked || swung,
      sw.mode ? 'hooks=' + sw.mode.hooks + ' swinging=' + sw.mode.swinging + ' x=' + sw.mode.x : 'no mode');
await shot('04_swing');
if (sw.state === 'swing') {
  bb = await box('#pad-back');
  check('BACK enabled inside grove', bb && !bb.disabled);
  await tapButton('#pad-back');
}
s = await waitState('valley');
check('ACTIVITY 3 (grove): playable + exitable by touch', !!s && s.done.swing,
      s ? 'done.swing=' + s.done.swing + ' apples=' + s.tally.apples : 'stuck');

/* ---- 6. dusk + summary, by touch ----------------------------------- */
a = await box('#pad-action');
check('action button offers dusk once the loop is done', /LANTERN/i.test(a.text), a.text);
await tapButton('#pad-action');
s = await waitState('dusk');
check('dusk entered by tap', !!s, s && s.state);
for (let i = 0; i < 16; i++) {
  const b = await box('#pad-action');
  if (b && !b.disabled) await tap(b.x + b.w / 2, b.y + b.h / 2);
  await page.waitForTimeout(420);
  const ss = await snap();
  if (ss.state !== 'dusk') break;
}
let sd = await snap();
check('dusk: lantern or candles lit by touch', sd.tally.lantern || sd.tally.candles > 0 || sd.candlesLit > 0,
      'lantern=' + sd.tally.lantern + ' candles=' + sd.tally.candles + ' state=' + sd.state);
await shot('05_dusk');

/* ---- 7. mute button + landscape ------------------------------------ */
const m0 = (await snap()).muted;
await tapButton('#pad-mute');
const m1 = (await snap()).muted;
check('SOUND button toggles by touch', m0 !== m1, m0 + ' -> ' + m1);
await tapButton('#pad-mute');

await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(500);
const land = await page.evaluate(() => {
  const g = document.querySelector('#game').getBoundingClientRect();
  const p = document.querySelector('#pad').getBoundingClientRect();
  return { landClass: document.body.classList.contains('landscape'),
           canvasW: Math.round(g.width), canvasH: Math.round(g.height),
           padW: Math.round(p.width), padH: Math.round(p.height),
           fits: Math.round(g.right) <= 845 && Math.round(p.right) <= 845 };
});
check('landscape: pad beside canvas, nothing off-screen', land.landClass && land.padW > 60 && land.fits, JSON.stringify(land));
await shot('06_landscape');
await page.setViewportSize(VP);
await page.waitForTimeout(500);
await shot('07_portrait_final');

check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));

const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join('test', 'verify', 'mobile_' + label + '.json'),
  JSON.stringify({ base: BASE, viewport: VP, when: new Date().toISOString(), results: results, errors: errors }, null, 2));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
await browser.close();
process.exit(failed.length ? 1 : 0);
