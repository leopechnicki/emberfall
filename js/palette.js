/* EMBERFALL - the palette.
 *
 * ONE place defines every colour in the game. Draw code never writes a hex
 * literal; it asks for a NAME ('leafRusset', 'skyMid', 'candleGold') and gets
 * back the colour for the CURRENT time of day. That is what keeps the whole
 * valley cozy instead of a scatter of nice-on-their-own oranges, and it is
 * what makes dusk a single number instead of a rewrite of every draw call.
 *
 * Brief (Klaudia, 2026-09-19): cozy autumn colours.
 *   day   - warm ambers, burnt orange, ochre, russet red, golden wheat, soft moss
 *   night - deep plum / indigo, NEVER pure black
 *   light - candle gold with a warm falloff
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
     Deep plum and indigo. The darkest value in the game is #1C1230, which is
     still a colour - there is no #000 in Emberfall. Everything keeps a trace
     of its daytime hue so the valley reads as the SAME place after dark. */
  var NIGHT = {
    skyTop:     '#1C1230',   // deep indigo-plum (darkest value in the game)
    skyMid:     '#2B1A3E',
    skyLow:     '#432449',   // warm plum near the horizon
    sun:        '#D9C6EE',   // becomes the moon
    sunGlow:    '#8A6FA8',

    hillFar:    '#39284C',
    hillMid:    '#2F2040',
    hillNear:   '#271935',
    ground:     '#2E1F33',
    groundDark: '#241829',
    path:       '#584064',
    pathEdge:   '#42304D',

    bark:       '#33223A',
    barkDark:   '#241830',

    leafGold:   '#8F7A6A',
    leafAmber:  '#8A6250',
    leafOchre:  '#74563F',
    leafOrange: '#7A4436',
    leafRusset: '#5E2C32',
    leafMoss:   '#46503F',
    mossDeep:   '#374030',

    house:      '#4B3346',
    houseDark:  '#3A2739',
    roof:       '#40253A',
    window:     '#FFCE86',   // lit from inside - stays warm after dark

    apple:      '#7A3030',
    pumpkin:    '#8A5230',
    cinnamon:   '#5E4030',
    honey:      '#8E6A34',
    acorn:      '#4A3428',
    wasp:       '#8A6A2E',

    candleGold: '#FFD489',   // light does not dim at night - that is the point
    ember:      '#FF9E4A',

    ink:        '#F3E4FF',
    cream:      '#FFF3DE',
    panel:      '#180F28',
    panelInk:   '#FFECCF',
    vignette:   '#140B22'
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
       k > 0 lifts toward cream, k < 0 sinks toward the night plum. */
    shade: function (name, k, a) {
      var c = P.rgb(name);
      var to = k >= 0 ? [255, 243, 222] : [28, 18, 48];
      var u = Math.abs(k);
      var r = lerp(c[0], to[0], u), g = lerp(c[1], to[1], u), b = lerp(c[2], to[2], u);
      if (a === undefined) return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
      return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')';
    },

    /* The sky, as a vertical gradient. Every scene draws its backdrop with
       this so day, dusk and night are literally the same three stops. */
    sky: function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0.0, P.get('skyTop'));
      g.addColorStop(0.55, P.get('skyMid'));
      g.addColorStop(1.0, P.get('skyLow'));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },

    /* Warm paper grain. This is what stops the flat canvas fills from looking
       like flat canvas fills - half of the "soft, hand-painted" ask. The tile
       is generated once and then tiled as a pattern. */
    grain: (function () {
      var tile = null;
      return function (ctx, w, h) {
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
        var prev = ctx.globalAlpha;
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = ctx.createPattern(tile, 'repeat');
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = prev;
      };
    }()),

    /* Warm vignette - the other half. Deepens as night falls. */
    vignette: function (ctx, w, h, strength) {
      var s = strength === undefined ? 0.32 : strength;
      var g = ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.30,
                                       w * 0.5, h * 0.48, Math.max(w, h) * 0.80);
      g.addColorStop(0, P.rgba('vignette', 0));
      g.addColorStop(1, P.rgba('vignette', s + t * 0.22));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },

    /* Exposed so tests (and a future art pass) can walk the whole roster. */
    names: Object.keys(DAY),
    _day: DAY,
    _night: NIGHT
  };

  EF.Palette = P;

}(window));
