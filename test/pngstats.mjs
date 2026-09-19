/* EMBERFALL - PNG statistics, read back off the disk.
 *
 * Why this file exists: a screenshot check that asks the *canvas* whether it
 * looks right proves the canvas, not the file. If the screenshot pipeline
 * writes a blank, a clipped, or a half-composited PNG, a canvas-side audit
 * still reports a beautiful autumn afternoon. So the art/dip audits in
 * verify.mjs decode the PNG that actually landed on disk and measure THAT.
 *
 * A minimal, dependency-free PNG reader is enough here because we only ever
 * read our own Playwright screenshots: 8-bit, non-interlaced, colour type 2
 * (RGB) or 6 (RGBA). Anything else throws rather than guesses.
 *
 * Measured per image:
 *   meanLum / sdLum  - "is it blank?" A dip frame is dark AND flat, so a frame
 *                      is only accepted when it is bright enough and varied
 *                      enough. Either one alone is foolable (a flat mid-grey
 *                      fill passes mean; a dark frame with one bright candle
 *                      passes sd).
 *   colours          - distinct exact RGB triples. A dip/blank frame collapses
 *                      to a handful of gradient bands.
 *   warmPct/coldPct  - Klaudia's one hard requirement, as a number. Warm =
 *                      the autumn arc (russet..gold, hue 345..95). Cold =
 *                      vivid pixels outside it. Neon = vivid AND bright in the
 *                      cyan/green/blue/magenta arc, i.e. Skyhook's identity.
 *   topColours       - the six most common colours, so the sheet can be read
 *                      as an art review and not just a pass/fail.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* ---------------------------------------------------------------- decode */

function inflatePNG(file) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error(`${file}: not a PNG`);

  let p = 8;
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];

  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;               // len + type + data + crc
  }

  if (depth !== 8) throw new Error(`${file}: bit depth ${depth} unsupported (need 8)`);
  if (interlace !== 0) throw new Error(`${file}: interlaced PNG unsupported`);
  if (colour !== 2 && colour !== 6) {
    throw new Error(`${file}: colour type ${colour} unsupported (need 2 RGB or 6 RGBA)`);
  }

  return {
    width, height,
    channels: colour === 6 ? 4 : 3,
    raw: zlib.inflateSync(Buffer.concat(idat))
  };
}

/* Undo the per-scanline PNG filters in place. Straight out of the spec; the
   only subtlety is that `a`/`c` reach back by BYTES PER PIXEL, not by one. */
function unfilter({ width, height, channels, raw }) {
  const stride = width * channels;
  const out = Buffer.allocUnsafe(stride * height);
  let ip = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[ip++];
    const row = ip;
    ip += stride;
    const o = y * stride;
    const prev = o - stride;

    for (let x = 0; x < stride; x++) {
      const cur = raw[row + x];
      const a = x >= channels ? out[o + x - channels] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = (x >= channels && y > 0) ? out[prev + x - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v = cur + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
          break;
        }
        default: throw new Error(`bad PNG filter ${filter} on row ${y}`);
      }
      out[o + x] = v & 0xff;
    }
  }
  return { width, height, channels, pixels: out };
}

/* ------------------------------------------------------------------ audit */

/* The autumn arc, in degrees of hue. Russet red wraps past 360, so the warm
   band is (WARM_LO..360] plus [0..WARM_HI]. Burnt orange #D2702C sits at 25
   with saturation 0.79 - very saturated and entirely cozy - which is why the
   neon test is about HUE, not about saturation alone. */
export const WARM_LO = 345;
export const WARM_HI = 95;

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * (((b - r) / d) + 2);
    else h = 60 * (((r - g) / d) + 4);
    if (h < 0) h += 360;
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx / 255 };
}

const isWarmHue = h => (h >= WARM_LO || h <= WARM_HI);

/* stride = sample every Nth pixel. Full-frame luminance at 1440x1080 is 1.5M
   pixels; 1-in-3 is statistically identical and keeps the suite quick. */
export function pngStats(file, stride = 3) {
  const img = unfilter(inflatePNG(file));
  const { width, height, channels, pixels } = img;

  let n = 0, sum = 0, sumSq = 0;
  let warm = 0, cold = 0, neon = 0, coldGrey = 0;
  const seen = new Set();
  const bins = new Map();
  let coldest = null;

  const step = channels * stride;
  for (let i = 0; i < pixels.length - channels + 1; i += step) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    n++;

    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += lum;
    sumSq += lum * lum;

    if (seen.size < 100000) seen.add((r << 16) | (g << 8) | b);

    /* 4-bit-per-channel bins: "what colour IS this frame", not 37k near-dupes */
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    bins.set(key, (bins.get(key) || 0) + 1);

    const { h, s, v } = hsv(r, g, b);
    if (s > 0.5 && v > 0.5) {
      if (isWarmHue(h)) warm++;
      else {
        cold++;
        if (!coldest || s > coldest.s) coldest = { hex: hexOf(r, g, b), h: Math.round(h), s: +s.toFixed(2), v: +v.toFixed(2) };
      }
    }
    if (s > 0.72 && v > 0.72 && h > 140 && h < 330) neon++;
    if (s < 0.06 && v > 0.25 && v < 0.85) coldGrey++;
  }

  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const pct = c => +(100 * c / n).toFixed(3);

  const top = [...bins.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, c]) => ({
      hex: hexOf(((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17),
      pct: +(100 * c / n).toFixed(1)
    }));

  return {
    file,
    width, height,
    bytes: fs.statSync(file).size,
    sampled: n,
    meanLum: +mean.toFixed(1),
    sdLum: +sd.toFixed(1),
    colours: seen.size,
    warmPct: pct(warm),
    coldPct: pct(cold),
    neonPct: pct(neon),
    coldGreyPct: pct(coldGrey),
    coldest,
    topColours: top
  };
}

function hexOf(r, g, b) {
  return '#' + [r, g, b].map(v => ('0' + v.toString(16)).slice(-2).toUpperCase()).join('');
}

/* ------------------------------------------------------------ thresholds */

/* A stage screenshot is evidence only if it shows the stage. These bounds are
   what separate the real frames from the two failures this project actually
   hit: a shot taken inside the 0.8s transition dip (dark AND flat AND few
   colours) and a shot of a scene that had not drawn yet.
   Night scenes are legitimately dark, so dusk stages get their own floor. */
export const BLANK_LIMITS = {
  day:   { meanLum: [55, 250], sdLum: 18, colours: 2000 },
  night: { meanLum: [12, 200], sdLum: 12, colours: 2000 }
};

export function blankVerdict(stats, kind = 'day') {
  const lim = BLANK_LIMITS[kind] || BLANK_LIMITS.day;
  const reasons = [];
  if (stats.meanLum < lim.meanLum[0]) reasons.push(`too dark (mean ${stats.meanLum} < ${lim.meanLum[0]})`);
  if (stats.meanLum > lim.meanLum[1]) reasons.push(`blown out (mean ${stats.meanLum} > ${lim.meanLum[1]})`);
  if (stats.sdLum < lim.sdLum) reasons.push(`too flat (sd ${stats.sdLum} < ${lim.sdLum})`);
  if (stats.colours < lim.colours) reasons.push(`too few colours (${stats.colours} < ${lim.colours})`);
  return { pass: reasons.length === 0, reasons };
}
