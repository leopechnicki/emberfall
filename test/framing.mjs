/* EMBERFALL - the framing gate.
 *
 * One rule, measured from the rendered pixels on a 390x844 phone:
 *
 *     the scene band is at least MIN_SCENE_PCT of the screen
 *     the sky band is at most  MAX_SKY_PCT   of the screen
 *
 * See test/framelib.mjs for why this is measured and not read out of a
 * constant, and for how the horizon is found. The short version: HORIZON is
 * 330 in js/game.js whether that renders at 20% of the phone or at 65% of it,
 * so the only honest place to check the framing is the frame.
 *
 * Every state with a sky in it is checked, not just the valley: the valley is
 * what a screenshot shows, but the orchard, the yard and the grove are where
 * the game is actually played, and they had exactly the same strip-along-the-
 * bottom composition.
 *
 * The last two cases are the regression guard in the other direction. A fix
 * that fills the phone by reshaping the world for EVERYONE would break the
 * desktop and landscape builds that were already signed off, so both are
 * asserted to be unchanged.
 *
 * They assert on the two flags that ACTUALLY select a composition -
 * EF.portrait, which every scene's layout() branches on, and EF.hudRect(),
 * which decides whether the chrome belongs to the screen or to the scene box.
 * An earlier version of this file asserted on EF.stage() instead, which read
 * well and proved nothing: no scene ever called it, so it would have returned
 * a perfect 720x540 while the layout underneath it did anything it liked.
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { measureFrame, writeOverlay } from './framelib.mjs';

const MIN_SCENE_PCT = 55;
const MAX_SKY_PCT = 35;
const MIN_TAP = 44;

const OUT = 'test/screenshots/framing';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const failures = [];
function check(ok, label, detail) {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else {
    fail++; failures.push(label);
    console.log(`  FAIL ${label}${detail ? '  ->  ' + detail : ''}`);
  }
}

const url = pathToFileURL(path.resolve('index.html')).href;
const browser = await chromium.launch({ channel: 'chrome', headless: true });

/* ------------------------------------------------------------ portrait */

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true, isMobile: true, deviceScaleFactor: 1
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('!!window.__EMBERFALL', null, { timeout: 20000 });
await page.waitForTimeout(350);

/* logical -> client, through the same bleed maths main.js uses */
const geom = () => page.evaluate(() => {
  const r = document.getElementById('game').getBoundingClientRect();
  const b = window.EF.bleed;
  return {
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    bleed: b, totalW: 720 + b.x * 2, totalH: 540 + b.top + b.bottom,
    pad: window.__EMBERFALL.padGeom(), cssPerUnit: window.EF.cssPerUnit
  };
});

async function toClient(x, y) {
  const g = await geom();
  return {
    x: g.rect.x + (x + g.bleed.x) / g.totalW * g.rect.w,
    y: g.rect.y + (y + g.bleed.top) / g.totalH * g.rect.h
  };
}
async function tapLogical(x, y) {
  const c = await toClient(x, y);
  await page.touchscreen.tap(c.x, c.y);
}
async function padTop() {
  const g = await geom();
  if (!g.pad) return null;
  const top = Math.min(g.pad.back.y, g.pad.action.y);
  /* the pad's plank starts at its y; the strip it owns starts a margin above,
     but the margin is still drawable world, so the honest boundary for
     "screen the game gets" is the plank itself */
  return g.rect.y + (top + g.bleed.top) / g.totalH * g.rect.h;
}
const snap = () => page.evaluate('window.__EMBERFALL.snapshot()');

/* --- the pad is still a thumb target ---------------------------------- */
{
  const g = await geom();
  check(!!g.pad, 'portrait: the on-canvas pad reports geometry');
  if (g.pad) {
    const small = Object.entries(g.pad)
      .filter(([, b]) => b.w * g.cssPerUnit < MIN_TAP || b.h * g.cssPerUnit < MIN_TAP)
      .map(([k, b]) => `${k} ${Math.round(b.w * g.cssPerUnit)}x${Math.round(b.h * g.cssPerUnit)}`);
    check(small.length === 0,
      `portrait: every on-canvas control is at least ${MIN_TAP}x${MIN_TAP} CSS px`,
      small.join(', '));
  }
}

/* --- the framing, state by state -------------------------------------- */

async function measureState(name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  const m = measureFrame(file, await padTop());
  writeOverlay(m, `${OUT}/${name}_overlay.png`);
  console.log(`  .. ${name}: sky ${m.skyPct}%  scene ${m.scenePct}%  pad ${m.padPct}%  (horizon y=${m.horizonPx}/${m.height})`);
  check(m.scenePct >= MIN_SCENE_PCT,
    `portrait ${name}: the scene band fills at least ${MIN_SCENE_PCT}% of the phone`,
    `${m.scenePct}%`);
  check(m.skyPct <= MAX_SKY_PCT,
    `portrait ${name}: sky takes no more than ${MAX_SKY_PCT}% of the phone`,
    `${m.skyPct}%`);
  return m;
}

const results = {};

await tapLogical(360, 270);                      // title -> valley
await page.waitForTimeout(900);
check((await snap()).state === 'valley', 'portrait: a tap on the title opens the valley');
results.valley = await measureState('valley');

for (const [id, label] of [['harvest', 'orchard'], ['rake', 'yard'], ['swing', 'grove']]) {
  await page.evaluate(s => window.__EMBERFALL.goTo(s), id);
  await page.waitForTimeout(800);
  check((await snap()).state === id, `portrait: ${label} opens`);
  results[id] = await measureState(id);
  await page.evaluate(() => window.__EMBERFALL.goTo('valley'));
  await page.waitForTimeout(500);
}

check(errors.length === 0, 'portrait: zero page errors while measuring',
  errors.length ? JSON.stringify(errors.slice(0, 3)) : '');

/* ------------------------------------------- landscape must not move */
{
  const lctx = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true, isMobile: true, deviceScaleFactor: 1
  });
  const lp = await lctx.newPage();
  const lerr = [];
  lp.on('pageerror', e => lerr.push(e.message));
  await lp.goto(url, { waitUntil: 'load' });
  await lp.waitForFunction('!!window.__EMBERFALL', null, { timeout: 20000 });
  await lp.waitForTimeout(350);
  const lst = await lp.evaluate(() => ({ portrait: window.EF.portrait, hud: window.EF.hudRect() }));
  check(lst.portrait === false, 'landscape: does not take the portrait composition', String(lst.portrait));
  check(lst.hud.x === 0 && lst.hud.y === 0 && lst.hud.right === 720 && lst.hud.bottom === 540,
    'landscape: the HUD box is still exactly the authored 720x540 box', JSON.stringify(lst.hud));
  check(lerr.length === 0, 'landscape: no page errors', lerr.join('; '));
  await lctx.close();
}

/* --------------------------------------------- desktop must not move */
{
  const dctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const dp = await dctx.newPage();
  const derr = [];
  dp.on('pageerror', e => derr.push(e.message));
  await dp.goto(url, { waitUntil: 'load' });
  await dp.waitForFunction('!!window.__EMBERFALL', null, { timeout: 20000 });
  await dp.waitForTimeout(350);
  const dst = await dp.evaluate(() => ({ portrait: window.EF.portrait, hud: window.EF.hudRect() }));
  check(dst.portrait === false, 'desktop: does not take the portrait composition', String(dst.portrait));
  check(dst.hud.x === 0 && dst.hud.y === 0 && dst.hud.right === 720 && dst.hud.bottom === 540,
    'desktop: the HUD box is still exactly the authored 720x540 box', JSON.stringify(dst.hud));
  const bleed = await dp.evaluate(() => window.EF.bleed);
  check(bleed.x === 0 && bleed.top === 0 && bleed.bottom === 0,
    'desktop: no bleed - the canvas is still letterboxed 4:3', JSON.stringify(bleed));
  check(derr.length === 0, 'desktop: no page errors', derr.join('; '));
  await dctx.close();
}

await browser.close();

console.log('\n---------------------------------------------');
for (const [k, m] of Object.entries(results)) {
  console.log(`  ${k.padEnd(8)} sky ${String(m.skyPct).padStart(5)}%   scene ${String(m.scenePct).padStart(5)}%   pad ${String(m.padPct).padStart(5)}%`);
}
console.log(`\nframing: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('failed:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
