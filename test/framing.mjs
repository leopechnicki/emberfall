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
/* Real Google Chrome locally - Leo's rule, and the browser Klaudia will
   actually open this in. Same reported-not-asserted fallback the other two
   suites use, so a runner without Chrome installed still runs the gate
   instead of erroring out and leaving the framing unchecked. */
let browser, channel = 'chrome';
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
} catch (e) {
  browser = await chromium.launch({ headless: true });
  channel = 'chromium-fallback';
}
console.log('browser channel: ' + channel);

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
  /* A measurement that could not be made is a FAILURE, never a pass. Without
     this the ratio assertions below read skyPct 0 / scenePct 91 off a frame
     the detector never actually resolved, and sail straight through. */
  check(m.measurable, `portrait ${name}: the frame is measurable at all`, m.why);
  /* and it has to be the LIT composition - see framelib.mjs on why a dark
     frame cannot be measured honestly */
  const lit = await page.evaluate('window.__EMBERFALL.game.night');
  check(lit < 0.1, `portrait ${name}: measured in the day palette`, 'night=' + lit);
  check(m.scenePct >= MIN_SCENE_PCT,
    `portrait ${name}: the scene band fills at least ${MIN_SCENE_PCT}% of the phone`,
    `${m.scenePct}%`);
  check(m.skyPct <= MAX_SKY_PCT,
    `portrait ${name}: sky takes no more than ${MAX_SKY_PCT}% of the phone`,
    `${m.skyPct}%`);
  return m;
}

const results = {};

/* --- the TITLE, which is the first thing anyone sees ------------------- */
{
  /* Measured before anything is tapped. The gate used to tap the title away
     before its first screenshot, so the one screen guaranteed to be seen was
     the only one never checked - and it was broken: the EMBERFALL card is
     drawn in the scene box, which on a phone put it 56% of the way down,
     directly over THE HIGH GROVE signpost, name overprinting label. */
  const tf = `${OUT}/title.png`;
  await page.screenshot({ path: tf });
  const tm = measureFrame(tf, await padTop());
  writeOverlay(tm, `${OUT}/title_overlay.png`);
  console.log(`  .. title: sky ${tm.skyPct}%  scene ${tm.scenePct}%  pad ${tm.padPct}%`);
  check(tm.measurable, 'portrait title: the frame is measurable at all', tm.why);
  check(tm.scenePct >= MIN_SCENE_PCT,
    `portrait title: the scene band fills at least ${MIN_SCENE_PCT}% of the phone`, `${tm.scenePct}%`);
  check(tm.skyPct <= MAX_SKY_PCT,
    `portrait title: sky takes no more than ${MAX_SKY_PCT}% of the phone`, `${tm.skyPct}%`);

  const clash = await page.evaluate(() => {
    const c = window.__EMBERFALL.titleCard();
    const hit = (window.__EMBERFALL.spots() || []).filter(s => {
      const sc = s.s || 1;
      const l = s.x - s.w * 0.5 * sc, r = s.x + s.w * 0.5 * sc;
      const t = s.y - (s.h + 6) * sc, b = s.y + 34 * sc;
      return l < c.x + c.w && r > c.x && t < c.y + c.h && b > c.y;
    }).map(s => s.id);
    return hit;
  });
  check(clash.length === 0,
    'portrait title: the EMBERFALL card does not overlap any signpost', clash.join(', '));
}

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

/* ---------------------------------- the gate refuses what it cannot measure
 *
 * Dusk is half this game, and framelib.mjs cannot honestly measure a dark
 * frame (its reasons are written out there). The danger is not that it is
 * unable - it is that being unable used to look exactly like a pass: 0.0%
 * sky, 91.2% scene, every ratio assertion green, on a frame nobody resolved.
 *
 * So the night frame is a CASE, and what it asserts is that the detector
 * says "I cannot measure this" rather than making a number up. If someone
 * later makes the detector work in the dark, this flips and should be
 * rewritten to assert the real ratio instead. */
{
  await page.evaluate(() => window.__EMBERFALL.goTo('valley'));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g = window.__EMBERFALL.game;
    g.night = 1; g.nightTarget = 1; g.warm = 0;
  });
  await page.waitForTimeout(400);
  const nf = `${OUT}/night_valley.png`;
  await page.screenshot({ path: nf });
  const nm = measureFrame(nf, await padTop());
  console.log(`  .. night valley: measurable=${nm.measurable} (sky ${nm.skyPct}% scene ${nm.scenePct}%)`);
  check(nm.measurable === false,
    'night: the detector reports the dark frame as UNMEASURABLE instead of passing it',
    `measurable=${nm.measurable} sky=${nm.skyPct}% scene=${nm.scenePct}%`);
  await page.evaluate(() => {
    const g = window.__EMBERFALL.game;
    g.night = 0; g.nightTarget = 0;
  });
}


/* ------------------------------- a SECOND phone, because one size proves one size
 *
 * Every number above was measured at 390x844, and at least one constant was
 * tuned until that single size looked right: the grove's ground line was a
 * hard-coded 600, which clears the pad by 3 units at 390x844 and sits BELOW
 * it at 414x896 - the keeper's feet under a thumb button, on a size the gate
 * never opened. A second viewport is the cheapest possible defence against
 * fitting the test instead of the layout. */
{
  const ctx2 = await browser.newContext({
    viewport: { width: 414, height: 896 },
    hasTouch: true, isMobile: true, deviceScaleFactor: 1
  });
  const p2 = await ctx2.newPage();
  const e2 = [];
  p2.on('pageerror', e => e2.push(e.message));
  await p2.goto(url, { waitUntil: 'load' });
  await p2.waitForFunction('!!window.__EMBERFALL', null, { timeout: 20000 });
  await p2.waitForTimeout(350);

  const g2 = await p2.evaluate(() => {
    const r = document.getElementById('game').getBoundingClientRect();
    const b = window.EF.bleed;
    return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, bleed: b,
             totalW: 720 + b.x * 2, totalH: 540 + b.top + b.bottom,
             pad: window.__EMBERFALL.padGeom(), cssPerUnit: window.EF.cssPerUnit,
             padTopY: window.EF.padTopY };
  });
  const toC2 = (x, y) => ({
    x: g2.rect.x + (x + g2.bleed.x) / g2.totalW * g2.rect.w,
    y: g2.rect.y + (y + g2.bleed.top) / g2.totalH * g2.rect.h
  });
  const c2 = toC2(360, 270);
  await p2.touchscreen.tap(c2.x, c2.y);
  await p2.waitForTimeout(900);
  check((await p2.evaluate('window.__EMBERFALL.snapshot().state')) === 'valley',
    '414x896: a tap on the title opens the valley');

  const f2 = `${OUT}/valley_414x896.png`;
  await p2.screenshot({ path: f2 });
  const padTop2 = g2.rect.y + (Math.min(g2.pad.back.y, g2.pad.action.y) + g2.bleed.top) / g2.totalH * g2.rect.h;
  const m2 = measureFrame(f2, padTop2);
  writeOverlay(m2, `${OUT}/valley_414x896_overlay.png`);
  console.log(`  .. 414x896 valley: sky ${m2.skyPct}%  scene ${m2.scenePct}%  pad ${m2.padPct}%`);
  check(m2.measurable, '414x896: the frame is measurable at all', m2.why);
  check(m2.scenePct >= MIN_SCENE_PCT,
    `414x896: the scene band fills at least ${MIN_SCENE_PCT}% of the phone`, `${m2.scenePct}%`);
  check(m2.skyPct <= MAX_SKY_PCT,
    `414x896: sky takes no more than ${MAX_SKY_PCT}% of the phone`, `${m2.skyPct}%`);

  /* the grove's grass line must clear the pad on THIS size too */
  await p2.evaluate(() => window.__EMBERFALL.goTo('swing'));
  await p2.waitForTimeout(700);
  const grove = await p2.evaluate(() => {
    const L = window.EF.Swing.layout();
    return { GY: L.GY, padTopY: window.EF.padTopY, S: L.S };
  });
  const standY = grove.GY + (436 - 462) * grove.S;   // STAND_Y - GROUND_Y, through the zoom
  check(standY < grove.padTopY,
    '414x896: the grove keeper stands clear of the thumb pad',
    `stand=${standY.toFixed(1)} padTop=${grove.padTopY.toFixed(1)}`);

  const small2 = Object.entries(g2.pad)
    .filter(([, b]) => b.w * g2.cssPerUnit < MIN_TAP || b.h * g2.cssPerUnit < MIN_TAP)
    .map(([k]) => k);
  check(small2.length === 0, `414x896: every on-canvas control is at least ${MIN_TAP} CSS px`, small2.join(', '));
  check(e2.length === 0, '414x896: no page errors', e2.join('; '));
  await ctx2.close();
}

/* ------------------------------------------ the flat constants must not move
 *
 * Every scene's layout() is supposed to hand back the AUTHORED numbers
 * untouched on desktop and in landscape. Six of them had quietly moved -
 * two toast lines, the rake's spawn point, the leaf ceiling, the prop draw
 * order and the desktop mute radius - shipped under a "not a pixel" claim,
 * because the only thing asserted was EF.portrait and EF.hudRect(). Those
 * two were correct the whole time; the layouts underneath them were not.
 *
 * So the constants are asserted directly, by value. This is deliberately a
 * transcription of the authored source: if someone changes a number on
 * purpose they must change it here too, and that is the point. */
const FLAT = {
  valley: { hz: 330, gy: 352, path: null, nearTrees: null,
            lantern: { x: 452, y: 412, s: 1.1 }, keeper: { x: 386, y: 452, s: 1 } },
  harvest: { hz: 350, gFill: 470, floor: 470, basketY: 448, basketS: 1,
             toastY: 414, spawnY: -24, fallK: 1, farY: 478, near: null },
  rake: { hz: 312, gFill: 340, fenceY: 318, yardTop: 340, yardBot: 510,
          clampTop: 324, clampBot: 528, toastY: 284, startY: 430,
          leafCeil: 326, leafFloor: 532, propsOverGround: false,
          rakeR: 52, leafS: 1, far: null },
  swing: { S: 1, GY: 0, hillY: 336, gFill: 462, bottom: 540, lead: 250,
           camMax: 2680, far: null }
};

async function checkFlat(pg, label) {
  const got = await pg.evaluate(() => ({
    valley: window.EF.Game.valleyLayout(),
    harvest: window.EF.Harvest.layout(),
    rake: window.EF.Rake.layout(),
    swing: window.EF.Swing.layout()
  }));
  for (const scene of Object.keys(FLAT)) {
    const want = FLAT[scene], have = got[scene];
    const bad = [];
    for (const k of Object.keys(want)) {
      const w = want[k], h = have[k];
      const same = (w && typeof w === 'object')
        ? (h && Object.keys(w).every(kk => Math.abs(w[kk] - h[kk]) < 1e-9))
        : (w === null ? (h === null || h === undefined) : Math.abs(w - h) < 1e-9);
      if (!same) bad.push(`${k}: want ${JSON.stringify(w)} got ${JSON.stringify(h)}`);
    }
    check(bad.length === 0, `${label}: ${scene} layout is still the authored composition`, bad.join('; '));
  }
  /* the signposts, which are the thing that actually moved in portrait */
  const spots = await pg.evaluate(() => window.EF.Game.valleyLayout().spots.map(
    s => [s.id, s.x, s.y, s.w, s.h, s.s]));
  const WANT_SPOTS = [
    ['harvest', 118, 404, 136, 40, 1], ['rake', 300, 456, 136, 40, 1],
    ['swing', 598, 414, 146, 40, 1], ['stash', 626, 498, 144, 34, 1]
  ];
  check(JSON.stringify(spots) === JSON.stringify(WANT_SPOTS),
    `${label}: the signposts are still at their authored coordinates`, JSON.stringify(spots));
}

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
  await checkFlat(lp, 'landscape');
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
  await checkFlat(dp, 'desktop');
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
