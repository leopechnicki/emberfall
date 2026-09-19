/* EMBERFALL - the phone gate.
 *
 * This file exists because of one specific complaint: a shared HTML build
 * "was not good to navigate on my phone". Everything below turns that
 * complaint into a measurement, taken in a real touch context in real Google
 * Chrome, so "works on mobile" stops being an opinion.
 *
 * The three things it refuses to let regress, worst first:
 *
 *  1. THE DEAD END. leaveMode() used to be reachable only from ESC. A phone
 *     has no ESC key, so entering the orchard, the yard or the grove was a
 *     one-way door: play it to the end or reload the page. No amount of
 *     screen-space tuning matters next to that.
 *
 *  2. SCREEN USE. The scene is a fixed 720x540 logical space, so in portrait
 *     the canvas is ALREADY as wide as the phone and cannot grow without
 *     cropping the grove out of frame. What was wrong was the 551 px of dead
 *     plum underneath it - the game used 35% of the screen. The fix turns
 *     that dead space into the controls, which is why this measures canvas
 *     PLUS controls and never the canvas alone.
 *
 *  3. HIT SIZE. 44 CSS px is the documented minimum finger target. The mute
 *     dot drawn on the canvas measured 21 px across in portrait.
 *
 * It also asserts the thing that makes all of the above safe to ship: on a
 * fine-pointer desktop the pad is display:none, so the desktop build this
 * project already verified at 47/47 is untouched.
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

/* A real browser-dispatched touch, in game units. Hand-built PointerEvents
   are non-primary, main.js is right to drop them, and Skyhook already burned
   a whole green suite on exactly that mistake. */
async function tap(page, x, y) {
  const b = await page.locator('#game').boundingBox();
  await page.touchscreen.tap(b.x + (x / W) * b.width, b.y + (y / H) * b.height);
}

/* A finger drag across the canvas: press, move, lift. This is the ONLY way to
   aim the basket or the rake on a phone - a desktop mouse gets pointermove
   for free by hovering, a finger has to be held down. Playwright has no touch
   drag, so this goes through CDP directly. */
async function drag(page, from, to) {
  const b = await page.locator('#game').boundingBox();
  const P = p => ({ x: b.x + (p.x / W) * b.width, y: b.y + (p.y / H) * b.height });
  const a = P(from), z = P(to);
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

/* Every control's box, measured the way a thumb meets it. */
function padBoxes(page) {
  return page.evaluate(() => {
    const pad = document.getElementById('pad');
    if (!pad) return null;
    const r = pad.getBoundingClientRect();
    return {
      visible: getComputedStyle(pad).display !== 'none',
      w: Math.round(r.width),
      h: Math.round(r.height),
      buttons: [...pad.querySelectorAll('button')].map(b => {
        const q = b.getBoundingClientRect();
        return {
          id: b.id, w: Math.round(q.width), h: Math.round(q.height),
          disabled: b.disabled, label: (b.textContent || '').trim()
        };
      })
    };
  });
}

/* Canvas + controls as a share of the screen. Dead letterbox is the metric
   this project was failing, so it is the metric the gate uses. */
function coverage(page) {
  return page.evaluate(() => {
    const area = el => {
      if (!el) return 0;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return 0;
      const r = el.getBoundingClientRect();
      return Math.max(0, r.width) * Math.max(0, r.height);
    };
    const used = area(document.getElementById('game')) + area(document.getElementById('pad'));
    return { pct: Math.round((100 * used) / (innerWidth * innerHeight)), vw: innerWidth, vh: innerHeight };
  });
}

/* ------------------------------------------------------------ the suite */

const { browser, channel, why } = await launch({ headed: process.argv.includes('--headed') });
console.log('browser channel: ' + channel + (why ? '  (' + why + ')' : ''));
console.log('(channel is reported, not asserted: CI has no Google Chrome and falls back to Chromium loudly)');

for (const [name, viewport, minPct] of [
  ['portrait', PORTRAIT, 55],
  ['landscape', LANDSCAPE, 85]
]) {
  console.log('\n--- ' + name + '  ' + viewport.width + 'x' + viewport.height + ' ---');
  const { ctx, page, errors } = await open(browser, viewport);

  /* 1. it is the game, on a phone */
  const boot = await snap(page);
  check(boot.state === 'title', name + ': boots to the title on a phone', boot.state);

  /* 2. screen use */
  const cov = await coverage(page);
  check(cov.pct >= minPct, name + ': game + controls fill the screen',
    cov.pct + '% of ' + cov.vw + 'x' + cov.vh + ' (floor ' + minPct + '%)');

  /* 3. the controls exist, are visible on touch, and are thumb-sized */
  const pad = await padBoxes(page);
  check(!!pad, name + ': a touch control pad exists', pad ? 'yes' : 'no #pad in the DOM');
  if (pad) {
    check(pad.visible, name + ': the pad is visible on a coarse pointer');
    const ids = pad.buttons.map(b => b.id).sort().join(',');
    check(ids === 'pad-action,pad-back,pad-mute',
      name + ': pad carries back / action / mute', ids);
    const small = pad.buttons.filter(b => b.w < MIN_TAP || b.h < MIN_TAP);
    check(small.length === 0, name + ': every control is at least ' + MIN_TAP + 'x' + MIN_TAP + ' CSS px',
      small.length ? JSON.stringify(small)
                   : pad.buttons.map(b => b.id + ' ' + b.w + 'x' + b.h).join('  '));
  }

  /* 4. a tap starts the game */
  await tap(page, 360, 270);
  const valley = await waitState(page, 'valley');
  check(valley.state === 'valley', name + ': a tap on the title opens the valley', valley.state);

  /* 5. THE VINE SWING ON TOUCH - the activity Leo named by name */
  await tap(page, 598, 414);
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

  /* 6. the ACTION button is a second, thumb-sized way to do the same thing.
        The point of a control pad is that you do not have to poke a
        letterboxed canvas to play the game. */
  const hooksBefore = (await snap(page)).mode.hooks;
  let afterBtn = null;
  for (let attempt = 0; attempt < 4 && !afterBtn; attempt++) {
    await page.locator('#pad-action').tap();
    afterBtn = await pollFor(page, s => !!s.mode && s.mode.hooks > hooksBefore, 1200);
  }
  check(!!afterBtn, name + ': the ACTION button hooks a vine too',
    'hooks ' + hooksBefore + ' -> ' + (afterBtn ? afterBtn.mode.hooks : 'unchanged'));

  /* 7. THE DEAD END. The single most important assertion in this file. */
  await page.locator('#pad-back').tap();
  const backOut = await waitState(page, 'valley');
  check(backOut.state === 'valley',
    name + ': BACK leaves the grove without a keyboard', backOut.state);

  /* 8. the positional activities are playable with a finger */
  await tap(page, 118, 404);
  const orchard = await waitState(page, 'harvest');
  check(orchard.state === 'harvest', name + ': the orchard opens on touch', orchard.state);
  if (orchard.state === 'harvest') {
    const x0 = (await snap(page)).mode.basket;
    await drag(page, { x: 150, y: 470 }, { x: 610, y: 470 });
    await wait(400);
    const x1 = (await snap(page)).mode.basket;
    check(Math.abs(x1 - x0) > 60, name + ': a finger drag moves the basket',
      'basket ' + Math.round(x0) + ' -> ' + Math.round(x1));

    await page.locator('#pad-back').tap();
    const out = await waitState(page, 'valley');
    check(out.state === 'valley', name + ': BACK also leaves the orchard', out.state);
  }

  /* 8b. THE YARD. The third activity, and the second positional one. Leo's
        acceptance criterion names all three by name - harvest, rake, swing -
        so a suite that drives two of them and infers the third is exactly the
        kind of green run that gets caught on the phone instead of here. */
  await tap(page, 300, 440);
  const yard = await waitState(page, 'rake');
  check(yard.state === 'rake', name + ': the yard opens on touch', yard.state);
  if (yard.state === 'rake') {
    /* Converge on the pile ring so leaves actually bank, the same way
       verify.mjs sweeps on desktop. One stroke is enough to prove the finger
       reaches the rake; banking is what proves the stroke did work. */
    for (const from of [{ x: 120, y: 500 }, { x: 260, y: 380 }, { x: 400, y: 495 }]) {
      await drag(page, from, { x: 566, y: 424 });
      await wait(120);
    }
    await wait(400);
    const rs = await snap(page);
    check(rs.mode && rs.mode.piled > 0, name + ': a finger sweep banks leaves into piles',
      'piled ' + (rs.mode ? rs.mode.piled + '/' + rs.mode.target : 'no mode'));

    await page.locator('#pad-back').tap();
    const outY = await waitState(page, 'valley');
    check(outY.state === 'valley', name + ': BACK also leaves the yard', outY.state);
  }

  /* 9. mute, which on the canvas was a 21 px dot */
  const mutedBefore = (await snap(page)).muted;
  await page.locator('#pad-mute').tap();
  await wait(200);
  const mutedAfter = (await snap(page)).muted;
  check(mutedBefore !== mutedAfter, name + ': the MUTE control toggles',
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
  const pad = await padBoxes(page);
  check(!!pad && !pad.visible, 'desktop: the touch pad is display:none',
    pad ? 'visible=' + pad.visible : 'no #pad');
  const s = await snap(page);
  check(s.state === 'title', 'desktop: still boots to the title', s.state);
  const geo = await page.evaluate(() => {
    const r = document.getElementById('game').getBoundingClientRect();
    return Math.round(r.width) + 'x' + Math.round(r.height);
  });
  check(geo === '1200x900', 'desktop: canvas still fills the window as before', geo);
  check(errors.length === 0, 'desktop: no errors', errors.length ? JSON.stringify(errors) : 'none');
  await ctx.close();
}

await browser.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
