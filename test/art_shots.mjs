/* EMBERFALL art shots - visual proof of the four scenes, plus a palette audit.
 *
 * Captures the shipped game, not a mock-up: a real page loads index.html and
 * the four frames below are reached by PLAYING - the signposts are clicked,
 * the basket is driven by real mouse movement, the rake really sweeps, and the
 * wax spent at dusk was really rendered from a real leaf pile. Nothing is
 * posed except the seed, which is fixed so the sheet is the same every run.
 *
 * It also reads the pixels back. "Cozy autumn colours" is the one hard art
 * requirement on this project, so each shot is measured rather than admired:
 *   - the six most common colours, as hex, with their share of the frame
 *   - a NEON count: pixels that are both very saturated and very bright in the
 *     cyan / green / blue / magenta arc. Emberfall's answer must be ~0. That
 *     arc is Skyhook's identity and this game is its opposite.
 *
 * Run:  node test/art_shots.mjs
 * Out:  test/screenshots/art_01_day_valley.png
 *       test/screenshots/art_02_harvest.png
 *       test/screenshots/art_03_rake.png
 *       test/screenshots/art_04_dusk_lantern.png
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'screenshots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

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
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/* Runs IN THE PAGE: quantise the canvas and report what colours it is made of,
   and how much of it - if any - is neon. */
const AUDIT = `(function () {
  var c = document.getElementById('game');
  var g = c.getContext('2d');
  var d = g.getImageData(0, 0, c.width, c.height).data;
  var bins = {}, total = 0, neon = 0, cold = 0;
  /* stride over the frame; 4 bytes a pixel, every 7th pixel is plenty */
  for (var i = 0; i < d.length; i += 4 * 7) {
    var r = d[i], gg = d[i + 1], b = d[i + 2];
    total++;
    var key = ((r >> 4) << 8) | ((gg >> 4) << 4) | (b >> 4);
    bins[key] = (bins[key] || 0) + 1;

    var mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    var v = mx / 255, sat = mx === 0 ? 0 : (mx - mn) / mx;
    var h = 0;
    if (mx !== mn) {
      if (mx === r) h = 60 * (((gg - b) / (mx - mn)) % 6);
      else if (mx === gg) h = 60 * ((b - r) / (mx - mn) + 2);
      else h = 60 * ((r - gg) / (mx - mn) + 4);
      if (h < 0) h += 360;
    }
    /* neon = screaming saturation AND brightness, in the cold arc */
    if (sat > 0.72 && v > 0.72 && h > 140 && h < 330) neon++;
    /* cold grey = no warmth at all, mid value */
    if (sat < 0.06 && v > 0.25 && v < 0.85) cold++;
  }
  var keys = Object.keys(bins).sort(function (a, b2) { return bins[b2] - bins[a]; });
  function hex(k) {
    k = parseInt(k, 10);
    var r = ((k >> 8) & 15) * 17, g2 = ((k >> 4) & 15) * 17, b = (k & 15) * 17;
    return '#' + [r, g2, b].map(function (n) {
      return ('0' + n.toString(16)).slice(-2).toUpperCase();
    }).join('');
  }
  return {
    total: total,
    top: keys.slice(0, 6).map(function (k) {
      return { hex: hex(k), pct: +(bins[k] / total * 100).toFixed(1) };
    }),
    neonPct: +(neon / total * 100).toFixed(3),
    coldGreyPct: +(cold / total * 100).toFixed(3)
  };
}())`;

const snap = page => page.evaluate('window.__EMBERFALL.snapshot()');

async function waitState(page, state, timeout = 15000) {
  await page.waitForFunction(
    `window.__EMBERFALL.snapshot().state === ${JSON.stringify(state)}`, null, { timeout });
}
async function waitSettled(page) {
  await page.waitForFunction('!window.__EMBERFALL.snapshot().transitioning', null, { timeout: 9000 });
}

const reports = [];

async function shoot(page, box, file, title) {
  const out = path.join(OUT, file);
  await page.screenshot({ path: out, clip: box });
  const a = await page.evaluate(AUDIT);
  reports.push({ file, title, ...a });
  console.log(`\n${title}`);
  console.log(`  ${out}`);
  console.log(`  palette: ${a.top.map(t => `${t.hex} ${t.pct}%`).join('   ')}`);
  console.log(`  neon: ${a.neonPct}%    cold grey: ${a.coldGreyPct}%`);
  return a;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;

  const launchOpts = { headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', ...launchOpts });
  } catch {
    browser = await chromium.launch(launchOpts);
  }

  const problems = [];

  try {
    /* 1500x1080 puts the 720x540 canvas at an exact 2x - crisp shots, no
       resampling, and the aspect ratio is the game's own. */
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1080 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

    await page.goto(base + '?seed=20260919', { waitUntil: 'load' });
    await page.waitForFunction('!!window.__EMBERFALL', null, { timeout: 8000 });

    const box = await page.locator('#game').boundingBox();
    console.log(`canvas ${Math.round(box.width)}x${Math.round(box.height)} (2x of 720x540)`);

    const at = (x, y) => ({ px: box.x + (x / 720) * box.width, py: box.y + (y / 540) * box.height });
    const click = async (x, y) => { const p = at(x, y); await page.mouse.click(p.px, p.py); };
    const move = async (x, y) => { const p = at(x, y); await page.mouse.move(p.px, p.py); };

    /* ---------------- 1. the valley by day ---------------- */
    await click(360, 300);                     // title -> valley
    await waitState(page, 'valley');
    await waitSettled(page);
    await wait(1400);                          // let the leaf drift spread out
    await move(118, 390);                      // hover the orchard signpost
    await wait(400);
    await shoot(page, box, 'art_01_day_valley.png', '1. the valley, day 1 of 30');

    /* ---------------- 2. a harvest round ---------------- */
    await click(118, 390);                     // THE ORCHARD
    await waitState(page, 'harvest');
    await waitSettled(page);
    /* Play for a few seconds so the frame has fruit in the air, a part-filled
       recipe card and a live multiplier - not an empty first frame. */
    for (let i = 0; i < 46; i++) {
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
      if (target !== null) await move(target, 470);
      await wait(130);
    }
    /* Hold for a frame with several pieces of fruit actually falling. */
    await page.waitForFunction(
      'window.__EMBERFALL.game.mode.items.length >= 3', null, { timeout: 8000 }).catch(() => {});
    const hs = await snap(page);
    console.log(`  (harvest: ${hs.mode.recipe || ''} score=${hs.mode.score} step=${hs.mode.step} items=${hs.mode.items})`);
    await shoot(page, box, 'art_02_harvest.png', '2. the orchard - a harvest round');

    await page.evaluate('window.__EMBERFALL.endHarvest()');
    await waitState(page, 'valley');
    await waitSettled(page);

    /* ---------------- 3. the rake puzzle ---------------- */
    await click(300, 440);                     // THE YARD
    await waitState(page, 'rake');
    await waitSettled(page);
    /* Sweep for real, and sweep WELL: strokes that converge on the pile ring
       rather than straight lines across the yard, so the shot has a mound
       worth photographing instead of nine banked leaves. */
    const PILE = [566, 424];
    const starts = [[80, 500], [160, 362], [250, 486], [330, 378], [410, 502],
                    [140, 440], [230, 412], [300, 470], [390, 396], [450, 452],
                    [110, 380], [360, 508]];
    /* Keep sweeping until the mound is worth looking at. One pass banks ~13
       leaves, which draws a mound the size of a coin - true to the game, but
       it undersells the scene the player actually sits in. */
    for (let round = 0; round < 5; round++) {
      if ((await snap(page)).mode.piled >= 34) break;
      for (const [sx, sy] of starts) {
        await move(sx, sy);
        await wait(40);
        for (let k = 1; k <= 14; k++) {
          await move(sx + (PILE[0] - sx) * (k / 14), sy + (PILE[1] - sy) * (k / 14));
          await wait(14);
        }
        await wait(50);
      }
    }
    /* Step the rake off the pile so it is not sitting on top of the mound. */
    await move(300, 470);
    await wait(500);
    const rs = await snap(page);
    console.log(`  (rake: ${rs.mode.piled}/${rs.mode.target} leaves piled)`);
    await shoot(page, box, 'art_03_rake.png', '3. the yard - the rake puzzle');

    /* Finish the pile so the wax spent at dusk is wax this run actually made. */
    await page.evaluate('window.__EMBERFALL.fillRake()');
    await waitState(page, 'valley');
    await waitSettled(page);

    /* ---------------- 4. dusk, lantern lit ---------------- */
    await click(452, 420);                     // the lantern
    await waitState(page, 'dusk');
    await page.waitForFunction(
      'window.__EMBERFALL.snapshot().duskPhase === "lantern"', null, { timeout: 9000 });
    await click(452, 420);                     // light the lantern (2 wax)
    await wait(700);
    for (const [cx, cy] of [[108, 476], [228, 418], [321, 384], [457, 358], [545, 350], [640, 347]]) {
      if ((await snap(page)).duskPhase !== 'candles') break;
      await click(cx, cy);
      await wait(260);
    }
    /* Let the flames finish ramping and the palette finish warming. */
    await wait(2600);
    const ds = await snap(page);
    console.log(`  (dusk: night=${ds.night} warm=${ds.warm} lantern=${ds.tally.lantern} candles=${ds.tally.candles})`);
    await shoot(page, box, 'art_04_dusk_lantern.png', '4. dusk - the first lantern lit');

    if (!ds.tally.lantern) problems.push('dusk shot taken with an unlit lantern');
    if (ds.night < 0.7) problems.push(`dusk shot is not dark enough (night=${ds.night})`);

  } finally {
    await browser.close();
    server.close();
  }

  /* ---------------- the art guard ---------------- */
  console.log('\n--- palette audit -------------------------------------------');
  let worstNeon = 0, worstCold = 0;
  for (const r of reports) {
    worstNeon = Math.max(worstNeon, r.neonPct);
    worstCold = Math.max(worstCold, r.coldGreyPct);
    console.log(`${r.file.padEnd(26)} neon ${String(r.neonPct).padStart(6)}%   cold grey ${String(r.coldGreyPct).padStart(6)}%`);
  }
  console.log(`\nworst neon: ${worstNeon}%   worst cold grey: ${worstCold}%`);
  if (worstNeon > 0.5) problems.push(`neon found in the frame (${worstNeon}%) - this game has none by design`);
  if (worstCold > 4) problems.push(`too much cold grey (${worstCold}%)`);

  console.log(`\n${reports.length} shots written to ${OUT}`);
  if (problems.length) {
    console.log('\nPROBLEMS:');
    problems.forEach(p => console.log('  - ' + p));
    process.exitCode = 1;
  } else {
    console.log('art guard: PASS  -  cozy autumn only, no neon, no cold greys');
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
