/* EMBERFALL - shared helpers.
 *
 * Same shape as SKYHOOK's js/utils.js (clamp/lerp/damp/rng/Store/Particles) so
 * anyone who knows that project knows this one. Two deliberate differences:
 *
 *  1. Particles draw in TWO passes - soft leaves in normal blending, embers in
 *     'lighter'. Skyhook draws everything additive because neon on black wants
 *     that; additive leaves on a cream sky go white and stop being leaves.
 *  2. There is a text/panel helper here, because HUD legibility on BOTH a pale
 *     golden day sky and a deep plum night sky is a stated requirement, and
 *     "every draw site solves it again" is how that requirement gets lost.
 *
 * Plain script (no ES modules): modules are CORS-blocked on file://.
 */
(function (global) {
  'use strict';

  var EF = global.EF || (global.EF = {});
  var P = EF.Palette;

  EF.TAU = Math.PI * 2;

  /* ------------------------------------------------------- the view model

   * THE portrait fix, in three numbers.
   *
   * The scene is a fixed 720x540 logical space and every coordinate in
   * game.js / harvest.js / rake.js / swing.js is hand-placed inside it. That
   * is worth keeping. What was wrong was the CANVAS ELEMENT: it was letterboxed
   * to 4:3, so on a 390x844 phone it was 390x292 and the other 551 px were a
   * dead band that got filled with a button pad - "the game is on a tiny
   * screen and the buttons take the rest", which is the complaint that
   * rejected the first build.
   *
   * Now the canvas element is the whole viewport and the scene band is
   * contain-scaled inside it. The leftover is not dead space and it is not a
   * CSS background: it is MORE WORLD. main.js:fit() measures it and writes it
   * here in LOGICAL units, and every backdrop primitive (P.sky, P.grain,
   * P.mottle, P.vignette, W.hills, W.ground, W.litter, Drift) paints
   * EF.fullRect() instead of 0,0,720,540. So the sky above and the ground
   * below simply extend, and harvest / rake / swing needed no camera changes
   * at all - their existing backdrop calls expand on their own.
   *
   *   bleed.x      logical units of extra world left AND right of the scene
   *   bleed.top    logical units of extra world above it
   *   bleed.bottom logical units of extra world below it
   *
   * cssPerUnit is the other half: it is how many REAL CSS pixels one logical
   * unit is worth right now. Anything that has to be a certain size to a
   * FINGER (every touch target: 44 CSS px, WCAG 2.5.5) is sized through
   * EF.px() rather than in logical units, because a 44-unit box is 24 real
   * pixels on a phone - which is the reason the old build put its controls in
   * the DOM instead of on the canvas. */
  EF.bleed = { x: 0, top: 0, bottom: 0 };
  EF.cssPerUnit = 1;

  /* True while the canvas is a tall phone screen (touch AND taller than it is
     wide). main.js owns it; every scene reads it to choose between its
     original 720x540 composition and a portrait one. */
  EF.portrait = false;

  /* Top of the on-canvas pad's strip, in logical units - published by
     main.js, read by anything that must not draw under a thumb button.
     null means there is no pad and the scene box is the whole story. */
  EF.padTopY = null;

  /* The whole canvas, in logical units. Defaults to the scene itself, so a
     scene drawn before main.js has ever measured anything is unchanged. */
  EF.fullRect = function (w, h) {
    var sw = w === undefined ? 720 : w;
    var sh = h === undefined ? 540 : h;
    var b = EF.bleed;
    return {
      x: -b.x,
      y: -b.top,
      w: sw + b.x * 2,
      h: sh + b.top + b.bottom,
      /* convenience, because half the call sites want edges not extents */
      right: sw + b.x,
      bottom: sh + b.bottom
    };
  };

  /* --------------------------------------------------- the portrait frame
   *
   * The four scenes with a sky in them - the valley, the orchard, the yard
   * and the grove - all had the same problem and all need the same three
   * numbers to solve it, so they share them here rather than each carrying a
   * private copy of 0.30 that drifts.
   *
   *   hz      where the horizon goes: SKY_SHARE down the WHOLE canvas, not
   *           down the 720x540 scene box. This is the fix, in one line.
   *   dy(d)   depth 0 (the horizon) to depth 1 (the player's feet), eased so
   *           distance compresses toward the horizon the way it really does.
   *           A linear field reads like a board game tipped at the camera.
   *   ps(d)   perspective scale in REAL CSS PIXELS. This is the part that is
   *           easy to get wrong: a 390 px phone drawing a 720-wide scene
   *           renders everything at 54% of its authored size, so MOVING a
   *           40-unit signpost up a taller screen leaves it just as
   *           unreadable. Sizing through EF.px pins it to physical size on
   *           the glass and the depth term varies it around that.
   *
   * Only ever called when EF.portrait is true. */
  EF.SKY_SHARE = 0.30;
  EF.DEPTH_POW = 1.25;

  /* ------------------------------------------------------------- the HUD box
   *
   * The scene is composed in the 720x540 box; the HUD is not. A day card, a
   * recipe card, a timer, a wind gauge and a mute button are CHROME - they
   * belong to the edges of the SCREEN, and on a phone those are not the
   * edges of the scene box. In portrait the box starts 818 units above the
   * top of the canvas, so chrome at y=12 renders a third of the way down the
   * sky, printed over the scene. That is what the first portrait pass
   * shipped and it is the most obviously broken thing in the screenshot.
   *
   * The bottom stops at the on-canvas pad, so no HUD line is ever drawn
   * underneath a thumb button.
   *
   * On desktop and in landscape this is EXACTLY (0,0,720,540) - the authored
   * box - so neither layout moves by a pixel. */
  EF.hudRect = function () {
    if (!EF.portrait) {
      return { x: 0, y: 0, w: 720, h: 540, right: 720, bottom: 540, cx: 360 };
    }
    var r = EF.fullRect(720, 540);
    var bottom = (EF.padTopY === null || EF.padTopY === undefined)
      ? r.bottom : Math.min(r.bottom, EF.padTopY);
    return {
      x: r.x, y: r.y, w: r.w, h: bottom - r.y,
      right: r.right, bottom: bottom, cx: r.x + r.w * 0.5
    };
  };

  /* How much to magnify HUD CHROME in portrait.
   *
   * The scene got a perspective scale; the chrome did not, and a phone draws
   * the 720-wide scene at 54%, so the day card's 13-unit body text rendered
   * at 7.6 REAL pixels and the timer at 7.6. Legible only just, and only if
   * you are looking for it. This pins chrome text to a physical size on the
   * glass the same way EF.px pins touch targets, and is exactly 1 on desktop
   * and in landscape so those layouts are untouched. */
  EF.hudScale = function () {
    if (!EF.portrait) return 1;
    /* CEILING OF 1.35, and it is not taste either. The widest HUD card is
       244 units; past 1.47x it covers more than half of the 720-unit row and
       becomes the row's MEDIAN colour, at which point test/framelib.mjs
       reads the top of the screen as ground and loses the sky entirely. Tried
       at 1.85 and the gate went from 41/41 to six failures, valley reporting
       0% sky - the chrome had literally become the skyline. It is also just
       too much screen to spend on a day counter. 1.35 lifts 13-unit body
       text from 7.6 to 9.5 real pixels and leaves the card at 46% of the
       row. Making the chrome properly phone-sized needs a portrait HUD
       layout, not a bigger copy of the desktop one. */
    return EF.clamp(EF.px(12) / 12, 1, 1.35);
  };

  /* The mute control's box. Lives here rather than in game.js because the
     orchard's WIND gauge has to keep out of it, and two files computing the
     same corner independently is how they ended up drawn on top of each
     other. `left` is the leftmost pixel it occupies. */
  EF.muteBox = function () {
    var hud = EF.hudRect();
    /* authored at radius 15; on a phone 15 units is 8 CSS px, so it is sized
       off EF.px like every other touch target */
    var s = EF.portrait ? Math.max(1, EF.px(17) / 15) : 1;
    var x = hud.right - 28 * s;
    return { x: x, y: hud.y + 24 * s, s: s, left: x - 15 * s };
  };

  EF.portraitFrame = function () {
    var r = EF.fullRect(720, 540);
    var hz = r.y + r.h * EF.SKY_SHARE;
    var gd = Math.max(160, 540 - hz);
    return {
      hz: hz, gd: gd, top: r.y, bottom: r.bottom,
      dy: function (d) { return hz + gd * Math.pow(d, EF.DEPTH_POW); },
      ps: function (d) { return EF.px(54) / 40 * (0.72 + 0.42 * d); }
    };
  };

  /* n real CSS pixels, in logical units. A touch target is written
     EF.px(44) and is therefore 44 px on a phone, on a laptop, and at any
     device pixel ratio. */
  EF.px = function (n) { return n / (EF.cssPerUnit || 1); };

  EF.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  EF.lerp = function (a, b, t) { return a + (b - a) * t; };

  /* Frame-rate independent exponential smoothing.
     `half` = seconds for the value to close half the gap. */
  EF.damp = function (a, b, half, dt) { return b + (a - b) * Math.pow(2, -dt / half); };

  EF.hypot = function (x, y) { return Math.sqrt(x * x + y * y); };

  /* Smoothstep - used everywhere a transition must feel unhurried. */
  EF.ease = function (t) { t = EF.clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  /* Deterministic PRNG (mulberry32) so a day can be replayed with ?seed=N. */
  EF.rng = function (seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* localStorage throws on file:// in Chromium and in private modes. Never let
     that break the game - fall back to an in-memory store. */
  EF.Store = (function () {
    var mem = {};
    var ok = false;
    try {
      global.localStorage.setItem('__ef_probe__', '1');
      global.localStorage.removeItem('__ef_probe__');
      ok = true;
    } catch (e) { ok = false; }

    return {
      persistent: ok,
      get: function (key, def) {
        try {
          var v = ok ? global.localStorage.getItem(key) : (key in mem ? mem[key] : null);
          return (v === null || v === undefined) ? def : v;
        } catch (e) { return def; }
      },
      set: function (key, val) {
        try {
          if (ok) global.localStorage.setItem(key, String(val));
          else mem[key] = String(val);
        } catch (e) { /* quota / disabled - ignore */ }
      },
      getNum: function (key, def) {
        var n = parseFloat(this.get(key, ''));
        return isFinite(n) ? n : def;
      }
    };
  }());

  /* ------------------------------------------------------------------ art */

  /* Pre-rendered radial glow. ctx.shadowBlur is the obvious way to do candle
     light and it destroys frame time on mobile GPUs, so: one sprite, drawn. */
  EF.makeGlow = function (radius, rgb, innerAlpha) {
    var size = radius * 2;
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
    var a = innerAlpha === undefined ? 0.9 : innerAlpha;
    /* Four stops, not two: a candle's falloff is steep near the flame and long
       in the tail. A linear ramp reads as a sticker, not as light. */
    grad.addColorStop(0.00, 'rgba(' + rgb + ',' + a + ')');
    grad.addColorStop(0.18, 'rgba(' + rgb + ',' + (a * 0.55).toFixed(3) + ')');
    grad.addColorStop(0.48, 'rgba(' + rgb + ',' + (a * 0.18).toFixed(3) + ')');
    grad.addColorStop(1.00, 'rgba(' + rgb + ',0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  };

  EF.drawGlow = function (ctx, sprite, x, y, scale, alpha) {
    var r = sprite.width * 0.5 * scale;
    var prevA = ctx.globalAlpha;
    var prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = prevA;
    ctx.globalCompositeOperation = prevOp;
  };

  EF.roundRect = function (ctx, x, y, w, h, r) {
    var rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  /* A deckled edge - the jagged edge torn paper and split wood actually
     have. Seeded from the rect, so a given panel tears the same way in every
     frame and every screenshot instead of crawling. Straight lineTo segments,
     not curves: a tear is jagged, and smoothing it puts us straight back at
     the rounded rectangle. */
  EF.deckle = function (ctx, x, y, w, h, jitter) {
    var j = jitter === undefined ? 2.2 : jitter;
    var rnd = EF.rng(((x * 7 + y * 31 + w * 13 + h * 57) | 0) >>> 0);
    var stepX = Math.max(14, w / Math.max(4, Math.round(w / 26)));
    var stepY = Math.max(10, h / Math.max(3, Math.round(h / 22)));
    var v;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (v = x + stepX; v < x + w; v += stepX) ctx.lineTo(v, y + (rnd() - 0.5) * 2 * j);
    ctx.lineTo(x + w, y);
    for (v = y + stepY; v < y + h; v += stepY) ctx.lineTo(x + w + (rnd() - 0.5) * 2 * j, v);
    ctx.lineTo(x + w, y + h);
    for (v = x + w - stepX; v > x; v -= stepX) ctx.lineTo(v, y + h + (rnd() - 0.5) * 2 * j);
    ctx.lineTo(x, y + h);
    for (v = y + h - stepY; v > y; v -= stepY) ctx.lineTo(x + (rnd() - 0.5) * 2 * j, v);
    ctx.closePath();
  };

  /* A panel. Every card in the game is one of these, so the HUD, the recipe
     card and the end-of-day summary all share a material.
   *
   * It used to be a rounded rectangle with a gradient, which is the single
   * most generic shape a canvas game can draw and a fair part of why the first
   * build "looks AI-generated". It is now a torn board: deckled edge, wood
   * grain along it, rim light down the RIGHT side and shadow down the left,
   * because the valley has exactly one light source and it is up and to the
   * right (the same side the cottage windows are on).
   *
   * It stays DARK-toned on purpose. Every caller writes cream or candle-gold
   * text onto it; flipping the material to pale parchment would have meant
   * re-picking the ink in four other files, and a change that large is how a
   * reskin quietly becomes a rewrite. */
  EF.card = function (ctx, x, y, w, h, alpha) {
    var P = EF.Palette;
    var a = alpha === undefined ? 0.92 : alpha;
    var n = P.night;
    ctx.save();

    /* the board */
    EF.deckle(ctx, x, y, w, h, Math.min(2.6, h * 0.05));
    ctx.fillStyle = P.rgba('panel', a * (0.62 + n * 0.30));
    ctx.fill();

    /* grain: a few long strokes along the board, clipped to it */
    ctx.save();
    ctx.clip();
    var rnd = EF.rng(((x * 3 + w * 11) | 0) >>> 0);
    ctx.lineWidth = 1;
    for (var i = 0; i < 5; i++) {
      var gy = y + h * (0.12 + rnd() * 0.78);
      ctx.strokeStyle = P.rgba(rnd() > 0.5 ? 'barkDark' : 'cinnamon', 0.10);
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.bezierCurveTo(x + w * 0.35, gy + (rnd() - 0.5) * 3, x + w * 0.7, gy - (rnd() - 0.5) * 3, x + w, gy + (rnd() - 0.5) * 2);
      ctx.stroke();
    }
    ctx.restore();

    /* rim: warm on the lit side, shadow on the other. One light source. */
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = P.rgba('candleGold', 0.16 + n * 0.14);
    EF.deckle(ctx, x, y, w, h, Math.min(2.6, h * 0.05));
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = P.rgba('candleGold', 0.20 + n * 0.16);
    ctx.beginPath();
    ctx.moveTo(x + w, y + 3);
    ctx.lineTo(x + w, y + h - 3);
    ctx.stroke();
    ctx.strokeStyle = P.rgba('vignette', 0.35);
    ctx.beginPath();
    ctx.moveTo(x, y + 3);
    ctx.lineTo(x, y + h - 3);
    ctx.stroke();

    ctx.restore();
  };

  /* Text that stays readable on a pale gold sky AND on deep plum.
     The trick is the halo: a soft same-hue-but-opposite-value shadow under the
     glyph. Pure white text on the day sky is unreadable; a plain dark fill is
     unreadable at night. This is drawn once and works in both. */
  EF.text = function (ctx, str, x, y, size, opts) {
    var o = opts || {};
    ctx.save();
    ctx.font = (o.weight || '700') + ' ' + size + 'px ' + (o.font || '"Georgia", "Iowan Old Style", serif');
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = o.baseline || 'middle';
    if (o.halo !== false) {
      /* Halo colour is the opposite end of the value range from the fill, so
         it works whichever way round day/night has put things. */
      ctx.lineWidth = Math.max(2.5, size * 0.22);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = o.halo || EF.Palette.rgba('vignette', 0.55);
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = o.color || EF.Palette.get('panelInk');
    ctx.fillText(str, x, y);
    ctx.restore();
  };

  /* --------------------------------------------------------- particles */

  /* Fixed-capacity, zero allocation during play. Identical contract to
     Skyhook's, with a `glow` flag that routes a particle into the additive
     pass (embers, candle sparks) instead of the soft pass (leaves, dust). */
  function Particles(max) {
    this.max = max;
    this.n = 0;
    this.p = new Array(max);
    for (var i = 0; i < max; i++) {
      this.p[i] = {
        x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2,
        drag: 1.2, gravity: 0, spin: 0, rot: 0,
        r: 255, g: 255, b: 255, glow: false, leaf: false
      };
    }
  }

  Particles.prototype.spawn = function (x, y, vx, vy, life, size, rgb, o) {
    var q;
    if (this.n < this.max) q = this.p[this.n++];
    else q = this.p[(Math.random() * this.max) | 0];   // recycle under load
    o = o || {};
    q.x = x; q.y = y; q.vx = vx; q.vy = vy;
    q.life = life; q.maxLife = life; q.size = size;
    q.r = rgb[0]; q.g = rgb[1]; q.b = rgb[2];
    q.drag = o.drag === undefined ? 1.2 : o.drag;
    q.gravity = o.gravity || 0;
    q.spin = o.spin || 0;
    q.rot = o.rot || 0;
    q.glow = !!o.glow;
    q.leaf = !!o.leaf;
    return q;
  };

  Particles.prototype.update = function (dt, windX) {
    var w = windX || 0;
    for (var i = 0; i < this.n; i++) {
      var q = this.p[i];
      q.life -= dt;
      if (q.life <= 0) {
        var last = this.p[--this.n];
        this.p[this.n] = q;
        this.p[i] = last;
        i--;
        continue;
      }
      var d = Math.exp(-q.drag * dt);
      q.vx *= d; q.vy *= d;
      q.vy += q.gravity * dt;
      q.x += (q.vx + (q.leaf ? w : 0)) * dt;
      q.y += q.vy * dt;
      q.rot += q.spin * dt;
    }
  };

  Particles.prototype.draw = function (ctx) {
    var i, q, t, a, s;
    /* pass 1 - soft (leaves, dust, wax flakes) */
    for (i = 0; i < this.n; i++) {
      q = this.p[i];
      if (q.glow) continue;
      t = q.life / q.maxLife;
      a = EF.clamp(t * 1.6, 0, 1);
      s = q.size * (0.55 + t * 0.45);
      ctx.fillStyle = 'rgba(' + (q.r | 0) + ',' + (q.g | 0) + ',' + (q.b | 0) + ',' + a.toFixed(3) + ')';
      if (q.leaf) {
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, s, s * 0.52, 0, 0, EF.TAU);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(q.x, q.y, s * 0.5, 0, EF.TAU);
        ctx.fill();
      }
    }
    /* pass 2 - additive (embers, candle sparks) */
    var prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.n; i++) {
      q = this.p[i];
      if (!q.glow) continue;
      t = q.life / q.maxLife;
      a = t * t;
      s = q.size * (0.35 + t * 0.65);
      ctx.fillStyle = 'rgba(' + (q.r | 0) + ',' + (q.g | 0) + ',' + (q.b | 0) + ',' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(q.x, q.y, s * 0.5, 0, EF.TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = prevOp;
  };

  Particles.prototype.clear = function () { this.n = 0; };

  EF.Particles = Particles;

}(window));
