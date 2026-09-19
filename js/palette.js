/* EMBERFALL - the palette.
 *
 * ONE place defines every colour in the game. Draw code never writes a hex
 * literal; it asks for a NAME ('leafRusset', 'skyMid', 'candleGold') and gets
 * back the colour for the CURRENT time of day. That is what keeps the whole
 * valley cozy instead of a scatter of nice-on-their-own oranges, and it is
 * what makes dusk a single number instead of a rewrite of every draw call.
 *
 * Brief (Klaudia, 2026-09-19, after she rejected the first build): warm
 * autumn and NOTHING else. She named the purple specifically, so the rule here
 * is absolute and it is testable:
 *
 *   ZERO purple. No entry in either table sits in the violet band (hue
 *   255-330) at any saturation, and neither does the value either table sinks
 *   toward - see shade() below, which used to pull everything to plum.
 *
 *   day   - warm ambers, burnt orange, ochre, russet red, golden wheat, moss
 *   night - deep umber, burnt sienna, russet, deep moss, on warm near-black
 *   light - candle gold with a warm falloff
 *
 * The darkest value in the game is #1A100A: a warm near-black that still has
 * brown in it. There is no #000 and no blue-black in Emberfall.
 * No neon (that is Skyhook's identity), no cold greys, no pure primaries.
 *
 * Plain script, no ES module, on purpose: modules are blocked by CORS when the
 * page is opened straight off disk (file://), and this game must run by
 * double-clicking index.html.
 */
(function (global) {
  'use strict';

  var EF = global.EF || (global.EF = {});

  function hex(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }

  /* ---- DAY -------------------------------------------------------------
     A hazy golden autumn afternoon. The sky itself is warm: there is no cold
     blue anywhere in Emberfall, by design. */
  var DAY = {
    skyTop:     '#F7DCAE',   // pale warm cream-gold
    skyMid:     '#F1BD84',   // soft apricot
    skyLow:     '#E3A066',   // ochre at the horizon
    sun:        '#FFE9B8',
    sunGlow:    '#FFD08A',

    hillFar:    '#C9A06B',   // dusty ochre
    hillMid:    '#AE7844',   // russet brown
    hillNear:   '#8A5B34',
    ground:     '#B9803F',
    groundDark: '#9A6733',
    path:       '#D9B071',   // golden wheat track
    pathEdge:   '#C1914F',

    bark:       '#5B3A29',
    barkDark:   '#43291D',

    leafGold:   '#EFC75E',   // golden wheat
    leafAmber:  '#E8A33D',
    leafOchre:  '#C98B33',
    leafOrange: '#D2702C',   // burnt orange
    leafRusset: '#A8412A',   // russet red
    leafMoss:   '#7E8C58',   // soft moss green
    mossDeep:   '#63723F',

    house:      '#B4703E',
    houseDark:  '#8E5530',
    roof:       '#8C3E2B',
    window:     '#F6D9A8',

    /* Limewashed stone, for the cottages. Warm-tinted on purpose: a neutral
       grey wall is the one thing that would read as cold in this valley, and
       a low-saturation warm cream is what actual lime render looks like. */
    stone:      '#E6D2AC',
    stoneDark:  '#C4A87F',

    apple:      '#C4402C',
    pumpkin:    '#E08228',
    cinnamon:   '#A86A3C',
    honey:      '#E9AE3C',
    acorn:      '#7A5330',
    wasp:       '#D8A22E',

    candleGold: '#FFD489',
    ember:      '#FF9E4A',

    ink:        '#4A2C1C',   // dark text, used on light day panels
    cream:      '#FFF3DE',   // light text
    panel:      '#4A2C1C',   // HUD panel fill (used at low alpha)
    panelInk:   '#FFF3DE',   // HUD text colour
    vignette:   '#6B3A1E'
  };

  /* ---- NIGHT -----------------------------------------------------------
     Warm autumn dark: umber, burnt sienna and deep moss over a warm
     near-black. This table USED to be plum and indigo, which is the colour
     Klaudia rejected by name ("ten fioletowy kolor"), so every value here was
     re-picked inside hue 0-95 - embers, earth and moss. Nothing sits in the
     violet band at all, which test/verify.mjs asserts against these literals
     and test/mobile.mjs asserts again against real rendered pixels.

     Everything keeps a trace of its daytime hue so the valley reads as the
     SAME place after dark, and #1A100A is the darkest value in the game. */
  var NIGHT = {
    skyTop:     '#1A100A',   // warm near-black (darkest value in the game)
    skyMid:     '#2A1710',   // deep umber
    skyLow:     '#4A2412',   // burnt sienna glow along the horizon
    sun:        '#F2DDB4',   // becomes the moon - warm, like a harvest moon
    sunGlow:    '#C2996A',

    hillFar:    '#3B2717',
    hillMid:    '#2F1E12',
    hillNear:   '#26180E',
    ground:     '#2B1C10',
    groundDark: '#1F1309',
    path:       '#5A3F22',
    pathEdge:   '#422C17',

    bark:       '#2E1D12',
    barkDark:   '#1D1109',

    leafGold:   '#8F7444',
    leafAmber:  '#8A5E31',
    leafOchre:  '#74532C',
    leafOrange: '#7A4222',
    leafRusset: '#5E2A1C',
    leafMoss:   '#46503A',   // moss stays green after dark, just deeper
    mossDeep:   '#364030',

    house:      '#4A3524',
    houseDark:  '#332318',
    roof:       '#42241A',   // clay tile
    window:     '#FFCE86',   // lit from inside - stays warm after dark
    stone:      '#5A4A38',   // limewash under moonlight
    stoneDark:  '#3E3126',

    apple:      '#7A3024',
    pumpkin:    '#8A5226',
    cinnamon:   '#5E4028',
    honey:      '#8E6A34',
    acorn:      '#4A3422',
    wasp:       '#8A6A2E',

    candleGold: '#FFD489',   // light does not dim at night - that is the point
    ember:      '#FF9E4A',

    ink:        '#FFEBD2',
    cream:      '#FFF3DE',
    panel:      '#241509',
    panelInk:   '#FFECCF',
    vignette:   '#1A0F07'
  };

  var dayRGB = {}, nightRGB = {};
  Object.keys(DAY).forEach(function (k) { dayRGB[k] = hex(DAY[k]); });
  Object.keys(NIGHT).forEach(function (k) { nightRGB[k] = hex(NIGHT[k]); });

  var t = 0;              // 0 = full day, 1 = full night
  var cache = {};         // name -> css string, invalidated whenever t moves

  function lerp(a, b, u) { return a + (b - a) * u; }

  var P = {
    /* Current night factor. Dusk is this number moving from 0 to 1 - which is
       why no draw call anywhere needs to know that dusk is happening. */
    get night() { return t; },

    set: function (v) {
      var n = v < 0 ? 0 : (v > 1 ? 1 : v);
      if (n === t) return;
      t = n;
      cache = {};
    },

    /* [r,g,b] at the current time of day. */
    rgb: function (name) {
      var d = dayRGB[name] || nightRGB[name];
      var n = nightRGB[name] || dayRGB[name];
      if (!d) throw new Error('EF.Palette: unknown colour "' + name + '"');
      if (t === 0) return d;
      if (t === 1) return n;
      return [lerp(d[0], n[0], t), lerp(d[1], n[1], t), lerp(d[2], n[2], t)];
    },

    /* css colour at the current time of day. Hot path - memoised per t. */
    get: function (name) {
      var hit = cache[name];
      if (hit) return hit;
      var c = P.rgb(name);
      var s = 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
      cache[name] = s;
      return s;
    },

    rgba: function (name, a) {
      var c = P.rgb(name);
      return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
    },

    /* Nudge a palette colour lighter/darker without leaving the palette.
       k > 0 lifts toward cream, k < 0 sinks toward the warm near-black.
       That dark end used to be [28,18,48] - plum - which quietly pushed a
       violet cast into every shaded edge in the game (the keeper's hood, the
       cottage walls, every bark shadow). It is #1A100A now. */
    shade: function (name, k, a) {
      var c = P.rgb(name);
      var to = k >= 0 ? [255, 243, 222] : [26, 16, 10];
      var u = Math.abs(k);
      var r = lerp(c[0], to[0], u), g = lerp(c[1], to[1], u), b = lerp(c[2], to[2], u);
      if (a === undefined) return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
      return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')';
    },

    /* The sky, as a vertical gradient. Every scene draws its backdrop with
       this so day, dusk and night are literally the same three stops.
     *
     * Bleed-aware: on a phone the canvas is taller than the 720x540 scene, and
     * the strip above the scene is REAL SKY rather than a dead page
     * background. That is the whole trick behind the portrait layout - the
     * leftover is painted world, so the game can fill the screen without
     * moving a single hand-placed coordinate.
     *
     * The gradient is anchored to the horizon (h*0.62), not to the bottom of
     * the rect: a canvas gradient clamps to its last stop, so the warm band
     * lands where the hills meet the sky no matter how much sky is above it. */
    sky: function (ctx, w, h) {
      var r = EF.fullRect(w, h);
      var g = ctx.createLinearGradient(0, r.y, 0, h * 0.62);
      g.addColorStop(0.0, P.get('skyTop'));
      g.addColorStop(0.62, P.get('skyMid'));
      g.addColorStop(1.0, P.get('skyLow'));
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    },

    /* Warm paper grain. This is what stops the flat canvas fills from looking
       like flat canvas fills - half of the "soft, hand-painted" ask. The tile
       is generated once and then tiled as a pattern. */
    grain: (function () {
      var tile = null;
      return function (ctx, w, h) {
        P.mottle(ctx, w, h);
        if (!tile) {
          tile = document.createElement('canvas');
          tile.width = tile.height = 128;
          var g = tile.getContext('2d');
          var img = g.createImageData(128, 128);
          for (var i = 0; i < img.data.length; i += 4) {
            var v = (Math.random() * 255) | 0;
            img.data[i] = 255; img.data[i + 1] = 235; img.data[i + 2] = 200;
            img.data[i + 3] = v > 232 ? 18 : 0;
          }
          g.putImageData(img, 0, 0);
        }
        var r = EF.fullRect(w, h);
        var prev = ctx.globalAlpha;
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = ctx.createPattern(tile, 'repeat');
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.globalAlpha = prev;
      };
    }()),

    /* Uneven wash - the blotches a brush leaves behind.
     *
     * Grain alone is uniform noise, and uniform noise is exactly what makes a
     * canvas fill read as a canvas fill: evenly speckled, machine-flat. This
     * lays a few big, soft, deliberately UNEVEN patches of warm shadow and
     * warm light over the whole frame, which is what a hand-laid wash actually
     * does. Seeded, so the blotches sit in the same places in every frame and
     * every screenshot instead of crawling.
     *
     * Twenty-two ellipses per frame, against the 90 moss tufts W.ground
     * already draws - it is not a hot path. */
    mottle: function (ctx, w, h) {
      var r = EF.fullRect(w, h);
      var rnd = EF.rng(90210);
      ctx.save();
      for (var i = 0; i < 22; i++) {
        var cx = r.x + rnd() * r.w;
        var cy = r.y + rnd() * r.h;
        var rx = r.w * (0.14 + rnd() * 0.30);
        var ry = r.h * (0.06 + rnd() * 0.16);
        var warmLight = rnd() > 0.55;
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
        g.addColorStop(0, P.rgba(warmLight ? 'candleGold' : 'vignette', warmLight ? 0.035 : 0.055));
        g.addColorStop(1, P.rgba(warmLight ? 'candleGold' : 'vignette', 0));
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / Math.max(rx, ry));
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(rx, ry), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    },

    /* Warm vignette - the other half. Deepens as night falls.
       Bleed-aware: centred on the CANVAS, not on the scene band, or on a
       phone the darkening would sit in a ring across the middle of the
       playfield with bright corners above and below it. */
    vignette: function (ctx, w, h, strength) {
      var s = strength === undefined ? 0.32 : strength;
      var r = EF.fullRect(w, h);
      var mx = r.x + r.w * 0.5, my = r.y + r.h * 0.48;
      var g = ctx.createRadialGradient(mx, my, Math.min(r.w, r.h) * 0.30,
                                       mx, my, Math.max(r.w, r.h) * 0.80);
      g.addColorStop(0, P.rgba('vignette', 0));
      g.addColorStop(1, P.rgba('vignette', s + t * 0.22));
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    },

    /* Exposed so tests (and a future art pass) can walk the whole roster. */
    names: Object.keys(DAY),
    _day: DAY,
    _night: NIGHT
  };

  EF.Palette = P;

}(window));
