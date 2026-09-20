/* EMBERFALL - AUTUMN SKYHOOK.
 *
 * The traversal mode: swing tree to tree on vines to reach the high orchard,
 * where the best apples are. This is the one place Emberfall borrows a verb
 * wholesale from SKYHOOK - hook, swing, release, with one input.
 *
 * What is REUSED from Skyhook: the three-beat input contract (tap to hook, the
 * swing does the work, tap to let go), the "your release angle is the whole
 * skill" idea, and the tangential-velocity handoff at release.
 * What is DIFFERENT: Skyhook puts you in a circular ORBIT around a body at a
 * Kepler rate - a rope that can point anywhere and never slacks. A vine is a
 * PENDULUM: gravity is one direction, the anchor is above you, and the
 * interesting angles are the bottom of the arc. So the maths here is
 *     angAcc = -(g/len) * sin(ang) + (wind/len) * cos(ang)
 * rather than omega = sqrt(mu / r^3). Same verb, honest local physics.
 *
 * Cozy rules: there is no death. Falling costs you height and a moment; the
 * ground is soft and you can always hop back up to the next vine.
 */
(function (global) {
  'use strict';

  var EF = global.EF;
  var P = EF.Palette;
  var Wd = EF.World;
  var TAU = EF.TAU;

  var VIEW_W = 720, VIEW_H = 540;
  var WORLD_W = 3400;
  var GROUND_Y = 462;
  var STAND_Y = GROUND_Y - 26;     // where the keeper's feet sit on the grass
  var GOAL_X = 3180;
  var GOAL_Y = GROUND_Y - 150;     // deck of the high orchard platform
  var GRAV = 1250;

  /* ---- hook geometry. These numbers ARE the mode, and they are related.
   *
   * A pendulum can only ever spend height. Hook a vine at the BOTTOM of its
   * arc and there is no height to spend, so the amplitude is whatever speed
   * you happened to arrive with and never one degree more.
   *
   * The first grove did exactly that. Anchors sat ~180 px above the grass and
   * the rope was allowed to be 190 long, so a vine's resting bottom WAS the
   * grass: the keeper always grabbed on at the bottom of the arc. Measured
   * (test/_probe_swing.mjs): amplitude +-15.9 deg, peak climb 7 px, peak
   * upward speed 18 px/s, 48 px gained per hook against 25 px/s of free
   * ground drift. She could not leave the ground, and no release timing could
   * make her - with the arc's bottom pinned to the grass the ceiling on
   * amplitude is ~18 deg no matter who is holding the mouse.
   *
   * ARC_CLEAR is the fix. A grab is only offered when the rope it would give
   * you hangs its bottom at least this far ABOVE the standing line, which
   * forces every hook to land somewhere up the arc with real height in hand.
   * A tap from the grass therefore cannot be a hook - it becomes the HOP that
   * was already there as the never-stuck valve, and the keeper enters the
   * grove airborne. Which is how a swing is supposed to start.
   *
   * Nothing here hands out free energy: the rope is exactly as long as the
   * gap you grabbed it across (see _hook - the old min(MAX_LEN, dist) clamp
   * teleported the keeper up the rope, which is a physics cheat), and the
   * only thing the vine gives you is the height you brought to it. */
  var REACH     = 230;             // how far the hook can be thrown
  var MIN_LEN   = 70;              // shorter than this is a hug, not a swing
  var ARC_CLEAR = 26;              // clearance from arc bottom to standing line
  var ARC_FLOOR = STAND_Y - ARC_CLEAR;   // a.y + len may not exceed this
  var HOP_V     = 560;             // the never-stuck hop, px/s
  var VINE_REST = 6;               // a vine you let go of hangs limp this long
  var DRIFT_V   = 38;              // cozy forward nudge while stood on grass

  /* ---------------------------------------------------------- the grove box
   *
   * The grove is the one scene that is fixed WITHOUT touching a single
   * coordinate of its world, and that is deliberate.
   *
   * Everything above this line is a tuned pendulum: REACH, MIN_LEN,
   * ARC_CLEAR, HOP_V and GRAV are related to each other and to the anchor
   * heights, and the long comment above says exactly how much work it took
   * to get the keeper off the grass. Re-composing the grove the way the
   * valley and the orchard were re-composed would mean re-deriving all of
   * it, and any error would be a physics bug rather than a framing one.
   *
   * It does not need re-composing, because the grove already has a CAMERA
   * and its input is tap-anywhere (Swing.pointer ignores x and y). So
   * portrait changes the camera instead: a uniform zoom about the ground
   * line, which shows a narrower, taller slice of exactly the same world.
   * The simulation is untouched and byte-for-byte the build that was signed
   * off; only the lens changes.
   *
   * The zoom is UNIFORM (same S in x and y). A vertical-only stretch would
   * fill the screen just as well and would quietly turn every circular arc
   * into an ellipse - a pendulum that visibly disagrees with its own rope.
   *
   *   S    zoom. There is a HARD CEILING on this one and it is not taste.
   *        The keeper sits `lead` in from the left, so the world visible
   *        ahead of her is view-lead, and a hook can be thrown REACH=230.
   *        If view-lead drops below REACH the game starts offering grabs at
   *        vines that are off the right-hand edge - the player is asked to
   *        aim at something they cannot see. With lead = 0.28*view that
   *        pins view >= 230/0.72 = 320, so S <= 720/320 = 2.25. At S=2.0 the
   *        view is 360 with 259 of it ahead of her: 29 units of margin on
   *        REACH, and 100 behind her (see TREE_S note on the backward case).
   *   GY   screen y the ground line lands on. DERIVED from EF.padTopY, not
   *        hard-coded: a fixed 600 happened to clear the pad by 3 units at
   *        390x844 and put the keeper's feet UNDER the pad at 414x896, which
   *        the gate would never have seen because it only runs one size.
   *
   * A zoom that respects the REACH ceiling cannot fill a 1558-unit-tall
   * canvas on its own: the grove is only ~324 units from canopy to grass, so
   * filling the phone by zoom alone would need S=4.8 and a 150-unit window.
   *
   * TREE_S is what fills it, and it is the honest version of the fix. The
   * grove's trees are PURE SCENERY - `tr.scale` is cosmetic, the anchors are
   * a separate list and the physics never reads it - so in portrait they are
   * drawn taller. The band above the vines then fills with the actual grove
   * the player is swinging through, at the right parallax, instead of with
   * wallpaper. The first attempt filled it with three scrolling background
   * bands and left the playable layer a strip along the bottom; the review
   * called that what it was, and it was right - the gate passes on bare
   * ground either way, because it measures where the horizon is and not
   * whether anything is happening. */
  var ZOOM = 2.0;
  var TREE_S = 1.22;
  var PAD_MARGIN = 14;
  var _sl = null, _slKey = '';

  function layout() {
    var b = EF.bleed;
    var key = (EF.portrait ? 'p' : 'l') + b.x + '_' + b.top + '_' + b.bottom + '_' + EF.cssPerUnit;
    if (_slKey !== key) { _slKey = key; _sl = EF.portrait ? tallGrove() : flatGrove(); }
    return _sl;
  }

  function flatGrove() {
    return {
      tall: false, S: 1, GY: 0, treeS: 1, hillY: 336,
      gFill: GROUND_Y, bottom: VIEW_H, far: null,
      lead: 250, camMax: WORLD_W - VIEW_W
    };
  }

  function tallGrove() {
    var F = EF.portraitFrame();
    var r = EF.fullRect(VIEW_W, VIEW_H);
    var view = VIEW_W / ZOOM;
    /* the grass line sits a margin above the pad, wherever the pad is */
    var gy = (EF.padTopY === null || EF.padTopY === undefined)
      ? r.bottom - 150 : EF.padTopY - PAD_MARGIN;
    return {
      tall: true, S: ZOOM, GY: gy, treeS: TREE_S, hillY: F.hz,
      /* the grove floor runs from the skyline, so there is no dead band
         between the hills and the trees */
      gFill: F.hz + 22, bottom: r.bottom,
      /* a treeline ON the skyline, drawn in SCREEN space - the zoomed world
         layer is far too magnified to put anything believable at this
         distance in it */
      far: [
        { x: 44, y: F.hz + 14, s: 0.42, seed: 301 },
        { x: 198, y: F.hz + 8, s: 0.34, seed: 302 },
        { x: 366, y: F.hz + 11, s: 0.38, seed: 303 },
        { x: 534, y: F.hz + 7, s: 0.33, seed: 304 },
        { x: 690, y: F.hz + 15, s: 0.44, seed: 305 }
      ],
      /* Two bands of grove between the skyline and the playable trees, each
         scrolling at its own fraction of the camera so the distance reads.
         They wrap on `span`, so the grove never runs out however far she
         travels - a distant tree repeating is not something the eye tracks,
         and 3400 units of hand-placed backdrop is not either. */
      /* One band only, high and far. The near two are gone: the grove's own
         trees now occupy that space, and stacking wallpaper in front of real
         trees just hid them. */
      bands: [
        { par: 0.22, span: 760, n: 5, y: F.hz + 112, s: 0.58, seed: 410 },
        { par: 0.40, span: 700, n: 4, y: F.hz + 268, s: 0.92, seed: 520 }
      ],
      lead: view * 0.28, camMax: WORLD_W - view
    };
  }

  function Swing(game, seed) {
    this.game = game;
    this.rnd = EF.rng(seed || 771122);
    this.t = 0;
    this.done = false;

    /* ---- the grove. Trees first, then one vine anchor per tree, so every
       anchor is visibly attached to something. */
    this.trees = [];
    this.anchors = [];
    var x = 150;
    var i = 0;
    while (x < WORLD_W - 120) {
      var scale = 1.15 + this.rnd() * 0.5;
      var t = { x: x, scale: scale, seed: 1000 + i * 37 };
      this.trees.push(t);
      /* Anchor height rises gently across the grove: the high orchard is up,
         so the route should feel like a climb, not a flat corridor. */
      var prog = x / WORLD_W;
      var ay = 250 - prog * 96 + (this.rnd() - 0.5) * 46;
      this.anchors.push({ x: x + (this.rnd() - 0.5) * 30, y: ay, used: 0 });
      x += 175 + this.rnd() * 95;
      i++;
    }

    /* ---- golden leaves worth an extra apple each */
    this.leaves = [];
    for (i = 0; i < 14; i++) {
      var a = this.anchors[(i * 2 + 1) % this.anchors.length];
      this.leaves.push({ x: a.x + 70, y: a.y + 120 + (this.rnd() - 0.5) * 70, got: false, ph: this.rnd() * TAU });
    }

    this.p = {
      x: 90, y: GROUND_Y - 26, vx: 130, vy: 0,
      mode: 'free', anchor: null, len: 0, ang: 0, angVel: 0,
      face: 1, groundT: 0
    };

    this.camX = 0;
    this.wind = 0;
    this.gustIn = 3 + this.rnd() * 3;
    this.gust = 0;

    this.hooks = 0;
    this.best = 90;            // furthest x reached, for the progress bar
    this.falls = 0;
    this.apples = 0;
    this.reached = false;
    this.reachT = 0;

    this.toast = 'tap to hook a vine  -  tap again to let go';
    this.toastT = 4;

    this.particles = new EF.Particles(200);
    this.drift = new Wd.Drift(20, VIEW_W, VIEW_H, 5150);
  }

  Swing.prototype.label = 'Swing';

  /* ------------------------------------------------------------ input */

  Swing.prototype.action = function () {
    if (this.done) return;
    var p = this.p;
    if (p.mode === 'swing') { this._release(); return; }
    if (!this._hook() && p.y >= GROUND_Y - 30) {
      /* Nothing in reach and we are on the grass: hop. This is the "you can
         never be stuck" valve - without it a bad release strands the player
         under a gap with no way back into the game. */
      p.vy = -520;
      p.vx = Math.max(p.vx, 170);
      p.groundT = 0;
      if (EF.Audio) EF.Audio.pip();
    }
  };
  Swing.prototype.pointer = function () { this.action(); };

  Swing.prototype._hook = function () {
    var p = this.p, best = null, bestD = 1e9;
    for (var i = 0; i < this.anchors.length; i++) {
      var a = this.anchors[i];
      if (a.y > p.y - 18) continue;                 // must be above us
      var d = EF.hypot(a.x - p.x, a.y - p.y);
      if (d > REACH || d < 34) continue;
      /* and it must be ON SCREEN. REACH is a radius, so a vine up to 230
         BEHIND her is eligible while only `lead` units behind are visible -
         in the flat layouts lead is 250 and this never bites, in portrait it
         is 100 and without this the game offers a grab at something the
         player cannot see. */
      if (a.x < p.x - layout().lead) continue;
      /* Prefer anchors ahead: this is a traversal, and a hook that drags you
         backwards is never the one the player meant. */
      var score = d - (a.x > p.x ? 55 : 0);
      if (score < bestD) { bestD = score; best = a; }
    }
    if (!best) return false;

    var dx = p.x - best.x, dy = p.y - best.y;
    var len = EF.hypot(dx, dy);        // exactly the gap we grabbed it across
    p.mode = 'swing';
    p.anchor = best;
    p.len = len;
    p.ang = Math.atan2(dx, dy);                      // 0 = hanging straight down
    /* Hand the current velocity to the rope as angular rate: angVel = (v.T)/len
       with tangent T = (cos ang, -sin ang). Dropping this would make every
       hook a dead stop, which is exactly how a swing game stops being fun. */
    var tx = Math.cos(p.ang), ty = -Math.sin(p.ang);
    p.angVel = (p.vx * tx + p.vy * ty) / Math.max(1, len);
    best.used = 1;
    this.hooks++;
    if (EF.Audio) EF.Audio.hook();
    return true;
  };

  Swing.prototype._release = function () {
    var p = this.p;
    var tx = Math.cos(p.ang), ty = -Math.sin(p.ang);
    var v = p.angVel * p.len;
    p.vx = v * tx;
    p.vy = v * ty - 90;            // small upward kick so a release reads as a leap
    p.mode = 'free';
    p.anchor = null;
    if (EF.Audio) EF.Audio.woosh();
    var gold = P.rgb('leafGold');
    for (var i = 0; i < 10; i++) {
      this.particles.spawn(p.x, p.y, (this.rnd() - 0.5) * 120, (this.rnd() - 0.5) * 120,
        0.5, 5, gold, { drag: 1.4, leaf: true, spin: 7 });
    }
  };

  /* ------------------------------------------------------------ logic */

  Swing.prototype.update = function (dt) {
    if (this.done) return;
    this.t += dt;
    this.toastT = Math.max(0, this.toastT - dt);
    var p = this.p;

    this.gustIn -= dt;
    if (this.gustIn <= 0) {
      this.gust = (this.rnd() > 0.35 ? 1 : -1) * (60 + this.rnd() * 90);
      this.gustIn = 3.5 + this.rnd() * 3.5;
    }
    this.gust = EF.damp(this.gust, 0, 0.7, dt);
    this.wind = Math.sin(this.t * 0.4) * 40 + this.gust;

    if (p.mode === 'swing') {
      var a = p.anchor;
      /* pendulum: gravity restores toward ang=0, wind pushes sideways */
      var acc = -(GRAV / p.len) * Math.sin(p.ang) + (this.wind / p.len) * Math.cos(p.ang);
      p.angVel += acc * dt;
      p.angVel *= Math.exp(-0.22 * dt);        // rope + air, very light
      p.ang += p.angVel * dt;
      p.x = a.x + Math.sin(p.ang) * p.len;
      p.y = a.y + Math.cos(p.ang) * p.len;
      var tx = Math.cos(p.ang), ty = -Math.sin(p.ang);
      var v = p.angVel * p.len;
      p.vx = v * tx; p.vy = v * ty;
      /* Auto-release at the ground so the rope can never grind you along it. */
      if (p.y > GROUND_Y - 16) this._release();
    } else {
      p.vy += GRAV * dt;
      p.vx += this.wind * 0.35 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.y >= GROUND_Y - 26) {
        if (p.vy > 260) {
          this.falls++;
          for (var d = 0; d < 14; d++) {
            this.particles.spawn(p.x, GROUND_Y - 6, (this.rnd() - 0.5) * 200, -40 - this.rnd() * 110,
              0.55, 5, P.rgb('leafOchre'), { gravity: 400, drag: 1.2, leaf: true, spin: 8 });
          }
          if (EF.Audio) EF.Audio.thud();
        }
        p.y = GROUND_Y - 26;
        p.vy = 0;
        p.vx *= Math.exp(-2.6 * dt);
        p.groundT += dt;
        /* Gentle nudge forward so standing still still drifts toward the goal
           - the mode is a walk in the woods, not a puzzle box. */
        if (p.groundT > 0.35) p.vx = EF.damp(p.vx, 60, 0.5, dt);
      } else {
        p.groundT = 0;
      }
    }

    if (p.x < 20) { p.x = 20; p.vx = Math.abs(p.vx); }
    if (p.x > WORLD_W - 20) { p.x = WORLD_W - 20; p.vx = -Math.abs(p.vx) * 0.4; }
    if (p.vx !== 0) p.face = p.vx > 0 ? 1 : -1;
    this.best = Math.max(this.best, p.x);

    /* golden leaves */
    for (var i = 0; i < this.leaves.length; i++) {
      var L = this.leaves[i];
      if (L.got) continue;
      if (EF.hypot(L.x - p.x, L.y - p.y) < 30) {
        L.got = true;
        this.apples++;
        if (EF.Audio) EF.Audio.chime(i % 5);
        for (var q = 0; q < 12; q++) {
          this.particles.spawn(L.x, L.y, (this.rnd() - 0.5) * 170, (this.rnd() - 0.5) * 170,
            0.6, 4, P.rgb('candleGold'), { drag: 1.3, glow: true });
        }
      }
    }

    var Lc = layout();
    this.camX = EF.clamp(EF.damp(this.camX, p.x - Lc.lead, 0.09, dt), 0, Lc.camMax);
    this.drift.update(dt, this.wind);
    this.particles.update(dt, this.wind * 0.3);

    if (!this.reached && p.x >= GOAL_X) {
      this.reached = true;
      this.apples += 6;
      this.toast = 'the high orchard!  +6 apples';
      this.toastT = 3;
      if (EF.Audio) EF.Audio.win();
    }
    if (this.reached) {
      this.reachT += dt;
      if (this.reachT > 2.4) this._finish();
    }
  };

  Swing.prototype._finish = function () {
    this.done = true;
    this.result = { apples: this.apples, hooks: this.hooks, falls: this.falls,
                    reached: this.reached, time: +this.t.toFixed(1) };
  };

  /* ----------------------------------------------------------- drawing */

  /* One wrapping parallax band of trees. `par` is how much of the camera it
     takes: 0 is painted on the sky, 1 moves with the grove. Each tree is
     drawn at its wrapped x and again one span either side, so a tree leaving
     the screen on the left is already entering on the right and there is
     never a seam. Deterministic jitter off the seed, so the backdrop is the
     same backdrop in every frame and every screenshot. */
  function drawBand(ctx, band, cam) {
    var step = band.span / band.n;
    var off = (cam * band.par) % band.span;
    var rnd = EF.rng(band.seed);
    for (var i = 0; i < band.n; i++) {
      var jitterX = (rnd() - 0.5) * step * 0.5;
      var jitterY = (rnd() - 0.5) * 26;
      var jitterS = 0.82 + rnd() * 0.42;
      var base = i * step + jitterX - off;
      for (var k = -1; k <= 1; k++) {
        var x = base + k * band.span;
        if (x < -170 || x > VIEW_W + 170) continue;
        Wd.tree(ctx, x, band.y + jitterY, band.s * jitterS, band.seed + i * 13);
      }
    }
  }

  Swing.prototype.render = function (ctx) {
    var t = this.t, cam = this.camX;
    var L = layout();

    Wd.sky(ctx, VIEW_W, VIEW_H, t);

    /* Parallax ridges. Drawn with the same ridge generator as the valley so
       this reads as the SAME range of hills seen from further in. */
    ctx.save();
    ctx.translate(-cam * 0.12, 0);
    Wd.hills(ctx, VIEW_W * 1.3, VIEW_H, L.hillY);
    ctx.restore();

    /* In portrait the floor and the far treeline are BACKDROP: drawn in
       screen space, before the world layer, so the zoomed grove stands on
       them. The flat layouts keep drawing the ground mid-scene exactly where
       they always did (further down). */
    if (L.tall) {
      Wd.ground(ctx, VIEW_W, VIEW_H, L.gFill);
      Wd.litter(ctx, VIEW_W, L.gFill + 4, L.bottom - L.gFill - 4, 313, 420);
      for (var q = 0; q < L.far.length; q++) {
        Wd.tree(ctx, L.far[q].x, L.far[q].y, L.far[q].s, L.far[q].seed);
      }
      for (var bi = 0; bi < L.bands.length; bi++) drawBand(ctx, L.bands[bi], cam);
    }

    ctx.save();
    if (L.tall) {
      /* world (x,y) -> screen ((x-cam)*S, GY + (y-GROUND_Y)*S) */
      ctx.translate(0, L.GY);
      ctx.scale(L.S, L.S);
      ctx.translate(-cam, -GROUND_Y);
    } else {
      ctx.translate(-cam, 0);
    }

    /* far, faint tree line for depth */
    ctx.globalAlpha = 0.4;
    for (var f = 0; f < this.trees.length; f += 2) {
      var ft = this.trees[f];
      Wd.tree(ctx, ft.x * 0.94 + 40, GROUND_Y - 34, ft.scale * 0.62, ft.seed + 7);
    }
    ctx.globalAlpha = 1;

    /* the grove */
    for (var i = 0; i < this.trees.length; i++) {
      var tr = this.trees[i];
      /* L.treeS is 1 in the flat layouts, so this is the authored grove
         there. It is cosmetic in every layout - the anchors the physics
         uses are their own list and do not move with it. */
      Wd.tree(ctx, tr.x, GROUND_Y + 6, tr.scale * L.treeS, tr.seed);
    }

    /* vines hanging from each anchor */
    for (i = 0; i < this.anchors.length; i++) {
      var a = this.anchors[i];
      if (a.x < cam - 80 || a.x > cam + VIEW_W + 80) continue;
      var sway = Math.sin(t * 1.3 + a.x * 0.01) * 10 + this.wind * 0.05;
      ctx.strokeStyle = P.rgba('mossDeep', 0.72);
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(a.x + sway * 0.5, a.y + 46, a.x + sway, a.y + 92);
      ctx.stroke();
      /* the ring you aim at */
      var inReach = EF.hypot(a.x - this.p.x, a.y - this.p.y) < REACH && a.y < this.p.y - 18;
      ctx.strokeStyle = P.rgba(inReach ? 'candleGold' : 'leafMoss', inReach ? 0.85 : 0.4);
      ctx.lineWidth = inReach ? 3 : 2;
      ctx.beginPath();
      ctx.arc(a.x, a.y, inReach ? 10 + Math.sin(t * 7) * 1.6 : 7, 0, TAU);
      ctx.stroke();
    }

    /* golden leaves */
    for (i = 0; i < this.leaves.length; i++) {
      var L = this.leaves[i];
      if (L.got) continue;
      var by = L.y + Math.sin(t * 2 + L.ph) * 7;
      ctx.save();
      ctx.translate(L.x, by);
      ctx.rotate(Math.sin(t * 1.5 + L.ph) * 0.5);
      ctx.fillStyle = P.get('candleGold');
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 4.6, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    if (!L.tall) {
      Wd.ground(ctx, WORLD_W, VIEW_H, GROUND_Y);
      Wd.litter(ctx, WORLD_W, GROUND_Y + 4, VIEW_H - GROUND_Y - 4, 313, 420);
    }

    /* the high orchard platform at the end */
    this._goal(ctx);

    /* the rope */
    var p = this.p;
    if (p.mode === 'swing') {
      ctx.strokeStyle = P.get('mossDeep');
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(p.anchor.x, p.anchor.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = P.get('leafMoss');
      ctx.beginPath(); ctx.arc(p.anchor.x, p.anchor.y, 5, 0, TAU); ctx.fill();
    }

    this.particles.draw(ctx);
    this._keeper(ctx);
    ctx.restore();

    this.drift.draw(ctx, 0.5);
    P.grain(ctx, VIEW_W, VIEW_H);
    P.vignette(ctx, VIEW_W, VIEW_H, 0.3);

    this._hud(ctx);
    if (this.toastT > 0) {
      var al = EF.clamp(this.toastT, 0, 1);
      EF.text(ctx, this.toast, 360, 470, 18,
        { color: P.rgba('cream', al), halo: P.rgba('vignette', 0.55 * al) });
    }
  };

  Swing.prototype._goal = function (ctx) {
    var x = GOAL_X, y = GROUND_Y - 150;
    ctx.fillStyle = P.get('bark');
    EF.roundRect(ctx, x - 70, y, 190, 16, 6); ctx.fill();
    ctx.fillStyle = P.rgba('barkDark', 0.6);
    ctx.fillRect(x - 60, y + 16, 12, GROUND_Y - y - 16);
    ctx.fillRect(x + 96, y + 16, 12, GROUND_Y - y - 16);
    Wd.tree(ctx, x + 40, y, 0.8, 8787, { fruit: true });
    EF.text(ctx, 'the high orchard', x + 30, y - 96, 16,
      { color: P.rgba('cream', 0.9), halo: P.rgba('vignette', 0.5) });
  };

  /* The keeper. Drawn by EF.World so the valley, the orchard and this grove
     paint the SAME silhouette - only the lean and the rope arm differ here. */
  Swing.prototype._keeper = function (ctx) {
    var p = this.p;
    var lean = EF.clamp(p.vx / 520, -0.5, 0.5);
    Wd.keeper(ctx, p.x, p.y, {
      face: p.face,
      rot: p.mode === 'swing' ? -p.ang * 0.45 : lean * 0.4,
      swinging: p.mode === 'swing',
      time: this.t,
      lit: 0.85
    });
  };

  Swing.prototype._hud = function (ctx) {
    var hud = EF.hudRect(), k = EF.hudScale();
    ctx.save();
    ctx.translate(hud.x, hud.y);
    if (k !== 1) ctx.scale(k, k);
    var x = 14, y = 12, w = 260, h = 66;
    EF.card(ctx, x, y, w, h, 0.88);
    EF.text(ctx, 'TO THE HIGH ORCHARD', x + 12, y + 17, 13,
      { align: 'left', weight: '700', color: P.get('candleGold'), halo: false });
    var bx = x + 12, by = y + 30, bw = w - 24, bh = 9;
    EF.roundRect(ctx, bx, by, bw, bh, 4.5);
    ctx.fillStyle = P.rgba('panel', 0.5); ctx.fill();
    var u = EF.clamp((this.best - 90) / (GOAL_X - 90), 0, 1);
    EF.roundRect(ctx, bx, by, Math.max(4, bw * u), bh, 4.5);
    ctx.fillStyle = P.rgba('candleGold', 0.92); ctx.fill();
    EF.text(ctx, Math.round(u * 100) + '%   -   ' + this.apples + ' apples   -   ' + this.hooks + ' vines',
      bx, y + 54, 13, { align: 'left', weight: '600', color: P.rgba('cream', 0.88), halo: false });
    ctx.restore();
  };

  Swing.prototype.snapshot = function () {
    return {
      mode: 'swing', t: +this.t.toFixed(2), x: Math.round(this.p.x), y: Math.round(this.p.y),
      swinging: this.p.mode === 'swing', hooks: this.hooks, apples: this.apples,
      falls: this.falls, progress: +EF.clamp((this.best - 90) / (GOAL_X - 90), 0, 1).toFixed(3),
      reached: this.reached, done: this.done
    };
  };

  /* Test/debug: teleport to the goal through the real arrival path. */
  Swing.prototype.skipToGoal = function () {
    this.p.mode = 'free';
    this.p.anchor = null;
    this.p.x = GOAL_X + 4;
    this.p.y = GROUND_Y - 160;
    this.p.vx = 60; this.p.vy = 0;
    this.best = Math.max(this.best, this.p.x);
  };

  Swing.GOAL_X = GOAL_X;
  Swing.WORLD_W = WORLD_W;
  /* Exposed for the flat-constants gate in test/framing.mjs. Six changes to
     the signed-off desktop and landscape builds shipped inside a "not a
     pixel" claim because nothing asserted the flat branch; this is what
     makes that assertable. */
  Swing.layout = layout;
  EF.Swing = Swing;

}(window));
