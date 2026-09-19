/* EMBERFALL - shared test harness.
 *
 * Launching the game, mapping logical canvas coordinates to real page
 * coordinates, and driving it the way a player does. Two scripts use it
 * (test/smoke.mjs plays the day, test/art_shots.mjs photographs it), and they
 * must agree about all of the above or the screenshots stop being evidence
 * about the thing the suite tested.
 *
 * Two rules this file exists to enforce:
 *
 *  1. CHROME, not Chromium. Leo's standing instruction for browser automation
 *     in leo-agents. `channel: 'chrome'` uses the installed Google Chrome; the
 *     fallback to bundled Chromium is reported loudly rather than silently, so
 *     a green run can never quietly have been the wrong browser.
 *
 *  2. file://, not a local server. "Double-click index.html and it plays" is a
 *     hard requirement of this project, so the suite's primary page IS a
 *     file:// page. A server pass would hide exactly the class of bug the
 *     requirement is about (ES modules, fetch, CORS).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const SHOTS = path.join(HERE, 'screenshots');
export const VERIFY = path.join(HERE, 'verify');
export const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

/* Logical canvas size. The game draws in these units and main.js scales them
   to whatever the window is, so every coordinate in the tests is in game
   units and never in pixels. */
export const W = 720;
export const H = 540;

export const wait = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ headed = false } = {}) {
  const opts = {
    headless: !headed,
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']
  };
  try {
    const browser = await chromium.launch({ channel: 'chrome', ...opts });
    return { browser, channel: 'chrome' };
  } catch (e) {
    const browser = await chromium.launch(opts);
    return { browser, channel: 'chromium-fallback', why: String(e.message || e).split('\n')[0] };
  }
}

export async function openGame(browser, { viewport = { width: 1280, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => {
    const u = r.url();
    if (!u.startsWith('data:')) errors.push(`requestfailed: ${u} ${r.failure()?.errorText}`);
  });
  await page.goto(INDEX_URL, { waitUntil: 'load' });
  await page.waitForFunction('!!window.__EMBERFALL', null, { timeout: 10000 });
  return { ctx, page, errors };
}

/* --------------------------------------------------------------- driving */

export async function box(page) {
  return page.locator('#game').boundingBox();
}

/* Game units -> page pixels. */
export function toPage(b, x, y) {
  return { x: b.x + (x / W) * b.width, y: b.y + (y / H) * b.height };
}

/* A real click, dispatched by the browser's own input stack rather than
   synthesised by us. Skyhook learned this the hard way: a hand-built
   PointerEvent is non-primary, main.js is right to drop it, and a whole suite
   went green while testing nothing. */
export async function click(page, x, y) {
  const b = await box(page);
  const p = toPage(b, x, y);
  await page.mouse.click(p.x, p.y);
}

export async function move(page, x, y, steps = 1) {
  const b = await box(page);
  const p = toPage(b, x, y);
  await page.mouse.move(p.x, p.y, { steps });
}

export function snap(page) {
  return page.evaluate('window.__EMBERFALL.snapshot()');
}

/* Poll the real snapshot until the game reports the state we are waiting for.
   Never a fixed sleep: state changes go through an 0.8s transition dip whose
   length is the game's business, not the test's. */
export async function waitState(page, state, timeout = 6000) {
  const t0 = Date.now();
  for (;;) {
    const s = await snap(page);
    if (s.state === state && !s.transitioning) return s;
    if (Date.now() - t0 > timeout) return s;
    await wait(80);
  }
}

export async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name);
  /* The canvas alone, not the page: these double as the art review, and the
     plum page background around the letterboxed canvas is not the art. */
  await page.locator('#game').screenshot({ path: file });
  return file;
}

/* ------------------------------------------------------------- art audit */

/* Klaudia's hard constraint: cozy autumn only - ambers, ochre, russet by day,
   plum-blue night, candle gold. NO neon, because neon is Skyhook's identity.
   "No neon" is testable: neon means SATURATED and BRIGHT in a COLD hue. Warm
   hues (red 345..360, russet/amber/ochre/gold 0..95) are the whole palette, so
   any saturated bright pixel outside that band is a palette leak.
   Autumn colours can be very saturated - burnt orange #D2702C is s=0.79 - so
   the band, not the saturation, is what this measures. */
export const COLD_MIN = 95;
export const COLD_MAX = 345;

export function pixelAuditScript(step = 7) {
  return `(() => {
    const c = window.__EMBERFALL.canvas;
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, cold = 0, warm = 0, coldest = null;
    for (let i = 0; i < d.length; i += 4 * ${step}) {
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const v = mx, s = mx === 0 ? 0 : (mx - mn) / mx;
      let h = 0;
      if (mx !== mn) {
        if (mx === r) h = 60 * ((((gg - b) / (mx - mn)) % 6 + 6) % 6);
        else if (mx === gg) h = 60 * (((b - r) / (mx - mn)) + 2);
        else h = 60 * (((r - gg) / (mx - mn)) + 4);
      }
      if (h < 0) h += 360;
      n++;
      if (s > 0.5 && v > 0.5) {
        if (h > ${COLD_MIN} && h < ${COLD_MAX}) {
          cold++;
          if (!coldest || s > coldest.s) coldest = { h: Math.round(h), s: +s.toFixed(2), v: +v.toFixed(2) };
        } else warm++;
      }
    }
    return { sampled: n, cold, warm, coldPct: +(100 * cold / n).toFixed(4), coldest };
  })()`;
}

/* The same test applied to the palette's own source literals. The pixel audit
   can be diluted by a dark frame; this one cannot be diluted at all. */
export function paletteAuditScript() {
  return `(() => {
    const P = window.EF.Palette;
    const bad = [];
    const scan = (label, table) => {
      Object.keys(table).forEach(k => {
        const hex = table[k];
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const v = mx, s = mx === 0 ? 0 : (mx - mn) / mx;
        let h = 0;
        if (mx !== mn) {
          if (mx === r) h = 60 * ((((g - b) / (mx - mn)) % 6 + 6) % 6);
          else if (mx === g) h = 60 * (((b - r) / (mx - mn)) + 2);
          else h = 60 * (((r - g) / (mx - mn)) + 4);
        }
        if (h < 0) h += 360;
        if (s > 0.5 && v > 0.5 && h > ${COLD_MIN} && h < ${COLD_MAX}) {
          bad.push(label + '.' + k + ' ' + hex + ' (hue ' + Math.round(h) + ')');
        }
      });
    };
    scan('day', P._day);
    scan('night', P._night);
    return { entries: Object.keys(P._day).length + Object.keys(P._night).length, bad: bad };
  })()`;
}
