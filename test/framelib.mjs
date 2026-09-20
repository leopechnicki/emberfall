/* EMBERFALL - framing measurement.
 *
 * WHY THIS FILE EXISTS
 *
 * Klaudia rejected this game twice for the same reason in two different
 * shapes: "the playfield is squeezed into a tiny box". The first shape was a
 * letterboxed 4:3 canvas with 551 px of dead page under it. That got fixed -
 * the canvas became the whole viewport and coverage hit 100%. But the SECOND
 * shape survived that fix and is, to a player, identical: the canvas covered
 * the screen while every scene still composed itself inside a 720x540 band
 * pinned to the bottom of it, so on a 390x844 phone the top ~65% of the
 * screen was empty sky and the valley was a strip along the bottom. Canvas
 * coverage said 100%. The GAME still read tiny.
 *
 * A coverage test could not catch that, and no test that reads a constant out
 * of the source could catch it either - HORIZON is 330 in js/game.js whether
 * that lands at 20% of the screen or at 65% of it. So this measures the
 * horizon WHERE IT ACTUALLY LANDS: in the rendered frame, in pixels, by
 * finding the line above which there is nothing but sky.
 *
 * HOW THE HORIZON IS FOUND
 *
 * Sky in this game is a smooth vertical gradient plus soft clouds and a soft
 * sun - per-pixel neighbour differences across it are tiny. Hills, trees,
 * cottages, signposts, path and leaf litter are all hard-edged. So "content"
 * is measured as the count of pixels per row whose 4-neighbour luminance step
 * clears EDGE_STEP, which a gradient never does and an edge always does.
 *
 * Two refinements, both learned from the frames this was calibrated against:
 *
 *   1. Rolling max over +/-SMOOTH rows. The interior of a hill band is a flat
 *      fill with no edges in it; only its ridge line has any. Without the
 *      smear a hill reads as sky and the horizon is reported too low.
 *
 *   2. The block is grown UPWARD FROM THE BOTTOM, not found from the top.
 *      The HUD - day card, hint line - is drawn in the sky and is full of
 *      hard-edged text. Scanning down from the top stops at the day card and
 *      calls it the horizon. The ground is the one content block that reaches
 *      the bottom edge of the frame, so growing up from the floor ignores
 *      every floating HUD island by construction.
 *
 * WHAT IS REPORTED is deliberately more than the pass/fail: skyPct, the band
 * from the horizon to the top of the touch pad, and the pad itself all add to
 * 100, so a failure says which of the three is eating the screen.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { inflatePNG, unfilter } from './pngstats.mjs';

/* A neighbour luminance step this big is an EDGE. The sky gradient moves
   roughly 0.1 luminance per row and the softest cloud edge about 2, so 7 sits
   well clear of both without needing a hard-edge to be high contrast - the
   far hill ridge against sky is only about 9. */
export const EDGE_STEP = 7;

/* Share of a row that has to be edge before the row counts as content. Three
   drifting leaves crossing the sky are about 12 px of edge on a 390 px row
   (3%); the far hill ridge is the full width. 6% sits between them. */
export const ROW_EDGE_FRACTION = 0.06;

/* Rolling-max radius, in rows - see refinement 1 above. */
export const SMOOTH = 10;

/* How far a row's MEDIAN colour has to sit from the sky's before the row is
   ground. See rowIsGround() for why this exists and how the number was
   picked. */
export const SKY_DIST = 55;

/* How many consecutive sky rows end the block. A gap this size cannot happen
   inside real terrain but happens constantly between HUD islands. */
export const MAX_GAP = 26;

export function readPNG(file) {
  return unfilter(inflatePNG(file));
}

/* Rec. 601 luma, integer. */
function lumaPlane({ width, height, channels, pixels }) {
  const L = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < L.length; i++, p += channels) {
    L[i] = (pixels[p] * 77 + pixels[p + 1] * 150 + pixels[p + 2] * 29) >> 8;
  }
  return L;
}

/* Per-row count of pixels whose step to the neighbour left or above clears
   EDGE_STEP. Both directions matter: a signpost is a vertical edge and finds
   itself in dL/dx, a hill ridge is a horizontal one and only ever shows up in
   dL/dy. Measuring one and not the other was the first version's bug. */
export function rowEdgeCounts(img) {
  const { width, height } = img;
  const L = lumaPlane(img);
  const counts = new Int32Array(height);
  for (let y = 1; y < height; y++) {
    const o = y * width, up = o - width;
    let n = 0;
    for (let x = 1; x < width; x++) {
      const v = L[o + x];
      const dx = v - L[o + x - 1];
      const dy = v - L[up + x];
      if ((dx < 0 ? -dx : dx) >= EDGE_STEP || (dy < 0 ? -dy : dy) >= EDGE_STEP) n++;
    }
    counts[y] = n;
  }
  return counts;
}

/* Per-row median R,G,B. The MEDIAN and not the mean, so that a HUD card -
   an opaque brown panel a third of the width - cannot drag a sky row's
   colour toward ground. */
function rowMedianRGB(img) {
  const { width, height, channels, pixels } = img;
  const out = new Int32Array(height * 3);
  const r = new Uint8Array(width), g = new Uint8Array(width), b = new Uint8Array(width);
  const mid = width >> 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0, p = y * width * channels; x < width; x++, p += channels) {
      r[x] = pixels[p]; g[x] = pixels[p + 1]; b[x] = pixels[p + 2];
    }
    const rs = Array.from(r).sort((a, c) => a - c);
    const gs = Array.from(g).sort((a, c) => a - c);
    const bs = Array.from(b).sort((a, c) => a - c);
    out[y * 3] = rs[mid]; out[y * 3 + 1] = gs[mid]; out[y * 3 + 2] = bs[mid];
  }
  return out;
}

/* Is this row GROUND rather than sky, by colour?
 *
 * This is the second signal and the reason the first version of this file
 * measured the orchard as 81% sky when a human looking at the same frame
 * would have said 25%. Edge density alone is not enough: the sky is smooth
 * so it has no edges, but a bare patch of ground between two trees has no
 * edges EITHER, and a run of those wider than MAX_GAP ends the content block
 * early and hands back a horizon hundreds of pixels too low.
 *
 * Colour has no such blind spot. Measured off the real frames: the sky
 * gradient drifts about 13 units of RGB distance from the top of the screen
 * to the horizon, the far hill band sits about 72 away from it, and open
 * ground about 121. SKY_DIST at 55 is comfortably above the drift and
 * comfortably below the hills, which is the widest margin available.
 *
 * The reference is taken from THIS frame's own top rows rather than
 * hard-coded, so the test keeps working when the palette changes - at dusk
 * the sky is plum and the ground is nearly black, and both move together. */
function skyReference(meds, height) {
  const n = Math.max(3, Math.round(height * 0.08));
  const pick = c => {
    const v = [];
    for (let y = 0; y < n; y++) v.push(meds[y * 3 + c]);
    v.sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  return [pick(0), pick(1), pick(2)];
}

function rowIsGround(meds, y, ref) {
  const dr = meds[y * 3] - ref[0];
  const dg = meds[y * 3 + 1] - ref[1];
  const db = meds[y * 3 + 2] - ref[2];
  return Math.sqrt(dr * dr + dg * dg + db * db) > SKY_DIST;
}

/* Grow the content block up from the bottom edge; return the first row of it.
   Returns 0 if content reaches the very top (nothing is wrong with that - it
   just means there is no sky band at all). */
export function findHorizon(img) {
  const { width, height } = img;
  const raw = rowEdgeCounts(img);
  const need = Math.max(6, Math.round(width * ROW_EDGE_FRACTION));
  const meds = rowMedianRGB(img);
  const ref = skyReference(meds, height);

  /* A row is part of the scene if it is GROUND-COLOURED or if it carries
     hard edges. The two cover each other's blind spots: colour catches open
     ground and the hill bands, which have no edges; edges catch tree
     canopies and rooftops, which stand ABOVE the ground line and so are
     still sky-coloured by row median. Rolling max on the edge term only, so
     a flat fill between two ridges stays inside the block. */
  const solid = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    let best = 0;
    const lo = Math.max(0, y - SMOOTH), hi = Math.min(height - 1, y + SMOOTH);
    for (let k = lo; k <= hi; k++) if (raw[k] > best) best = raw[k];
    solid[y] = (best >= need || rowIsGround(meds, y, ref)) ? 1 : 0;
  }

  let horizon = height;
  let gap = 0;
  for (let y = height - 1; y >= 0; y--) {
    if (solid[y]) { horizon = y; gap = 0; }
    else if (++gap > MAX_GAP) break;
  }
  return { horizon, rowEdges: raw, solid, need };
}

/* The whole measurement, as percentages of screen height that sum to 100.
 *
 *   skyPct    nothing but sky
 *   scenePct  horizon -> top of the touch pad: the band the GAME lives in
 *   padPct    the on-canvas BACK/ACTION strip
 *
 * padTopPx is passed in from the page (EF.bleed + padGeom), because the pad is
 * drawn in the same wood as the signposts and a pixel reading cannot tell the
 * two apart - and should not have to. */
export function measureFrame(file, padTopPx) {
  const img = readPNG(file);
  const { horizon, rowEdges, solid, need } = findHorizon(img);
  const H = img.height;
  const padTop = (padTopPx === undefined || padTopPx === null)
    ? H : Math.max(0, Math.min(H, Math.round(padTopPx)));

  return {
    file, width: img.width, height: H,
    horizonPx: horizon,
    padTopPx: padTop,
    skyPct: +(horizon / H * 100).toFixed(1),
    scenePct: +(Math.max(0, padTop - horizon) / H * 100).toFixed(1),
    padPct: +(Math.max(0, H - padTop) / H * 100).toFixed(1),
    _img: img, _rowEdges: rowEdges, _solid: solid, _need: need
  };
}

/* ------------------------------------------------------- debug overlay */

function crc32(buf) {
  let c, t = crc32.t;
  if (!t) {
    t = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function writePNG(file, width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]));
}

/* Re-emit the frame with the measurement drawn on it: a magenta rule on the
   detected horizon, a cyan rule on the top of the pad, and a per-row edge
   histogram down the left margin. A number in a log can be wrong in a way
   nobody notices for three attempts running; this makes the detector's
   opinion something a human can check in one glance. */
export function writeOverlay(m, out) {
  const { _img: img, horizonPx, padTopPx, _rowEdges: edges, _need: need } = m;
  const { width, height, channels, pixels } = img;
  const rgb = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0, s = 0, d = 0; i < width * height; i++, s += channels, d += 3) {
    rgb[d] = pixels[s]; rgb[d + 1] = pixels[s + 1]; rgb[d + 2] = pixels[s + 2];
  }
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const d = (y * width + x) * 3;
    rgb[d] = r; rgb[d + 1] = g; rgb[d + 2] = b;
  };
  for (let x = 0; x < width; x++) {
    for (let k = 0; k < 2; k++) {
      put(x, horizonPx + k, 255, 0, 200);
      put(x, padTopPx - k, 0, 220, 255);
    }
  }
  const scale = 60 / Math.max(need * 2, 1);
  for (let y = 0; y < height; y++) {
    const w = Math.min(60, Math.round(edges[y] * scale));
    for (let x = 0; x < w; x++) put(x, y, 40, 255, 90);
    put(Math.round(need * scale), y, 255, 255, 0);
  }
  writePNG(out, width, height, rgb);
  return out;
}
