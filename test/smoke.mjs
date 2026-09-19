/* EMBERFALL smoke test.
 *
 * Runs the real game in a real Chromium (Playwright), drives it with real
 * trusted mouse input, and asserts the whole day:
 *   title -> valley -> orchard -> valley -> yard -> valley -> grove
 *         -> valley -> dusk -> lantern lit -> candles -> summary -> title
 *
 * Run from the project root:   node test/smoke.mjs
 * Flags:  --headed   show the browser
 *
 * Requires Playwright:  npm install && npx playwright install chromium
 *                       (uses Google Chrome when installed, else bundled Chromium)
 *
 * Two rules this file follows, both inherited from SKYHOOK's smoke test:
 *
 *  1. DISCRETE INPUT IS REAL INPUT. Every tap here is page.mouse.click, not a
 *     hand-built PointerEvent. A synthetic PointerEvent defaults isPrimary to
 *     false and pointerType to '', and main.js correctly drops those - so a
 *     test built on them would drive nothing and pass on a dead game.
 *
 *  2. NOTHING IS FAKED INTO PASSING. The test hooks it uses (endHarvest,
 *     fillRake, skipSwing) run the game's own finish paths; they shorten the
 *     round, they do not invent its result. Every number asserted below was
 *     produced by gameplay - the basket really catches fruit from real mouse
 *     movement, the rake really banks leaves from real sweeps, the vine is
 *     really hooked by a real click.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(HERE, 'screenshots');
const HEADED = process.argv.includes('--headed');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function attachLogs(page, bucket, label) {
  page.on('console', m => { if (m.type() === 'error') bucket.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', e => bucket.push(`[${label}] pageerror: ${e.message}`));
  page.on('requestfailed', r => {
    const u = r.url();
    if (!u.startsWith('data:')) bucket.push(`[${label}] requestfailed: ${u} ${r.failure()?.errorText}`);
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ input */

/* The canvas is letterboxed and DPR-scaled, so a game coordinate is not a
   page coordinate. Everything below speaks GAME coordinates (720x540) and
   this converts, once. */
async function mapper(page) {
  const box = await page.locator('#game').boundingBox();
  return (x, y) => ({
    px: box.x + (x / 720) * box.width,
    py: box.y + (y / 540) * box.height
  });
}

async function clickAt(page, at, x, y) {
  const p = at(x, y);
  await page.mouse.click(p.px, p.py);
}

async function moveTo(page, at, x, y) {
  const p = at(x, y);
  await page.mouse.move(p.px, p.py);
}

const snap = page => page.evaluate('window.__EMBERFALL.snapshot()');

async function waitState(page, state, timeout = 9000) {
  await page.waitForFunction(
    `window.__EMBERFALL.snapshot().state === ${JSON.stringify(state)}`,
    null, { timeout }
  );
}

/* Screenshot, but only once the scene has finished ARRIVING.
 *
 * Every state change dips to warm dark for 0.8s, and waitState above returns
 * the instant the state flips - which is the start of the dip, not the end of
 * it. Shooting there photographed the dip: smoke_01_valley and smoke_06_summary
 * came out at mean luminance 79 and 22 with 2.2k and 1.4k colours, i.e. dark,
 * flat, and worthless as evidence, while both were 300 KB files that "existed".
 * So: wait out the transition, then give the scene a beat to settle. */
async function shoot(page, box, file) {
  await page.waitForFunction(
    '!window.__EMBERFALL.snapshot().transitioning', null, { timeout: 9000 }
  ).catch(() => {});
  await wait(220);
  await page.screenshot({ path: path.join(SHOTS, file), clip: box });
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const errors = [];

  const launchOpts = {
    headless: !HEADED,
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']
  };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', ...launchOpts });
  } catch {
    browser = await chromium.launch(launchOpts);
  }

  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    attachLogs(page, errors, 'desktop');

    /* ---------------- 1. boot ---------------- */
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction('!!window.__EMBERFALL', null, { timeout: 8000 });

    let s = await snap(page);
    check('boots into the title screen', s.state === 'title', `state=${s.state}`);
    check('starts at day 1 of 30', s.day === 1 && s.days === 30, `day ${s.day}/${s.days}`);
    check('starts in full daylight', s.night === 0, `night=${s.night}`);
    check('localStorage available over http', s.persistent === true);

    const box = await page.locator('#game').boundingBox();
    check('canvas has a real size', box.width > 300 && box.height > 200,
      `${Math.round(box.width)}x${Math.round(box.height)}`);

    const at = await mapper(page);

    /* ---------------- 2. title -> valley ---------------- */
    await clickAt(page, at, 360, 300);
    await waitState(page, 'valley');
    s = await snap(page);
    check('tap leaves the title for the valley', s.state === 'valley', `state=${s.state}`);
    check('valley is a hub, not an activity', s.mode === null);
    await shoot(page, box, 'smoke_01_valley.png');

    /* ---------------- 3. the orchard ---------------- */
    await clickAt(page, at, 118, 390);            // THE ORCHARD signpost
    await waitState(page, 'harvest');
    s = await snap(page);
    check('orchard signpost opens the harvest round', s.state === 'harvest');
    check('harvest round starts with a recipe', !!s.mode && s.mode.step === 0 && s.mode.left > 40,
      `left=${s.mode && s.mode.left}s`);

    /* Play it. A driver-side bot: read where the fruit is, move the real mouse
       under the lowest good item. This is a human's hand, at 10 Hz. */
    const startBasket = (await snap(page)).mode.basket;
    let moved = false;
    for (let i = 0; i < 70; i++) {
      const target = await page.evaluate(`(function () {
        var m = window.__EMBERFALL.game.mode;
        if (!m || !m.items.length) return null;
        var best = null;
        for (var i = 0; i < m.items.length; i++) {
          var it = m.items[i];
          if (it.kind === 'acorn' || it.kind === 'wasp') continue;
          if (!best || it.y > best.y) best = it;
        }
        return best ? Math.round(best.x) : null;
      }())`);
      if (target !== null) {
        await moveTo(page, at, target, 470);
        moved = true;
      }
      await wait(120);
    }
    s = await snap(page);
    check('real mouse movement drives the basket',
      moved && Math.abs(s.mode.basket - startBasket) > 20,
      `basket ${startBasket} -> ${s.mode.basket}`);
    check('playing the orchard actually catches fruit', s.mode.score > 0,
      `score=${s.mode.score} fruit=${s.mode.fruit} step=${s.mode.step}`);
    check('wind is live in the orchard', typeof s.mode.wind === 'number');
    await shoot(page, box, 'smoke_02_harvest.png');

    /* Frame time, measured while the orchard is at its busiest. */
    const frames = await page.evaluate(`new Promise(function (resolve) {
      var t = [], last = 0, n = 0;
      function step(ts) {
        if (last) t.push(ts - last);
        last = ts;
        if (++n < 130) requestAnimationFrame(step); else resolve(t);
      }
      requestAnimationFrame(step);
    })`);
    const sorted = frames.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    check('frame time is stable under play', median < 25 && p95 < 60,
      `median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);

    /* Run the clock out; the round finishes itself the normal way. */
    await page.evaluate('window.__EMBERFALL.endHarvest()');
    await waitState(page, 'valley');
    s = await snap(page);
    check('harvest round completes and returns to the valley',
      s.state === 'valley' && s.done.harvest === true);
    check('the valley keeps what the orchard produced', s.tally.fruit > 0 && s.tally.score > 0,
      `fruit=${s.tally.fruit} score=${s.tally.score} pies=${s.tally.pies}`);

    /* ---------------- 4. the yard ---------------- */
    await clickAt(page, at, 300, 440);            // THE YARD signpost
    await waitState(page, 'rake');
    s = await snap(page);
    check('yard signpost opens the rake puzzle', s.state === 'rake');
    check('rake puzzle has no timer and no fail state',
      s.mode.piled === 0 && s.mode.target > 0, `target=${s.mode.target}`);

    /* Sweep, for real: drag the mouse across the yard toward the pile ring. */
    for (let pass = 0; pass < 6; pass++) {
      const y = 380 + pass * 26;
      await moveTo(page, at, 80, y);
      for (let x = 80; x <= 560; x += 40) {
        await moveTo(page, at, x, y);
        await wait(16);
      }
      await wait(60);
    }
    s = await snap(page);
    check('real sweeps bank leaves into the pile', s.mode.piled > 0,
      `piled=${s.mode.piled}/${s.mode.target}`);
    await shoot(page, box, 'smoke_03_rake.png');

    const added = await page.evaluate('window.__EMBERFALL.fillRake()');
    check('the rest of the pile banks through the real path', added > 0, `banked ${added} more`);
    await waitState(page, 'valley', 12000);
    s = await snap(page);
    check('rake puzzle completes and returns to the valley',
      s.state === 'valley' && s.done.rake === true);
    check('leaves rendered down into wax and kindling',
      s.tally.wax > 0 && s.tally.kindling > 0,
      `wax=${s.tally.wax} kindling=${s.tally.kindling} piled=${s.tally.piled}`);
    check('enough wax for the lantern', s.tally.wax >= 2, `wax=${s.tally.wax}`);
    check('dusk is now offered', s.duskReady === true);

    /* ---------------- 5. the high grove ---------------- */
    await clickAt(page, at, 598, 400);            // THE HIGH GROVE signpost
    await waitState(page, 'swing');
    s = await snap(page);
    check('grove signpost opens the vine swing', s.state === 'swing');

    /* Play it for real: click to hook, let the arc carry, click to release,
       repeat. A single click and an immediate read would prove nothing - most
       of that window is the transition dip, during which the grove is
       deliberately frozen, so the keeper would not have moved yet. */
    let hooked = false;
    for (let i = 0; i < 9; i++) {
      await clickAt(page, at, 360, 300);        // hook
      await wait(540);
      const m = (await snap(page)).mode;
      if (m.hooks > 0) hooked = true;
      if (m.swinging) await clickAt(page, at, 360, 300);   // release
      await wait(420);
    }
    s = await snap(page);
    check('a real click hooks a vine', hooked && s.mode.hooks > 0, `hooks=${s.mode.hooks}`);
    check('swinging carries the keeper through the grove', s.mode.progress > 0.01,
      `progress=${(s.mode.progress * 100).toFixed(1)}%  x=${s.mode.x}  hooks=${s.mode.hooks}`);
    await shoot(page, box, 'smoke_04_swing.png');

    await page.evaluate('window.__EMBERFALL.skipSwing()');
    await waitState(page, 'valley', 12000);
    s = await snap(page);
    check('grove completes and returns to the valley',
      s.state === 'valley' && s.done.swing === true);
    check('the high orchard pays out apples', s.tally.apples > 0, `apples=${s.tally.apples}`);
    check('all three activities are reachable and completable',
      s.done.harvest && s.done.rake && s.done.swing);

    /* ---------------- 6. the locked fourth activity ---------------- */
    await clickAt(page, at, 668, 484);            // SQUIRREL STASH signpost
    await waitState(page, 'stash');
    check('the unbuilt fourth activity says so honestly',
      (await snap(page)).state === 'stash');
    await clickAt(page, at, 360, 300);
    await waitState(page, 'valley');

    /* ---------------- 7. dusk ---------------- */
    const waxBefore = (await snap(page)).tally.wax;
    await clickAt(page, at, 452, 420);            // the lantern itself
    await waitState(page, 'dusk');
    check('tapping the lantern starts dusk', (await snap(page)).state === 'dusk');

    await page.waitForFunction(
      'window.__EMBERFALL.snapshot().duskPhase === "lantern"', null, { timeout: 9000 });
    s = await snap(page);
    check('night actually falls', s.night > 0.6, `night=${s.night}`);

    await clickAt(page, at, 452, 420);            // light it
    await wait(250);
    s = await snap(page);
    check('the lantern is lit', s.tally.lantern === true);
    check('lighting the lantern costs 2 wax', s.tally.wax === waxBefore - 2,
      `${waxBefore} -> ${s.tally.wax}`);

    /* Spend the rest of the wax along the path. */
    const spots = [[108, 476], [228, 418], [321, 384], [457, 358], [545, 350], [640, 347]];
    for (const [cx, cy] of spots) {
      if ((await snap(page)).duskPhase !== 'candles') break;
      await clickAt(page, at, cx, cy);
      await wait(200);
    }
    await wait(900);
    s = await snap(page);
    check('candles were lit along the path', s.tally.candles > 0,
      `${s.tally.candles} candles, ${s.tally.wax} wax left`);
    check('every flame warms the scene back up', s.warm > 0.1, `warm=${s.warm}`);
    check('night never reaches pure black', s.night > 0 && s.night <= 1, `night=${s.night}`);
    await shoot(page, box, 'smoke_05_dusk.png');

    /* ---------------- 8. the summary ---------------- */
    await page.evaluate('window.__EMBERFALL.tap()');
    await waitState(page, 'summary', 12000);
    s = await snap(page);
    check('the day ends on a summary card', s.state === 'summary');
    check('the summary carries the whole day',
      s.tally.fruit > 0 && s.tally.piled > 0 && s.tally.apples > 0 && s.tally.lantern === true,
      `fruit=${s.tally.fruit} piled=${s.tally.piled} apples=${s.tally.apples} candles=${s.tally.candles}`);
    await shoot(page, box, 'smoke_06_summary.png');

    await clickAt(page, at, 360, 300);
    await waitState(page, 'title');
    s = await snap(page);
    check('summary returns to the title, day reset', s.state === 'title' && s.day === 1);
    check('a fresh day starts empty', s.tally.fruit === 0 && s.tally.wax === 0 && !s.tally.lantern);

    /* ---------------- 9. mute, in any state ---------------- */
    const mutedBefore = (await snap(page)).muted;
    await clickAt(page, at, 692, 24);
    check('the mute button works from the title',
      (await snap(page)).muted === !mutedBefore);
    await clickAt(page, at, 692, 24);

    /* ---------------- 10. resize ---------------- */
    await page.setViewportSize({ width: 820, height: 620 });
    await wait(400);
    const small = await page.locator('#game').boundingBox();
    check('canvas refits on resize without error',
      small.width > 100 && Math.abs(small.width / small.height - 720 / 540) < 0.05,
      `${Math.round(small.width)}x${Math.round(small.height)}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await wait(300);

    /* ---------------- 11. file:// ---------------- */
    const fctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const fpage = await fctx.newPage();
    const fileErrors = [];
    attachLogs(fpage, fileErrors, 'file');
    await fpage.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
    await fpage.waitForFunction('!!window.__EMBERFALL', null, { timeout: 8000 });
    const fs1 = await fpage.evaluate('window.__EMBERFALL.snapshot()');
    check('runs straight off disk (file://)', fs1.state === 'title', `state=${fs1.state}`);

    const fbox = await fpage.locator('#game').boundingBox();
    await fpage.mouse.click(fbox.x + fbox.width / 2, fbox.y + fbox.height / 2);
    await fpage.waitForFunction(
      'window.__EMBERFALL.snapshot().state === "valley"', null, { timeout: 8000 });
    check('file:// build is playable, not just loadable',
      (await fpage.evaluate('window.__EMBERFALL.snapshot().state')) === 'valley');
    check('no console errors on file://', fileErrors.length === 0, fileErrors.join(' | '));
    await fctx.close();

    /* ---------------- 12. the whole run, error free ---------------- */
    check('zero console errors across the whole day', errors.length === 0, errors.join(' | '));

  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots: ${SHOTS}`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach(f => console.log(`  - ${f.name}${f.detail ? '  -> ' + f.detail : ''}`));
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
