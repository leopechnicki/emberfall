/* EMBERFALL - the valley's drawing kit.
 *
 * Every piece of scenery the game paints lives here: sky, sun/moon, hills,
 * trees, houses, the path, lanterns and candles. The three activities all draw
 * the SAME valley with this module, which is the whole point of the design -
 * harvest, raking and the vine swing are places inside one world, not three
 * separate games with three separate looks.
 *
 * Nothing in this file contains a colour. Everything asks EF.Palette, so dusk
 * is handled for free: set the night factor and the valley changes with it.
 */
(function (global) {
  'use strict';

  var EF = global.EF;
  var P = EF.Palette;
  var TAU = EF.TAU;

  var W = {};

  /* Pre-rendered glows. Built lazily so this file can be parsed before the
     document is ready, and reused for every candle in the valley. */
  var glowBig = null, glowSmall = null;
  function glows() {
    if (!glowBig) {
      glowBig = EF.makeGlow(180, '255,196,110', 0.95);
      glowSmall = EF.makeGlow(64, '255,214,140', 0.95);
    }
  }

  /* --------------------------------------------------------------- sky */

  /* The sky, including everything in it.
   *
   * Bleed-aware throughout. In portrait the canvas is far taller than the
   * 720x540 scene, and the band above the scene is where most of this now
   * lives: the sun/moon, the stars, the haze and the skein of birds all
   * position themselves against the SKY BAND (canvas top -> horizon) instead
   * of against the scene box. A phone therefore gets a tall, composed sky
   * rather than a 4:3 picture with dead space stacked on top of it. */
  W.sky = function (ctx, w, h, time) {
    P.sky(ctx, w, h);

    var rect = EF.fullRect(w, h);
    var horizon = h * 0.62;
    var band = horizon - rect.y;          // the whole sky, top of canvas down

    /* Sun by day, moon by night - the SAME disc, moved and recoloured. Two
       separate objects that cross-fade always betray themselves at 50%. */
    var n = P.night;
    var sx = w * (0.76 - n * 0.44);
    var sy = rect.y + band * (0.26 + n * 0.03);
    var r = 26 - n * 8;

    glows();
    EF.drawGlow(ctx, glowBig, sx, sy, (1.05 - n * 0.35), 0.45 - n * 0.2);
    ctx.fillStyle = P.get('sun');
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, TAU);
    ctx.fill();
    if (n > 0.55) {
      /* Bite a crescent out of the moon with the sky colour behind it. */
      ctx.fillStyle = P.get('skyTop');
      ctx.globalAlpha = (n - 0.55) / 0.45;
      ctx.beginPath();
      ctx.arc(sx - r * 0.42, sy - r * 0.18, r * 0.92, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    /* Stars only after dusk has actually started. Spread over the whole sky
       band, and more of them when there is more sky to fill. */
    if (n > 0.35) {
      var a = (n - 0.35) / 0.65;
      var rnd = EF.rng(7717);
      var count = Math.round(70 * EF.clamp(band / (h * 0.62), 1, 2.6));
      ctx.fillStyle = P.rgba('cream', 0.75 * a);
      for (var i = 0; i < count; i++) {
        var x = rect.x + rnd() * rect.w, y = rect.y + rnd() * band;
        var tw = 0.55 + 0.45 * Math.sin(time * 1.6 + i * 2.1);
        ctx.globalAlpha = 0.75 * a * tw;
        ctx.fillRect(x, y, 1.6, 1.6);
      }
      ctx.globalAlpha = 1;
    }

    /* Long, soft haze bands. Low contrast on purpose - they should read as
       haze, not as shapes. Two passes so the band has a lit top edge and a
       heavier underside: one light source, even in the clouds. */
    var rc = EF.rng(4242);
    var bands = band > 600 ? 8 : 5;
    for (var c = 0; c < bands; c++) {
      var cy = rect.y + band * (0.10 + rc() * 0.62);
      var cw = rect.w * (0.28 + rc() * 0.4);
      var cx = ((rc() * rect.w) + time * (4 + c * 2)) % (rect.w + cw) - cw * 0.5 + rect.x;
      var ch = 10 + rc() * 14;
      ctx.fillStyle = P.rgba(n > 0.5 ? 'hillFar' : 'cream', 0.13);
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw * 0.5, ch, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = P.rgba(n > 0.5 ? 'skyTop' : 'leafOchre', 0.07);
      ctx.beginPath();
      ctx.ellipse(cx + cw * 0.04, cy + ch * 0.55, cw * 0.44, ch * 0.5, 0, 0, TAU);
      ctx.fill();
    }

    /* A skein of birds crossing the high sky. Only where there IS a high sky
       (portrait), and only while it is light enough to see them. Seven hand
       -placed chevrons in a loose V, not a scatter - a flock has a shape, and
       that shape is most of what makes it read as birds rather than as
       specks. */
    if (band > 520 && n < 0.5) {
      var bf = (1 - n / 0.5);
      var bx = ((time * 9) % (rect.w + 260)) - 130 + rect.x;
      var by = rect.y + band * 0.17;
      var flock = [[0, 0], [-26, 9], [-52, 19], [-78, 30], [22, 12], [44, 24], [64, 37]];
      ctx.save();
      ctx.strokeStyle = P.rgba('barkDark', 0.34 * bf);
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      for (var bi = 0; bi < flock.length; bi++) {
        var fx = bx + flock[bi][0], fy = by + flock[bi][1];
        /* wingbeat, out of phase down the skein */
        var beat = Math.sin(time * 3.4 + bi * 0.8) * 2.6;
        var sp = 4.4 - bi * 0.18;
        ctx.beginPath();
        ctx.moveTo(fx - sp, fy + beat);
        ctx.lineTo(fx, fy - 1.2);
        ctx.lineTo(fx + sp, fy + beat);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  /* ------------------------------------------------------------- hills */

  /* Bleed-aware: the ridge spans the whole canvas width and closes on the
     canvas floor, so on a phone it never leaves a wedge of bare sky in the
     corner where the scene box used to end. */
  function ridge(ctx, w, h, baseY, amp, seed, fill, rect) {
    var rnd = EF.rng(seed);
    var ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
    var x0 = rect.x, x1 = rect.x + rect.w, floor = rect.y + rect.h;
    ctx.beginPath();
    ctx.moveTo(x0, floor);
    for (var x = x0; x <= x1; x += 8) {
      var u = x / w;
      var y = baseY
        - Math.sin(u * 3.1 + ph[0]) * amp
        - Math.sin(u * 7.3 + ph[1]) * amp * 0.34
        - Math.sin(u * 13.7 + ph[2]) * amp * 0.16;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(x1, floor);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  W.hills = function (ctx, w, h, horizon) {
    var hz = horizon === undefined ? h * 0.58 : horizon;
    var rect = EF.fullRect(w, h);
    ridge(ctx, w, h, hz - 34, 22, 101, P.get('hillFar'), rect);
    ridge(ctx, w, h, hz - 12, 16, 202, P.get('hillMid'), rect);
    ridge(ctx, w, h, hz + 10, 11, 303, P.get('hillNear'), rect);
  };

  /* Bleed-aware: the ground runs to the edges of the CANVAS, not to the edges
     of the 720x540 scene box. Without this the slab stopped dead partway
     across a phone in landscape and left two vertical seams of sky running
     down to the bottom of the screen - visible in
     test/screenshots/mobile_landscape.png before this pass. The colour ramp is
     still anchored to the scene box, so day/dusk/night are unchanged. */
  W.ground = function (ctx, w, h, y) {
    var r = EF.fullRect(w, h);
    var g = ctx.createLinearGradient(0, y, 0, h);
    g.addColorStop(0, P.get('ground'));
    g.addColorStop(1, P.get('groundDark'));
    ctx.fillStyle = g;
    ctx.fillRect(r.x, y, r.w, r.bottom - y);

    /* Scattered moss tufts so the ground is not a flat slab. Density per unit
       of area, so a taller portrait yard is not a bald one. */
    var rnd = EF.rng(555);
    var area = Math.max(1, r.w * (r.bottom - y));
    var n = Math.round(EF.clamp(90 * area / (w * Math.max(1, h - y)), 90, 900));
    for (var i = 0; i < n; i++) {
      var x = r.x + rnd() * r.w;
      var yy = y + rnd() * (r.bottom - y);
      var s = 2 + rnd() * 4;
      ctx.fillStyle = P.rgba(rnd() > 0.5 ? 'leafMoss' : 'mossDeep', 0.35);
      ctx.beginPath();
      ctx.ellipse(x, yy, s, s * 0.5, 0, 0, TAU);
      ctx.fill();
    }
  };

  /* A winding golden track - this is where the candles go at dusk.
   *
   * `spec` is the portrait composition's way in: a list of points to run the
   * track through plus the width at each end, so the same primitive draws the
   * short left-to-right curve the 720x540 valley was authored with AND the
   * long tapered track that climbs a phone screen from the player's feet to
   * the horizon. Called without it, the geometry is byte-for-byte what it was.
   *
   *   spec.pts   [[x,y], ...] near end first, horizon last
   *   spec.w0    track width at the near end
   *   spec.w1    track width at the horizon
   *
   * Perspective is the whole reason for the taper: a constant-width ribbon
   * running that far up a portrait screen reads as a wall, not as a path. */
  W.path = function (ctx, w, h, y, spec) {
    ctx.save();
    if (!spec) {
      ctx.beginPath();
      ctx.moveTo(-20, h + 10);
      ctx.quadraticCurveTo(w * 0.28, y + 54, w * 0.52, y + 16);
      ctx.quadraticCurveTo(w * 0.74, y - 14, w + 20, y - 4);
      ctx.lineWidth = 46;
      ctx.lineCap = 'round';
      ctx.strokeStyle = P.get('pathEdge');
      ctx.stroke();
      ctx.lineWidth = 34;
      ctx.strokeStyle = P.get('path');
      ctx.stroke();
      ctx.restore();
      return;
    }

    var pts = W.samplePath(spec.pts, 42);
    ribbon(ctx, pts, spec.w0 + 12, spec.w1 + 6, P.get('pathEdge'));
    ribbon(ctx, pts, spec.w0, spec.w1, P.get('path'));
    ctx.restore();
  };

  /* A tapered ribbon through sampled centre points: one filled polygon, left
     edge down and right edge back, so there is no seam between segments. */
  function ribbon(ctx, pts, w0, w1, fill) {
    var i, n = pts.length;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      var hw = (w0 + (w1 - w0) * (i / (n - 1))) * 0.5;
      ctx.lineTo(pts[i][0] - hw, pts[i][1]);
    }
    for (i = n - 1; i >= 0; i--) {
      var hw2 = (w0 + (w1 - w0) * (i / (n - 1))) * 0.5;
      ctx.lineTo(pts[i][0] + hw2, pts[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /* Catmull-Rom through the control points, sampled evenly. Exposed because
     the valley puts its signposts, its candles and its keeper ON the path -
     and a signpost that floats a few units off the track it names is exactly
     the kind of small wrong that makes a scene look assembled. */
  W.samplePath = function (pts, steps) {
    var out = [];
    var n = pts.length;
    var at = function (i) { return pts[EF.clamp(i, 0, n - 1) | 0]; };
    for (var seg = 0; seg < n - 1; seg++) {
      var p0 = at(seg - 1), p1 = at(seg), p2 = at(seg + 1), p3 = at(seg + 2);
      var per = Math.max(2, Math.round(steps / (n - 1)));
      for (var s = 0; s < per; s++) {
        var t = s / per, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    out.push([pts[n - 1][0], pts[n - 1][1]]);
    return out;
  };

  /* -------------------------------------------------------------- tree */

  /* Deterministic from `seed`, so the same tree is in the same place every
     frame and in every screenshot. Canopy is a cluster of overlapping blobs
     in four leaf colours - cheap, and it reads as hand-painted because no two
     blobs share an edge. */
  W.tree = function (ctx, x, groundY, scale, seed, opts) {
    var o = opts || {};
    var rnd = EF.rng(seed);
    var s = scale;
    var trunkH = (86 + rnd() * 34) * s;
    var trunkW = (13 + rnd() * 6) * s;
    var topY = groundY - trunkH;

    /* trunk */
    ctx.fillStyle = P.get('bark');
    ctx.beginPath();
    ctx.moveTo(x - trunkW * 0.62, groundY);
    ctx.quadraticCurveTo(x - trunkW * 0.30, groundY - trunkH * 0.55, x - trunkW * 0.22, topY);
    ctx.lineTo(x + trunkW * 0.22, topY);
    ctx.quadraticCurveTo(x + trunkW * 0.30, groundY - trunkH * 0.55, x + trunkW * 0.62, groundY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = P.rgba('barkDark', 0.5);
    ctx.fillRect(x - trunkW * 0.55, groundY - trunkH * 0.9, trunkW * 0.22, trunkH * 0.9);

    /* three boughs */
    ctx.strokeStyle = P.get('bark');
    ctx.lineCap = 'round';
    for (var b = 0; b < 3; b++) {
      var dir = b === 1 ? 0 : (b === 0 ? -1 : 1);
      ctx.lineWidth = 6 * s;
      ctx.beginPath();
      ctx.moveTo(x, topY + 16 * s);
      ctx.quadraticCurveTo(x + dir * 24 * s, topY - 4 * s, x + dir * 42 * s, topY - 22 * s);
      ctx.stroke();
    }

    /* canopy */
    var cols = o.bare ? ['bark'] : ['leafRusset', 'leafOrange', 'leafAmber', 'leafGold', 'leafOchre'];
    var blobs = o.bare ? 0 : (14 + (rnd() * 6 | 0));
    var cr = (48 + rnd() * 14) * s;
    var cy = topY - 16 * s;
    for (var i = 0; i < blobs; i++) {
      var a = rnd() * TAU;
      var d = Math.pow(rnd(), 0.6) * cr;
      var bx = x + Math.cos(a) * d * 1.22;
      var by = cy + Math.sin(a) * d * 0.74;
      var br = (17 + rnd() * 15) * s;
      ctx.fillStyle = P.rgba(cols[(rnd() * cols.length) | 0], 0.93);
      ctx.beginPath();
      ctx.ellipse(bx, by, br, br * 0.84, rnd() * TAU, 0, TAU);
      ctx.fill();
    }

    /* A few fruit dots so an orchard tree reads as an orchard tree. */
    if (o.fruit) {
      for (var f = 0; f < 5; f++) {
        var fa = rnd() * TAU, fd = rnd() * cr;
        ctx.fillStyle = P.get('apple');
        ctx.beginPath();
        ctx.arc(x + Math.cos(fa) * fd * 1.15, cy + Math.sin(fa) * fd * 0.7, 4 * s, 0, TAU);
        ctx.fill();
      }
    }

    return { x: x, topY: topY, canopyY: cy, canopyR: cr };
  };

  /* Leaf litter at the foot of everything. Static, seeded. */
  /* Bleed-aware in x for the same reason W.ground is: leaves that stop at the
     scene edge draw the seam they were meant to hide. Density is per unit of
     area so a taller portrait ground is covered as densely as a short one. */
  W.litter = function (ctx, w, y, h, seed, density) {
    var rnd = EF.rng(seed || 909);
    var cols = ['leafRusset', 'leafOrange', 'leafAmber', 'leafGold', 'leafOchre'];
    var r = EF.fullRect(w);
    var n = Math.round((density || 120) * (r.w / w));
    for (var i = 0; i < n; i++) {
      var x = r.x + rnd() * r.w;
      var yy = y + rnd() * h;
      var s = 3 + rnd() * 4;
      ctx.save();
      ctx.translate(x, yy);
      ctx.rotate(rnd() * TAU);
      ctx.fillStyle = P.rgba(cols[(rnd() * 5) | 0], 0.75);
      ctx.beginPath();
      ctx.ellipse(0, 0, s, s * 0.5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  };

  /* ------------------------------------------------------------- house */

  W.house = function (ctx, x, groundY, scale, lit) {
    var s = scale;
    var bw = 66 * s, bh = 46 * s;
    var y = groundY - bh;
    ctx.fillStyle = P.get('house');
    ctx.fillRect(x - bw * 0.5, y, bw, bh);
    ctx.fillStyle = P.rgba('houseDark', 0.55);
    ctx.fillRect(x - bw * 0.5, y, bw * 0.22, bh);

    /* roof */
    ctx.fillStyle = P.get('roof');
    ctx.beginPath();
    ctx.moveTo(x - bw * 0.62, y + 2 * s);
    ctx.lineTo(x, y - 30 * s);
    ctx.lineTo(x + bw * 0.62, y + 2 * s);
    ctx.closePath();
    ctx.fill();

    /* window - the one thing that is warm before the lanterns are lit */
    var wx = x + 8 * s, wy = y + 14 * s, ws = 15 * s;
    ctx.fillStyle = P.get('window');
    ctx.fillRect(wx - ws * 0.5, wy, ws, ws);
    ctx.strokeStyle = P.rgba('barkDark', 0.6);
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.moveTo(wx, wy); ctx.lineTo(wx, wy + ws);
    ctx.moveTo(wx - ws * 0.5, wy + ws * 0.5); ctx.lineTo(wx + ws * 0.5, wy + ws * 0.5);
    ctx.stroke();

    /* door */
    ctx.fillStyle = P.get('barkDark');
    EF.roundRect(ctx, x - 23 * s, groundY - 26 * s, 16 * s, 26 * s, 7 * s);
    ctx.fill();

    if (lit > 0) {
      glows();
      EF.drawGlow(ctx, glowSmall, wx, wy + ws * 0.5, 1.5 * s, 0.5 * lit);
    }
  };

  /* ----------------------------------------------------------- lantern */

  /* The keeper's lantern: the object the whole 30-day loop is about.
     `lit` is 0..1 so lighting it is an animation, not a boolean flip. */
  W.lantern = function (ctx, x, y, scale, lit, time) {
    var s = scale;
    glows();

    /* post */
    ctx.strokeStyle = P.get('barkDark');
    ctx.lineWidth = 4 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + 4 * s);
    ctx.lineTo(x, y + 52 * s);
    ctx.stroke();

    var flick = 1;
    if (lit > 0) {
      flick = 0.86 + 0.14 * Math.sin(time * 9.1) + 0.06 * Math.sin(time * 21.3);
      EF.drawGlow(ctx, glowBig, x, y - 4 * s, (0.5 + lit * 0.7) * s * flick, 0.70 * lit);
    }

    /* cage */
    ctx.fillStyle = P.rgba('barkDark', 0.92);
    ctx.beginPath();
    ctx.moveTo(x - 12 * s, y + 6 * s);
    ctx.lineTo(x - 9 * s, y - 12 * s);
    ctx.lineTo(x + 9 * s, y - 12 * s);
    ctx.lineTo(x + 12 * s, y + 6 * s);
    ctx.closePath();
    ctx.fill();

    /* glass - warm even unlit, so it never looks like a dead prop */
    ctx.fillStyle = lit > 0
      ? P.rgba('candleGold', 0.35 + 0.6 * lit * flick)
      : P.rgba('cream', 0.14);
    ctx.beginPath();
    ctx.moveTo(x - 9.5 * s, y + 4 * s);
    ctx.lineTo(x - 7 * s, y - 10 * s);
    ctx.lineTo(x + 7 * s, y - 10 * s);
    ctx.lineTo(x + 9.5 * s, y + 4 * s);
    ctx.closePath();
    ctx.fill();

    /* cap + hook */
    ctx.fillStyle = P.get('barkDark');
    ctx.fillRect(x - 13 * s, y - 17 * s, 26 * s, 6 * s);
    ctx.strokeStyle = P.get('barkDark');
    ctx.lineWidth = 2.6 * s;
    ctx.beginPath();
    ctx.arc(x, y - 21 * s, 5 * s, Math.PI * 0.15, Math.PI * 0.85, true);
    ctx.stroke();

    if (lit > 0) W.flame(ctx, x, y - 2 * s, s * (0.9 + 0.3 * lit), time, lit);
  };

  /* A path candle. Same light, smaller. */
  W.candle = function (ctx, x, y, scale, lit, time) {
    var s = scale;
    glows();
    if (lit > 0) EF.drawGlow(ctx, glowSmall, x, y - 6 * s, (1.1 + lit) * s, 0.72 * lit);
    /* An unlit candle is a stub of wax in the grass, not a white peg. At 0.85
       alpha the whole path read as scattered litter before a single flame was
       spent; it has to be quiet until the player pays for it. */
    ctx.fillStyle = P.rgba('cream', 0.30 + 0.55 * lit);
    EF.roundRect(ctx, x - 3.2 * s, y - 10 * s, 6.4 * s, 12 * s, 2 * s);
    ctx.fill();
    ctx.fillStyle = P.rgba('barkDark', 0.35);
    ctx.fillRect(x - 3.2 * s, y + 1 * s, 6.4 * s, 1.5 * s);
    if (lit > 0) W.flame(ctx, x, y - 11 * s, s * 0.62, time + x, lit);
  };

  W.flame = function (ctx, x, y, s, time, a) {
    var f = 0.85 + 0.15 * Math.sin(time * 11 + x * 0.3);
    var prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.fillStyle = P.rgba('ember', 0.85);
    ctx.beginPath();
    ctx.ellipse(x, y - 4 * s, 3.4 * s * f, 7 * s * f, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = P.rgba('candleGold', 0.95);
    ctx.beginPath();
    ctx.ellipse(x, y - 4.6 * s, 1.8 * s * f, 4.4 * s * f, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
  };

  /* ----------------------------------------------------------- keeper */

  /* The player character, drawn in ONE place so the valley, the orchard and
     the vine grove are unarguably the same person. Options let a caller lean
     her, swing her arm up to a rope, or dim the lantern she always carries -
     everything else is fixed, because a silhouette that drifts between scenes
     is how a game stops feeling like one world. */
  W.keeper = function (ctx, x, y, o) {
    o = o || {};
    var s = o.scale === undefined ? 1 : o.scale;
    var face = o.face === undefined ? 1 : o.face;
    var time = o.time || 0;
    var lit = o.lit === undefined ? 0.85 : o.lit;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(o.rot || 0);
    if (s !== 1) ctx.scale(s, s);

    /* cloak */
    ctx.fillStyle = P.get('leafRusset');
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.quadraticCurveTo(-16, 2, -12, 22);
    ctx.lineTo(12, 22);
    ctx.quadraticCurveTo(16, 2, 0, -20);
    ctx.closePath();
    ctx.fill();
    /* hood */
    ctx.fillStyle = P.shade('leafRusset', -0.14);
    ctx.beginPath(); ctx.arc(0, -22, 10, 0, TAU); ctx.fill();
    /* face */
    ctx.fillStyle = P.rgba('cream', 0.85);
    ctx.beginPath(); ctx.ellipse(face * 3, -21, 5.2, 5.6, 0, 0, TAU); ctx.fill();
    /* arm: up to the rope while swinging, out to the side otherwise */
    ctx.strokeStyle = P.shade('leafRusset', -0.2);
    ctx.lineWidth = 4.4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    if (o.swinging) ctx.lineTo(0, -30); else ctx.lineTo(face * 12, -4);
    ctx.stroke();
    /* the lantern, carried lit even by day - it is the job */
    var lx = face * -11, ly = 6;
    ctx.strokeStyle = P.get('barkDark'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(lx, ly - 6); ctx.stroke();
    W.candle(ctx, lx, ly, 0.8, lit, time);

    ctx.restore();
  };

  /* --------------------------------------------------------- signpost */

  /* A wooden sign in the grass. This is how the valley offers an activity:
     a thing standing in the world you walk up to, not a menu button floating
     over it. `locked` greys the plank and hangs a small latch on it. */
  W.sign = function (ctx, x, y, label, sub, o) {
    o = o || {};
    var w = o.w || 132, h = o.h || 40;
    var hover = o.hover ? 1 : 0;
    var locked = !!o.locked;
    var bob = Math.sin((o.time || 0) * 2.2 + x * 0.02) * (hover ? 1.6 : 0.5);

    ctx.save();
    ctx.translate(x, y + bob);
    /* One scale for the whole sign - plank, post, grain AND lettering. The
       label is the reason this is a transform and not a bigger w/h: a phone
       that scales the board but leaves 14-unit type on it gets a bigger sign
       nobody can read. Signs are thumb targets, so game.js sizes them through
       EF.px() and hit-tests the same s (js/game.js _hit). */
    var s = o.s || 1;
    if (s !== 1) ctx.scale(s, s);

    /* post */
    ctx.strokeStyle = P.get('barkDark');
    ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 34); ctx.stroke();

    /* plank */
    ctx.fillStyle = P.rgba(locked ? 'barkDark' : 'bark', 0.95);
    EF.roundRect(ctx, -w * 0.5, -h, w, h, 5);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = P.rgba('candleGold', locked ? 0.16 : (0.30 + hover * 0.45));
    ctx.stroke();

    /* grain lines - two, enough to read as wood, few enough to stay quiet */
    ctx.strokeStyle = P.rgba('barkDark', 0.35);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-w * 0.44, -h * 0.66); ctx.lineTo(w * 0.44, -h * 0.70);
    ctx.moveTo(-w * 0.44, -h * 0.28); ctx.lineTo(w * 0.44, -h * 0.24);
    ctx.stroke();

    var ink = locked ? P.rgba('cream', 0.42)
                     : P.rgba('candleGold', 0.85 + hover * 0.15);
    EF.text(ctx, label, 0, -h + (sub ? 15 : h * 0.5), 14,
      { color: ink, halo: P.rgba('vignette', 0.5), weight: '700' });
    if (sub) {
      EF.text(ctx, sub, 0, -h + 31, 11,
        { color: P.rgba('cream', locked ? 0.4 : 0.72), halo: false, weight: '600' });
    }

    if (locked) {
      ctx.fillStyle = P.rgba('cream', 0.30);
      EF.roundRect(ctx, -5, -h - 11, 10, 9, 2);
      ctx.fill();
      ctx.strokeStyle = P.rgba('cream', 0.30);
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(0, -h - 11, 3.4, Math.PI, 0); ctx.stroke();
    } else if (hover) {
      /* a warm ember hovering over the sign you are about to choose */
      glows();
      EF.drawGlow(ctx, glowSmall, 0, -h * 0.5, 1.5, 0.22);
    }
    ctx.restore();
  };

  /* ------------------------------------------------- ambient leaf fall */

  /* Leaves drifting across every scene. Wind-aware, so the same gust that
     pushes fruit in Harvest also tilts the background leaves. */
  function Drift(count, w, h, seed) {
    this.w = w; this.h = h;
    this.items = [];
    var rnd = EF.rng(seed || 1234);
    for (var i = 0; i < count; i++) {
      this.items.push({
        x: rnd() * w, y: rnd() * h,
        vy: 14 + rnd() * 30, sway: 0.4 + rnd() * 1.3, phase: rnd() * TAU,
        s: 3 + rnd() * 4, rot: rnd() * TAU, spin: (rnd() - 0.5) * 1.6,
        col: ['leafRusset', 'leafOrange', 'leafAmber', 'leafGold', 'leafOchre'][(rnd() * 5) | 0]
      });
    }
  }
  Drift.prototype.update = function (dt, wind) {
    for (var i = 0; i < this.items.length; i++) {
      var q = this.items[i];
      q.phase += dt * q.sway;
      q.y += q.vy * dt;
      q.x += (Math.sin(q.phase) * 16 + (wind || 0) * 0.55) * dt;
      q.rot += q.spin * dt;
      if (q.y > this.h + 14) { q.y = -14; q.x = Math.random() * this.w; }
      if (q.x < -20) q.x = this.w + 18;
      if (q.x > this.w + 20) q.x = -18;
    }
  };
  Drift.prototype.draw = function (ctx, alpha) {
    var a = alpha === undefined ? 0.8 : alpha;
    for (var i = 0; i < this.items.length; i++) {
      var q = this.items[i];
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.fillStyle = P.rgba(q.col, a);
      ctx.beginPath();
      ctx.ellipse(0, 0, q.s, q.s * 0.5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  };
  W.Drift = Drift;

  EF.World = W;

}(window));
