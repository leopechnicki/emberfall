/* EMBERFALL - the phone gate.
 *
 * This file exists because of one specific complaint, twice over. First: a
 * shared HTML build "was not good to navigate on my phone" - fixed by giving
 * the game a real touch pad. Then Klaudia looked at THAT build and rejected
 * it too: "the game is on a tiny screen and the buttons eat the rest of it -
 * it looks AI-generated." The pad had solved reachability by spending 45% of
 * a phone screen on DOM chrome under a letterboxed canvas.
 *
 * The fix this file now guards is structural, not cosmetic: the canvas
 * element IS the viewport (js/main.js:fit()), the space a 4:3 scene used to
 * leave empty is real drawn world (js/utils.js:EF.bleed), and the two
 * controls that need a finger are painted onto that world instead of living
 * in the DOM (js/main.js:padButton). There is no #pad any more - that is
 * the assertion this file would have failed against the OLD build and must
 * keep failing against if it ever comes back.
 *
 * The four things it refuses to let regress, worst first:
 *
 *  1. THE DEAD END. leaveMode() is reachable only through the on-canvas BACK
 *     control and ESC. A phone has no ESC key, so entering the orchard, the
 *     yard or the grove must not be a one-way door.
 *
 *  2. SCREEN USE. The canvas must be the screen - not "canvas plus a control
 *     strip", the metric the OLD gate used and the metric that let a 55%
 *     build through. This gate measures the canvas ALONE against the
 *     viewport and asserts it high.
 *
 *  3. NO DOM CHROME OVER THE GAME. #pad must not exist in the markup at all.
 *
 *  4. HIT SIZE. 44 CSS px is the documented minimum finger target. The
 *     on-canvas BACK and ACTION controls are measured in real CSS pixels via
 *     EF.px(), which is the whole reason that helper exists.
 *
 * It also asserts the thing that makes all of the above safe to ship: on a
 * fine-pointer desktop nothing here activates - no pad geometry, no bleed -
 * so the desktop build verify.mjs already checks 46/46 is untouched.
 */
import { launch, INDEX_URL, W, H, wait } from './harness.mjs';

const MIN_TAP   = 44;                            // CSS px - WCAG 2.5.5 / Apple HIG
const PORTRAIT  = { width: 390, height: 844 };   // iPhone 14/15 class
const LANDSCAPE = { width: 844, height: 390 };

let pass = 0, fail = 0;
const ok  = (n, x) => { pass++; console.log('PASS  ' + n + (x ? '  -> ' + x : '')); };
const bad = (n, x) => { fail++; console.log('FAIL  ' + n + (x ? '  -> ' + x : '')); };
const check = (cond, n, x) => (cond ? ok(n, x) : bad(n, x));

/* ------------------------------------------------------------- plumbing */

async function open(browser, viewport, { touch = true } = {}) {
  const ctx = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: touch ? 3 : 1
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', r => {
    const u = r.url();
    if (!u.startsWith('data:')) errors.push('requestfailed: ' + u);
  });
  await page.goto(INDEX_URL, { waitUntil: 'load' });
  await page.waitForFunction('!!window.__EMBERFALL', null, { timeout: 15000 });
  await wait(400);
  return { ctx, page, errors };
}

const snap = page => page.evaluate('window.__EMBERFALL.snapshot()');

/* Everything a real tap needs to convert a LOGICAL game coordinate (the same
   space every hand-placed scene coordinate lives in - see js/utils.js
   EF.bleed) into a real page pixel: the canvas's own box, plus however much
   bled world main.js is currently drawing above/left/right of the scene.
   Bleed is why this cannot just be "x/W * canvas width" any more - a tap at
   logical (0,0) is the TOP-LEFT OF THE SCENE, not the top-left of the
   canvas, once there is sky bled in above it. */
async function frame(page) {
  return page.evaluate(() => {
    const r = document.getElementById('game').getBoundingClientRect();
    return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, bleed: window.EF.bleed };
  });
}

function toPage(info, x, y) {
  const b = info.bleed;
  const totalW = W + b.x * 2, totalH = H + b.top + b.bottom;
  return {
    x: info.rect.x + (x + b.x) / totalW * info.rect.width,
    y: info.rect.y + (y + b.top) / totalH * info.rect.height
  };
}

/* A real browser-dispatched touch, in game units. Hand-built PointerEvents
   are non-primary, main.js is right to drop them, and Skyhook already burned
   a whole green suite on exactly that mistake. */
async function tap(page, x, y) {
  const info = await frame(page);
  const p = toPage(info, x, y);
  await page.touchscreen.tap(p.x, p.y);
}

/* A finger drag across the canvas: press, move, lift. This is the ONLY way to
   aim the basket or the rake on a phone - a desktop mouse gets pointermove
   for free by hovering, a finger has to be held down. Playwright has no touch
   drag, so this goes through CDP directly. */
async function drag(page, from, to) {
  const info = await frame(page);
  const a = toPage(info, from.x, from.y), z = toPage(info, to.x, to.y);
  const cdp = await page.context().newCDPSession(page);
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

/* Poll the real snapshot until it satisfies a predicate. Never a fixed sleep:
   the swing auto-releases the moment the arc brings the keeper back down to
   the grass (swing.js: "the rope can never grind you along it"), so whether
   `swinging` is still true 400 ms after a hook depends on where the arc
   started. Sleeping and then looking is how that becomes a flaky test. */
async function pollFor(page, pred, timeout = 1200) {
  const t0 = Date.now();
  for (;;) {
    const s = await snap(page);
    if (pred(s)) return s;
    if (Date.now() - t0 > timeout) return null;
    await wait(40);
  }
}

async function waitState(page, state, timeout = 9000) {
  const t0 = Date.now();
  for (;;) {
    const s = await snap(page);
    if (s.state === state && !s.transitioning) return s;
    if (Date.now() - t0 > timeout) return s;
    await wait(80);
  }
}

/* The on-canvas pad's current geometry, in logical units - js/main.js exposes
   this exactly so tests can drive and measure the real controls instead of a
   DOM stand-in. Converted here into the real CSS pixels a thumb meets, using
   the same cssPerUnit main.js used to draw them. */
async function padBoxes(page) {
  return page.evaluate(() => {
    const geom = window.__EMBERFALL.padGeom();
    if (!geom) return null;
    const r = document.getElementById('game').getBoundingClientRect();
    const b = window.EF.bleed;
    const totalW = 720 + b.x * 2, totalH = 540 + b.top + b.bottom;
    const toCss = (rect) => ({
      w: Math.round(rect.w / totalW * r.width),
      h: Math.round(rect.h / totalH * r.height)
    });
    return {
      action: toCss(geom.action),
      back: toCss(geom.back)
    };
  });
}

/* Canvas as a share of the screen - the one metric this project was failing.
   Unlike the old gate, this does NOT add a control strip to the total: the
   controls are inside the canvas now, so "canvas alone" IS "canvas plus
   controls". Measuring anything else would just resurrect the old metric
   under a new name. */
async function canvasCoverage(page) {
  return page.evaluate(() => {
    const r = document.getElementById('game').getBoundingClientRect();
    const used = Math.max(0, r.width) * Math.max(0, r.height);
    return { pct: +(100 * used / (innerWidth * innerHeight)).toFixed(2), vw: innerWidth, vh: innerHeight,
      cw: Math.round(r.width), ch: Math.round(r.height) };
  });
}

/* ------------------------------------------------------------ the suite */

const { browser, channel, why } = await launch({ headed: process.argv.includes('--headed') });
console.log('browser channel: ' + channel + (why ? '  (' + why + ')' : ''));
console.log('(channel is reported, not asserted: CI has no Google Chrome and falls back to Chromium loudly)');

for (const [name, viewport, minPct] of [
  ['portrait', PORTRAIT, 95],
  ['landscape', LANDSCAPE, 95]
]) {
  console.log('\n--- ' + name + '  ' + viewport.width + 'x' + viewport.height + ' ---');
  const { ctx, page, errors } = await open(browser, viewport);

  /* 1. it is the game, on a phone */
  const boot = await snap(page);
  check(boot.state === 'title', name + ': boots to the title on a phone', boot.state);

  /* 2. no DOM chrome over the game - the specific thing Klaudia rejected */
  const domPad = await page.evaluate(() => !!document.getElementById('pad'));
  check(!domPad, name + ': there is no #pad in the DOM at all', domPad ? 'found one' : 'none');

  /* 3. screen use - the canvas alone, no control strip added to the total */
  const cov = await canvasCoverage(page);
  check(cov.pct >= minPct, name + ': the canvas alone fills the screen',
    cov.pct + '% (' + cov.cw + 'x' + cov.ch + ' of ' + cov.vw + 'x' + cov.vh + ', floor ' + minPct + '%)');

  /* Tap a signpost wherever the CURRENT layout put it. */
  async function tapSpot(pg, id) {
    const sp = await pg.evaluate(
      wanted => (window.__EMBERFALL.spots() || []).find(s => s.id === wanted) || null, id);
    if (!sp) throw new Error('no signpost with id ' + id);
    await tap(pg, sp.x, sp.y - (sp.h * 0.5) * (sp.s || 1));
  }

  /* 4. the on-canvas controls exist and are thumb-sized */
  const pad = await padBoxes(page);
  check(!!pad, name + ': the on-canvas pad reports its geometry', pad ? 'yes' : 'no padGeom()');
  if (pad) {
    const boxes = [['action', pad.action], ['back', pad.back]];
    const small = boxes.filter(([, b]) => b.w < MIN_TAP || b.h < MIN_TAP);
    check(small.length === 0, name + ': every on-canvas control is at least ' + MIN_TAP + 'x' + MIN_TAP + ' CSS px',
      boxes.map(([id, b]) => id + ' ' + b.w + 'x' + b.h).join('  '));
  }

  /* 5. a tap starts the game */
  await tap(page, 360, 270);
  const valley = await waitState(page, 'valley');
  check(valley.state === 'valley', name + ': a tap on the title opens the valley', valley.state);

  /* 6. THE VINE SWING ON TOUCH - the activity Leo named by name.

     The sign's position is ASKED FOR, not hard-coded. It used to be a
     literal tap at (598, 414) - the coordinates the sign has in the
     authored 720x540 box - which silently became a tap on SQUIRREL STASH
     the moment portrait started composing the valley for a tall screen.
     The test went red on a layout change that was entirely correct, which
     is the same "two hand-kept copies of where the sign is" bug the hit
     test itself was fixed for. */
  const groveSpot = await page.evaluate(
    () => (window.__EMBERFALL.spots() || []).find(s => s.id === 'swing') || null);
  check(!!groveSpot, name + ': the valley reports where THE HIGH GROVE sign is',
    groveSpot ? `x=${Math.round(groveSpot.x)} y=${Math.round(groveSpot.y)} s=${(groveSpot.s || 1).toFixed(2)}` : 'no spots()');
  /* the middle of the plank: the post hangs BELOW the origin, the board above it */
  await tap(page, groveSpot.x, groveSpot.y - (groveSpot.h * 0.5) * (groveSpot.s || 1));
  const grove = await waitState(page, 'swing');
  check(grove.state === 'swing', name + ': tapping THE HIGH GROVE opens the vine swing', grove.state);

  /* Up to four attempts, because a hook thrown from low on the arc can be
     auto-released by the ground before the next poll. The assertion is that
     touch CAN hook and CAN release, not that any particular tap does. */
  let hookedSnap = null, releasedSnap = null;
  for (let attempt = 0; attempt < 4 && !releasedSnap; attempt++) {
    await tap(page, 360, 300);
    const sw = await pollFor(page, s => !!s.mode && s.mode.swinging === true, 1200);
    if (!sw) continue;
    hookedSnap = sw;
    await tap(page, 360, 300);
    releasedSnap = await pollFor(page, s => !!s.mode && s.mode.swinging === false, 1200);
  }
  check(!!hookedSnap, name + ': a touch tap hooks a vine',
    hookedSnap ? 'hooks=' + hookedSnap.mode.hooks + ' swinging=true' : 'never entered a swing');
  check(!!releasedSnap, name + ': a second tap lets go',
    releasedSnap ? 'swinging=false at hooks=' + releasedSnap.mode.hooks : 'still swinging');

  /* 7. the ACTION control is a second, thumb-sized way to do the same thing -
        painted onto the canvas now, but still hit through the real onDown()
        decision (hitPad), not a shortcut that skips it. */
  const hooksBefore = (await snap(page)).mode.hooks;
  let afterBtn = null;
  for (let attempt = 0; attempt < 4 && !afterBtn; attempt++) {
    const geom = await page.evaluate(() => window.__EMBERFALL.padGeom());
    await tap(page, geom.action.x + geom.action.w / 2, geom.action.y + geom.action.h / 2);
    afterBtn = await pollFor(page, s => !!s.mode && s.mode.hooks > hooksBefore, 1200);
  }
  check(!!afterBtn, name + ': the on-canvas ACTION control hooks a vine too',
    'hooks ' + hooksBefore + ' -> ' + (afterBtn ? afterBtn.mode.hooks : 'unchanged'));

  /* 8. THE DEAD END. The single most important assertion in this file. */
  const backGeom1 = await page.evaluate(() => window.__EMBERFALL.padGeom());
  await tap(page, backGeom1.back.x + backGeom1.back.w / 2, backGeom1.back.y + backGeom1.back.h / 2);
  const backOut = await waitState(page, 'valley');
  check(backOut.state === 'valley',
    name + ': the on-canvas BACK control leaves the grove without a keyboard', backOut.state);

  /* 9. the positional activities are playable with a finger */
  await tapSpot(page, 'harvest');
  const orchard = await waitState(page, 'harvest');
  check(orchard.state === 'harvest', name + ': the orchard opens on touch', orchard.state);
  if (orchard.state === 'harvest') {
    const x0 = (await snap(page)).mode.basket;
    await drag(page, { x: 150, y: 470 }, { x: 610, y: 470 });
    await wait(400);
    const x1 = (await snap(page)).mode.basket;
    check(Math.abs(x1 - x0) > 60, name + ': a finger drag moves the basket',
      'basket ' + Math.round(x0) + ' -> ' + Math.round(x1));

    const bg = await page.evaluate(() => window.__EMBERFALL.padGeom());
    await tap(page, bg.back.x + bg.back.w / 2, bg.back.y + bg.back.h / 2);
    const out = await waitState(page, 'valley');
    check(out.state === 'valley', name + ': BACK also leaves the orchard', out.state);
  }

  /* 9b. THE YARD. The third activity, and the second positional one. Leo's
        acceptance criterion names all three by name - harvest, rake, swing -
        so a suite that drives two of them and infers the third is exactly the
        kind of green run that gets caught on the phone instead of here. */
  await tapSpot(page, 'rake');
  const yard = await waitState(page, 'rake');
  check(yard.state === 'rake', name + ': the yard opens on touch', yard.state);
  if (yard.state === 'rake') {
    /* Converge on the pile ring so leaves actually bank, the same way
       verify.mjs sweeps on desktop. One stroke is enough to prove the finger
       reaches the rake; banking is what proves the stroke did work. */
    const yg = yard.mode;
    const pile = yg.pile, band = yg.yard;
    /* Three strokes that start inside the CURRENT yard and converge on the
       CURRENT pile. The old version dragged at the authored (566,424), which
       in portrait is neither where the leaves are nor where the pile is, so
       it swept clean grass and banked nothing. */
    const lo = band.top + (band.bottom - band.top) * 0.25;
    const hi = band.top + (band.bottom - band.top) * 0.80;
    for (const from of [{ x: 120, y: hi }, { x: 260, y: lo }, { x: 400, y: hi }]) {
      await drag(page, from, { x: pile.x, y: pile.y });
      await wait(120);
    }
    await wait(400);
    const rs = await snap(page);
    check(rs.mode && rs.mode.piled > 0, name + ': a finger sweep banks leaves into piles',
      'piled ' + (rs.mode ? rs.mode.piled + '/' + rs.mode.target : 'no mode'));

    const bg2 = await page.evaluate(() => window.__EMBERFALL.padGeom());
    await tap(page, bg2.back.x + bg2.back.w / 2, bg2.back.y + bg2.back.h / 2);
    const outY = await waitState(page, 'valley');
    check(outY.state === 'valley', name + ': BACK also leaves the yard', outY.state);
  }

  /* 10. mute - drawn on the canvas since before this pass, still a plain tap */
  const mutedBefore = (await snap(page)).muted;
  const muteSpot = await page.evaluate(() => window.__EMBERFALL.muteSpot());
  await tap(page, muteSpot.x, muteSpot.y);
  await wait(200);
  const mutedAfter = (await snap(page)).muted;
  check(mutedBefore !== mutedAfter, name + ': the on-canvas MUTE control toggles',
    mutedBefore + ' -> ' + mutedAfter);

  check(errors.length === 0, name + ': zero page errors across the whole walk',
    errors.length ? JSON.stringify(errors.slice(0, 3)) : 'none');

  await page.screenshot({ path: 'test/screenshots/mobile_' + name + '.png' });
  await ctx.close();
}

/* ----------------------------------------------- desktop non-regression */

console.log('\n--- desktop  1280x900 (fine pointer) ---');
{
  const { ctx, page, errors } = await open(browser, { width: 1280, height: 900 }, { touch: false });
  const domPad = await page.evaluate(() => !!document.getElementById('pad'));
  check(!domPad, 'desktop: there is no #pad in the DOM (it never existed on this build)');
  const geom = await page.evaluate(() => window.__EMBERFALL.padGeom());
  check(geom === null, 'desktop: the on-canvas pad has no geometry on a fine pointer', JSON.stringify(geom));
  const s = await snap(page);
  check(s.state === 'title', 'desktop: still boots to the title', s.state);
  const geoBox = await page.evaluate(() => {
    const r = document.getElementById('game').getBoundingClientRect();
    return Math.round(r.width) + 'x' + Math.round(r.height);
  });
  check(geoBox === '1200x900', 'desktop: canvas still fills the window as before', geoBox);
  check(errors.length === 0, 'desktop: no errors', errors.length ? JSON.stringify(errors) : 'none');
  await ctx.close();
}

await browser.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
