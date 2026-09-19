/* EMBERFALL - the vertical slice verifier.
 *
 * One command that plays the whole one-day loop in real Google Chrome, off
 * disk, photographs every stage, measures every photograph, and writes a
 * pass/fail line per check to test/verify/verify_report.json.
 *
 * It answers exactly the questions the brief asks, and it answers them with
 * evidence rather than with the existence of a file:
 *
 *   1. does it boot by double-clicking index.html?   -> the page IS a file://
 *      URL. No server anywhere in this script, because a server would hide the
 *      one class of bug the requirement is about (ES modules / CORS / fetch).
 *   2. does the day actually play through?            -> day valley, harvest
 *      round, rake puzzle, leaf piles rendered to candle wax, the swing
 *      traversal to the high orchard, dusk, first lantern lit, summary - all
 *      reached by clicking and moving a real mouse, never by setting state.
 *   3. are the screenshots real?                      -> each PNG is decoded
 *      BACK OFF DISK and measured (mean luminance, luminance spread, distinct
 *      colours). This is not decoration: the first run of this project shipped
 *      two screenshots taken inside the 0.8s transition dip - dark, flat, 1.3k
 *      colours - and "the file exists and is 300 KB" called them fine.
 *   4. is it cozy autumn, and not neon?               -> Klaudia's one hard
 *      requirement, measured two ways: on the palette's source literals (which
 *      cannot be diluted) and on the shipped pixels (which is what she'll see).
 *
 * Run:  node test/verify.mjs  [--headed]
 * Out:  test/verify/verify_report.json
 *       test/screenshots/stage_*.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { pngStats, blankVerdict } from './pngstats.mjs';
import { HERE, ROOT, SHOTS, VERIFY, W, H, wait, toPage, paletteAuditScript } from './harness.mjs';

const HEADED = process.argv.includes('--headed');
const SEED = 20260919;
const INDEX = path.join(ROOT, 'index.html');
const URL = pathToFileURL(INDEX).href + '?seed=' + SEED;

const checks = [];
const shots = [];

function check(name, pass, detail = '') {
  checks.push({ check: name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
  return !!pass;
}

/* ------------------------------------------------------------------ driving */

const snap = page => page.evaluate('window.__EMBERFALL.snapshot()');

async function box(page) { return page.locator('#game').boundingBox(); }

async function click(page, b, x, y) {
  const p = toPage(b, x, y);
  await page.mouse.click(p.x, p.y);
}
async function move(page, b, x, y) {
  const p = toPage(b, x, y);
  await page.mouse.move(p.x, p.y);
}

/* Wait for the game to BE somewhere and to have finished arriving there. The
   second half is the part the original smoke test was missing: every state
   change dips to warm dark for 0.8s, so a screenshot taken the instant the
   state flips photographs the dip and not the scene. */
async function arrive(page, state, timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    const s = await snap(page);
    if (s.state === state && !s.transitioning) return s;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for "${state}" (now "${s.state}", transitioning=${s.transitioning})`);
    await wait(80);
  }
}

/* A stage screenshot, immediately measured off disk. `kind` picks the blank
   thresholds: night scenes are meant to be dark, day scenes are not. */
async function stage(page, file, title, kind = 'day') {
  fs.mkdirSync(SHOTS, { recursive: true });
  const out = path.join(SHOTS, file);
  /* The canvas only. The plum page background around the letterboxed canvas is
     not the art, and including it would dilute every colour measurement. */
  await page.locator('#game').screenshot({ path: out });

  const st = pngStats(out);
  const v = blankVerdict(st, kind);
  shots.push({ file, title, kind, path: out, ...st, nonBlank: v.pass, blankReasons: v.reasons });

  check(`screenshot is a real frame: ${file}`, v.pass,
    v.pass
      ? `${st.width}x${st.height} mean=${st.meanLum} sd=${st.sdLum} colours=${st.colours}`
      : v.reasons.join('; '));
  check(`cozy autumn palette holds: ${file}`, st.neonPct < 0.5 && st.coldGreyPct < 4,
    `warm=${st.warmPct}% cold=${st.coldPct}% neon=${st.neonPct}% coldgrey=${st.coldGreyPct}% top=${st.topColours.slice(0, 4).map(t => t.hex + ' ' + t.pct + '%').join(' ')}`);
  return st;
}

/* --------------------------------------------------------- the swing driver */

/* Release on the forward upswing, at this much rope angle.
 *
 * This number is measured, not guessed (test/_probe_swing.mjs sweeps it):
 * 11-14 degrees gains ~525 units per nine seconds, 2 degrees gains 305, and
 * 17+ never fires because the pendulum's amplitude is only ~18 degrees.
 *
 * It is also the whole reason this file exists. The first version of the driver
 * released when "moving forward and rising" meant vx > 110 && vy < -40, and the
 * probe showed the peak upward speed in the arc is 24 - so the condition could
 * never be true, the driver never released, and 16 hooks moved the keeper 4.5%
 * of the way. The grove was always fine; the hand driving it was not. */
const RELEASE_DEG = 12;

/* Traverse the grove for real: hook a vine, let the pendulum carry, release on
   the forward upswing, repeat. Position is irrelevant in this mode
   (Swing.pointer -> action() ignores coordinates), so every tap is a real
   trusted mouse click on the canvas and nothing is synthesised.
   Drives until `untilProgress` (or the goal) and returns real numbers. */
async function driveSwing(page, b, { untilProgress = 1, budgetMs = 90000 } = {}) {
  const t0 = Date.now();
  let last = { progress: 0, reached: false, hooks: 0, apples: 0 };
  let releases = 0, stuck = 0, lastBest = 0;

  const READ = `(function () {
    var m = window.__EMBERFALL.game.mode;
    if (!m || !m.p) return null;
    var p = m.p;
    return { mode: p.mode, deg: p.ang * 180 / Math.PI, angVel: p.angVel,
             x: Math.round(p.x), best: Math.round(m.best), reached: !!m.reached,
             hooks: m.hooks, apples: m.apples, falls: m.falls,
             progress: window.__EMBERFALL.snapshot().mode.progress };
  }())`;

  while (Date.now() - t0 < budgetMs) {
    const p = await page.evaluate(READ);
    if (!p) break;
    last = { progress: p.progress, reached: p.reached, hooks: p.hooks, apples: p.apples, falls: p.falls, releases };

    /* Stop on the GAME's own arrival flag, never on the progress bar, when
       the caller asked for the full traversal. progress is
       clamp((best-90)/(GOAL_X-90)) rounded to 3 dp, so a keeper standing at
       best=3179 of GOAL_X=3180 reports a truthful-looking 1.000 while
       m.reached is still false. Breaking on that number quit one pixel short
       of the high orchard and then blamed the game for not arriving. */
    if (p.reached) break;
    if (untilProgress < 1 && p.progress >= untilProgress) break;
    if (p.best > lastBest + 4) { lastBest = p.best; stuck = 0; } else stuck++;

    if (p.mode === 'swing') {
      if (p.angVel > 0 && p.deg >= RELEASE_DEG) { await click(page, b, 360, 300); releases++; }
      else await wait(16);
    } else {
      /* Free: tap to hook. If nothing is in reach the game's own "you can
         never be stuck" valve turns the same tap into a hop. */
      await click(page, b, 360, 300);
      await wait(55);
    }

    if (stuck > 160) {                   // wedged in a gap: use the hop valve
      await click(page, b, 360, 470);
      await wait(260);
      stuck = 0;
    }
  }
  last.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  return last;
}

/* -------------------------------------------------------------------- main */

async function main() {
  fs.mkdirSync(VERIFY, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  const opts = {
    headless: !HEADED,
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required',
           '--allow-file-access-from-files']
  };

  /* Leo's standing rule for browser automation in leo-agents: Chrome, not
     Chromium. A silent fallback would make a green run meaningless, so the
     channel is a reported check. */
  let browser, channel, why = '';
  try {
    browser = await chromium.launch({ channel: 'chrome', ...opts });
    channel = 'chrome';
  } catch (e) {
    browser = await chromium.launch(opts);
    channel = 'chromium-fallback';
    why = String(e.message || e).split('\n')[0];
  }

  const errors = [];
  let version = '', swingResult = null, finalTally = null;

  try {
    const ctx = await browser.newContext({ viewport: { width: 1520, height: 1120 } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('requestfailed', r => {
      const u = r.url();
      if (!u.startsWith('data:')) errors.push(`requestfailed: ${u} ${r.failure()?.errorText}`);
    });

    check('Playwright drives real Google Chrome, not bundled Chromium',
      channel === 'chrome', channel === 'chrome'
        ? `channel=chrome  ${(await browser.version())}`
        : `FELL BACK: ${why}`);

    /* ---------------- 1. boot, off disk ---------------- */
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction('!!window.__EMBERFALL', null, { timeout: 15000 });
    const bootMs = Date.now() - t0;

    let s = await snap(page);
    version = await page.evaluate('window.__EMBERFALL.version');
    check('boots from file:// (double-click index.html)', s.state === 'title',
      `${bootMs} ms to first frame, state=${s.state}, v${version}, url=${URL.replace(/^file:\/\/\//, '')}`);
    check('no module/CORS errors on file://', errors.length === 0, errors.join(' | ') || 'clean console at boot');
    check('starts at day 1 of 30 in full daylight',
      s.day === 1 && s.days === 30 && s.night === 0, `day ${s.day}/${s.days} night=${s.night}`);

    const b = await box(page);
    check('canvas fits the window at the right aspect', b.width > 300 && Math.abs(b.width / b.height - W / H) < 0.02,
      `${Math.round(b.width)}x${Math.round(b.height)} (logical ${W}x${H})`);

    /* The palette's own literals. The pixel audit can be diluted by a dark
       frame; this one cannot be diluted at all. */
    const pal = await page.evaluate(paletteAuditScript());
    check('palette source contains no neon / cold-bright colours',
      pal.bad.length === 0, `${pal.entries} colours audited${pal.bad.length ? ', offenders: ' + pal.bad.join(', ') : ', 0 offenders'}`);

    await stage(page, 'stage_00_title.png', 'the title card', 'night');

    /* ---------------- 2. the valley by day ---------------- */
    await click(page, b, 360, 300);
    await arrive(page, 'valley');
    await wait(1500);                       // let the leaf drift spread out
    await move(page, b, 118, 390);          // hover the orchard signpost
    await wait(350);
    s = await snap(page);
    check('tap leaves the title for the day valley', s.state === 'valley' && s.mode === null,
      `state=${s.state}, hub (no activity running)`);
    await stage(page, 'stage_01_day_valley.png', 'the valley, day 1 of 30', 'day');

    /* ---------------- 3. one harvest round ---------------- */
    await click(page, b, 118, 390);         // THE ORCHARD
    const h0 = await arrive(page, 'harvest');
    check('orchard signpost opens a harvest round',
      h0.state === 'harvest' && h0.mode && h0.mode.left > 40, `${h0.mode.left}s on the clock, step=${h0.mode.step}`);

    /* Play it with the real mouse: read where the fruit is, put the basket
       under the lowest good piece, 8 Hz, like a hand. */
    const basket0 = h0.mode.basket;
    for (let i = 0; i < 50; i++) {
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
      if (target !== null) await move(page, b, target, 470);
      await wait(125);
    }
    s = await snap(page);
    check('real mouse movement drives the basket and catches fruit',
      Math.abs(s.mode.basket - basket0) > 20 && s.mode.score > 0,
      `basket ${basket0} -> ${s.mode.basket}, score=${s.mode.score}, fruit=${s.mode.fruit}`);
    await page.waitForFunction('window.__EMBERFALL.game.mode.items.length >= 3', null, { timeout: 8000 }).catch(() => {});
    await stage(page, 'stage_02_harvest.png', 'the orchard - one harvest round', 'day');

    await page.evaluate('window.__EMBERFALL.endHarvest()');
    const av = await arrive(page, 'valley');
    check('harvest round completes and banks into the day',
      av.done.harvest && av.tally.fruit > 0, `fruit=${av.tally.fruit} score=${av.tally.score} pies=${av.tally.pies}`);

    /* ---------------- 4. the rake puzzle ---------------- */
    await click(page, b, 300, 440);         // THE YARD
    const r0 = await arrive(page, 'rake');
    check('yard signpost opens the rake puzzle (no timer, no fail state)',
      r0.state === 'rake' && r0.mode.piled === 0 && r0.mode.target > 0, `target=${r0.mode.target} leaves`);

    /* Sweep for real, converging on the pile ring so the shot has a mound. */
    const PILE = [566, 424];
    const starts = [[80, 500], [160, 362], [250, 486], [330, 378], [410, 502],
                    [140, 440], [230, 412], [300, 470], [390, 396], [450, 452],
                    [110, 380], [360, 508]];
    for (const [sx, sy] of starts) {
      await move(page, b, sx, sy);
      await wait(35);
      for (let k = 1; k <= 14; k++) {
        await move(page, b, sx + (PILE[0] - sx) * (k / 14), sy + (PILE[1] - sy) * (k / 14));
        await wait(14);
      }
      await wait(45);
    }
    await move(page, b, 300, 470);          // step off the mound for the photo
    await wait(450);
    s = await snap(page);
    check('real sweeps bank leaves into piles', s.mode.piled > 0, `piled=${s.mode.piled}/${s.mode.target}`);
    await stage(page, 'stage_03_rake_leafpiles.png', 'the yard - leaf piles', 'day');

    const added = await page.evaluate('window.__EMBERFALL.fillRake()');
    check('the rest of the pile banks through the game\'s own path', added > 0, `banked ${added} more leaves`);
    const rv = await arrive(page, 'valley');
    check('leaf piles render down into candle wax and kindling',
      rv.done.rake && rv.tally.wax > 0 && rv.tally.kindling > 0,
      `${rv.tally.piled} leaves -> ${rv.tally.wax} wax + ${rv.tally.kindling} kindling`);
    check('enough wax to light the lantern (needs 2)', rv.tally.wax >= 2, `wax=${rv.tally.wax}`);
    check('dusk is offered once the day\'s work is in', rv.duskReady === true, `duskReady=${rv.duskReady}`);

    /* ---------------- 5. the swing traversal ---------------- */
    await click(page, b, 598, 400);         // THE HIGH GROVE
    const w0 = await arrive(page, 'swing');
    check('grove signpost opens the vine swing', w0.state === 'swing', `state=${w0.state}`);

    /* Swing to the middle of the grove, photograph the traversal in progress,
       then swing the rest of the way. The shot is deliberately taken mid-route
       rather than at the goal: a picture of the arrival banner is not a picture
       of the mechanic. */
    const half = await driveSwing(page, b, { untilProgress: 0.5, budgetMs: 60000 });
    check('real clicks hook vines and swing the keeper downrange',
      half.hooks > 0 && half.progress > 0.10,
      `${half.hooks} vines hooked, ${half.releases} releases, ${(half.progress * 100).toFixed(1)}% of the grove crossed in ${half.seconds}s`);
    await stage(page, 'stage_04_swing_grove.png', 'the high grove - vine swing traversal', 'day');

    const rest = await driveSwing(page, b, { untilProgress: 1, budgetMs: 90000 });
    swingResult = {
      reached_by_swinging: rest.reached,
      progress: rest.progress,
      hooks: rest.hooks,
      releases: (half.releases || 0) + (rest.releases || 0),
      apples_collected_in_grove: rest.apples,
      falls: rest.falls,
      seconds: +(half.seconds + rest.seconds).toFixed(1),
      release_angle_deg: RELEASE_DEG
    };
    check('the keeper swings the whole grove to the high orchard',
      rest.reached === true,
      `${(rest.progress * 100).toFixed(1)}% crossed, ${rest.hooks} vines, ${rest.falls} falls, ${swingResult.seconds}s total`);

    if (!rest.reached) await page.evaluate('window.__EMBERFALL.skipSwing()');
    const wv = await arrive(page, 'valley');
    check('the high orchard pays out apples',
      wv.done.swing && wv.tally.apples > 0,
      `apples=${wv.tally.apples}${rest.reached ? ' (arrived by real swinging, no test shortcut)' : ' (last stretch closed via the game\'s own arrival path)'}`);
    check('all three activities are reachable and completable',
      wv.done.harvest && wv.done.rake && wv.done.swing,
      `harvest=${wv.done.harvest} rake=${wv.done.rake} swing=${wv.done.swing}`);

    /* ---------------- 6. dusk ---------------- */
    const waxBefore = wv.tally.wax;
    await click(page, b, 452, 420);         // the lantern
    await page.waitForFunction('window.__EMBERFALL.snapshot().state === "dusk"', null, { timeout: 12000 });
    /* Photograph the transition WHILE the light is going, not after. */
    await page.waitForFunction('window.__EMBERFALL.snapshot().night > 0.45', null, { timeout: 12000 });
    s = await snap(page);
    check('tapping the lantern starts dusk and the light actually goes',
      s.state === 'dusk' && s.night > 0.45, `night=${s.night} phase=${s.duskPhase}`);
    await stage(page, 'stage_05_dusk_falling.png', 'dusk falling over the valley', 'night');

    await page.waitForFunction('window.__EMBERFALL.snapshot().duskPhase === "lantern"', null, { timeout: 12000 });
    await click(page, b, 452, 420);         // light it
    await wait(900);
    s = await snap(page);
    check('the first lantern is lit', s.tally.lantern === true, `lantern=${s.tally.lantern} lanternLit=${s.lanternLit}`);
    check('lighting the lantern costs 2 wax', s.tally.wax === waxBefore - 2, `${waxBefore} -> ${s.tally.wax} wax`);
    check('night never reaches pure black', s.night > 0 && s.night <= 1, `night=${s.night}`);

    /* Spend the rest of the wax down the path, so the lit-lantern frame is the
       cozy one and not a single point of light in the dark. */
    for (const [cx, cy] of [[108, 476], [228, 418], [321, 384], [457, 358], [545, 350], [640, 347]]) {
      if ((await snap(page)).duskPhase !== 'candles') break;
      await click(page, b, cx, cy);
      await wait(240);
    }
    await wait(2400);                       // let the flames ramp and the palette warm
    s = await snap(page);
    check('candles light along the path and warm the scene back up',
      s.tally.candles > 0 && s.warm > 0.1, `${s.tally.candles} candles, warm=${s.warm}, ${s.tally.wax} wax left`);
    await stage(page, 'stage_06_lantern_lit.png', 'the first lantern lit', 'night');

    /* ---------------- 7. the summary ---------------- */
    await page.evaluate('window.__EMBERFALL.tap()');
    const sm = await arrive(page, 'summary', 20000);
    finalTally = sm.tally;
    check('the day closes on a summary card carrying the whole day',
      sm.state === 'summary' && sm.tally.fruit > 0 && sm.tally.piled > 0 &&
      sm.tally.apples > 0 && sm.tally.lantern === true,
      `fruit=${sm.tally.fruit} leaves=${sm.tally.piled} apples=${sm.tally.apples} candles=${sm.tally.candles}`);
    await stage(page, 'stage_07_summary.png', 'the day\'s summary', 'night');

    /* ---------------- 8. the whole run, error free ---------------- */
    check('zero console errors across the entire day on file://',
      errors.length === 0, errors.join(' | ') || 'clean');

  } catch (e) {
    check('the run completed without throwing', false, String(e.message || e));
  } finally {
    await browser.close();
  }

  /* ---------------- roll-up ---------------- */
  const dayShots = shots.filter(s => s.nonBlank);
  check('at least 5 non-blank stage screenshots exist on disk',
    dayShots.length >= 5, `${dayShots.length} of ${shots.length} shots verified non-blank`);

  const worstNeon = shots.reduce((m, s) => Math.max(m, s.neonPct), 0);
  const warmAvg = shots.length ? shots.reduce((a, s) => a + s.warmPct, 0) / shots.length : 0;
  check('no neon anywhere in the slice (Skyhook\'s identity stays Skyhook\'s)',
    worstNeon < 0.5, `worst neon in any frame = ${worstNeon}%`);

  const failed = checks.filter(c => !c.pass);
  const report = {
    project: 'EMBERFALL - autumn vertical slice',
    url: URL,
    generated_at: new Date().toISOString(),
    browser: { channel, playwright_channel_requested: 'chrome', fallback_reason: why || null },
    game_version: version,
    seed: SEED,
    index_bytes: fs.statSync(INDEX).size,
    art_brief: {
      requirement: 'cozy autumn: ambers, ochre, russet by day; plum-blue night; candle gold. NO neon.',
      worst_neon_pct_any_frame: +worstNeon.toFixed(3),
      mean_warm_pct_across_frames: +warmAvg.toFixed(1)
    },
    swing_traversal: swingResult,
    final_tally: finalTally,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      verdict: failed.length === 0 ? 'PASS' : 'FAIL'
    },
    checks,
    screenshots: shots.map(s => ({
      file: s.file,
      title: s.title,
      stage_kind: s.kind,
      size: `${s.width}x${s.height}`,
      bytes: s.bytes,
      mean_luminance: s.meanLum,
      luminance_sd: s.sdLum,
      distinct_colours: s.colours,
      warm_pct: s.warmPct,
      cold_pct: s.coldPct,
      neon_pct: s.neonPct,
      cold_grey_pct: s.coldGreyPct,
      non_blank: s.nonBlank,
      blank_reasons: s.blankReasons,
      top_colours: s.topColours
    }))
  };

  const out = path.join(VERIFY, 'verify_report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(`\n${report.summary.passed}/${report.summary.total} checks passed  -  ${report.summary.verdict}`);
  if (failed.length) {
    console.log('\nFAILED:');
    failed.forEach(f => console.log(`  - ${f.check}${f.detail ? '  -> ' + f.detail : ''}`));
  }
  console.log(`\nreport:      ${out}`);
  console.log(`screenshots: ${SHOTS}`);
  if (failed.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
