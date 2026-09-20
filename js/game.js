/* EMBERFALL - the day.
 *
 * This is the file that makes Emberfall a GAME rather than three demos. It
 * owns the valley (the hub everything happens in), the day's state machine,
 * the shared tally that carries between activities, and dusk - the moment the
 * whole loop exists for.
 *
 * The loop, in one line:   gather -> craft -> light lanterns -> day 30 festival.
 * This build is ONE day of the thirty. The HUD says "day 1 of 30" because that
 * is true, not as set dressing: the day counter, the tally and the candle
 * economy are already the real ones, there is simply no day 2 yet.
 *
 * Why the activities live here and not in a menu: harvest, raking and the vine
 * grove are PLACES. You walk up to a signpost in the valley and go there, and
 * when you come back the valley remembers what you brought. A menu would have
 * been less code and a different game.
 *
 * Economy, in full, because it is small and it is the point:
 *   raking banks leaves     -> wax (1 per 14 leaves) + kindling
 *   lighting the lantern    -> costs 2 wax
 *   lighting a path candle  -> costs 1 wax
 *   every lit flame         -> warms the palette back toward day (see `warm`)
 * A full pile (78 leaves) is 5 wax: the lantern plus three candles. Wanting a
 * fourth candle is the reason to rake well tomorrow.
 */
(function (global) {
  'use strict';

  var EF = global.EF;
  var P = EF.Palette;
  var Wd = EF.World;
  var TAU = EF.TAU;

  var W = 720, H = 540;
  var HORIZON = 330;
  var GROUND_Y = 352;

  var DAYS = 30;
  var LANTERN_COST = 2;
  var CANDLE_COST = 1;

  /* Candle stations, sampled along the curve W.path draws, with a scale that
     falls off with depth. Hand-placed rather than computed at runtime so the
     valley is the same valley in every screenshot and every test. */
  var CANDLE_SPOTS = [
    { x: 108, y: 476, s: 1.05 },
    { x: 228, y: 418, s: 0.82 },
    { x: 321, y: 384, s: 0.68 },
    { x: 457, y: 358, s: 0.55 },
    { x: 545, y: 350, s: 0.50 },
    { x: 640, y: 347, s: 0.48 }
  ];

  var LANTERN = { x: 452, y: 412, s: 1.1 };
  var KEEPER = { x: 386, y: 452 };

  /* The signposts. `id` doubles as the state they travel to. */
  var SPOTS = [
    { id: 'harvest', x: 118, y: 404, w: 136, h: 40, label: 'THE ORCHARD', sub: 'fruit is falling' },
    { id: 'rake', x: 300, y: 456, w: 136, h: 40, label: 'THE YARD', sub: 'leaves - wax' },
    { id: 'swing', x: 598, y: 414, w: 146, h: 40, label: 'THE HIGH GROVE', sub: 'vines - apples' },
    { id: 'stash', x: 626, y: 498, w: 144, h: 34, label: 'SQUIRREL STASH', sub: '', locked: true }
  ];

  /* ------------------------------------------------------ the valley layout
   *
   * Everything in the valley that HAS a position is decided here, and
   * everything that READS a position - the draw, the signpost hit test, the
   * dusk candle hit test - reads it from here. Two hand-kept copies of "where
   * the ORCHARD sign is" is exactly how a sign ends up drawn in one place and
   * tappable in another, and on a phone that bug is invisible until someone
   * taps and nothing happens.
   *
   * On desktop and in landscape this returns the authored constants
   * UNCHANGED - the same numbers that were signed off, in the same 720x540
   * box. flatValley() is a transcription, not a calculation, and there is no
   * portrait maths anywhere near those two layouts.
   *
   * In portrait it composes the same valley for a tall screen instead. This
   * is the fix for the complaint that SURVIVED the canvas-coverage fix, and
   * the two are worth telling apart because they look identical from the
   * sofa. Coverage fixed "the canvas is a small box in a big dead page". It
   * did not fix "the canvas is the whole phone but the valley is still laid
   * out inside a 720x540 strip pinned to the bottom of it" - which rendered
   * as two thirds empty sky with the game in a band underneath, measured at
   * 66.7% sky / 24.5% scene by test/framing.mjs. Same complaint, second
   * shape: the playfield squeezed into a tiny box.
   *
   * So portrait does not squeeze the authored composition - it re-composes.
   * The horizon goes near the top, the valley runs the full DEPTH of the
   * screen toward the player, and the path, the signposts, the candles and
   * the keeper are placed along that depth with a perspective scale rather
   * than lined up across a strip. A tall screen is depth; using it as depth
   * is the whole idea.
   */

  /* The horizon share and the depth easing live on EF.portraitFrame() in
     js/utils.js - the orchard, the yard and the grove need the same three
     numbers and a private copy per scene is how 0.30 here becomes 0.34
     there. */

  var _vl = null, _vlKey = '';

  function valleyLayout() {
    var b = EF.bleed;
    var key = (EF.portrait ? 'p' : 'l') + b.x + '_' + b.top + '_' + b.bottom + '_' + EF.cssPerUnit;
    if (_vlKey !== key) { _vlKey = key; _vl = EF.portrait ? portraitValley(b) : flatValley(); }
    return _vl;
  }

  function flatValley() {
    return {
      tall: false,
      hz: HORIZON, gy: GROUND_Y,
      houses: [[88, GROUND_Y + 6, 0.92], [208, GROUND_Y + 2, 0.74], [626, GROUND_Y + 6, 0.86]],
      trees: [
        [28, GROUND_Y + 10, 0.95, 11, null],
        [152, GROUND_Y + 8, 0.70, 22, null],
        [300, GROUND_Y + 6, 0.62, 33, null],
        [470, GROUND_Y + 8, 0.66, 44, { fruit: true }],
        [692, GROUND_Y + 12, 1.00, 55, null]
      ],
      path: null,
      nearTrees: null,
      litter: { y: GROUND_Y + 6, h: H - GROUND_Y - 6, n: 170 },
      spots: SPOTS.map(function (s) {
        return {
          id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, s: 1,
          label: s.label, sub: s.sub, locked: s.locked
        };
      }),
      candles: CANDLE_SPOTS.map(function (c) { return { x: c.x, y: c.y, s: c.s }; }),
      lantern: { x: LANTERN.x, y: LANTERN.y, s: LANTERN.s },
      keeper: { x: KEEPER.x, y: KEEPER.y, s: 1 }
    };
  }

  function portraitValley(b) {
    var F = EF.portraitFrame();
    var top = F.top;                  // logical y of the top of the canvas
    var bot = F.bottom;               // logical y of the bottom of the canvas
    var hz = F.hz;
    /* The composition stops at H: below that is the strip the on-canvas pad
       owns. The GROUND still runs to the true canvas floor behind the pad -
       a pad sitting on painted world reads as part of the place, and a pad
       sitting on a hard edge reads as chrome bolted over a picture, which is
       the review this game already failed once. */
    var gd = F.gd;
    var dy = F.dy, ps = F.ps;

    /* Depths of the four signposts. Spread so that no two overlap even at
       the near end where they are biggest: each occupies about 80*ps(d)
       logical units of height, and the gaps here exceed that. */
    var SD = [0.20, 0.44, 0.68, 0.92];
    var SX = [215, 495, 205, 505];

    var spots = SPOTS.map(function (s, i) {
      return {
        id: s.id, x: SX[i], y: dy(SD[i]), w: s.w, h: s.h, s: ps(SD[i]),
        label: s.label, sub: s.sub, locked: s.locked
      };
    });

    /* The village and the far woods sit ON the horizon, small, because they
       are far away. Resisting the urge to scale these up is what keeps the
       screen reading as depth instead of as a bigger flat strip. */
    var houses = [
      [96, hz + gd * 0.030, 0.80],
      [232, hz + gd * 0.016, 0.62],
      [604, hz + gd * 0.026, 0.74]
    ];

    /* Back to front. Three bands, and the middle one is the one the first
       portrait pass forgot: with only a far treeline and a foreground pair,
       the whole middle of a 1558-unit-tall canvas was bare brown ground and
       the valley read as empty even though the horizon was in the right
       place. Depth needs something AT every depth.

       x is confined to [0,720] on purpose. In portrait EF.bleed.x is 0 - the
       canvas is exactly 720 units wide - so the previous pass's framing trees
       at x=-26 and x=742 rendered entirely off-screen and the foreground they
       were supposed to provide never existed. Anything meant to be SEEN is
       placed inside the box; only canopies may hang past the edge. */
    /* The far treeline only. These stand ON the horizon, so the ground -
       painted next - covers nothing of them that should be seen. */
    var trees = [
      [36, hz + gd * 0.034, 0.78, 11, null],
      [168, hz + gd * 0.022, 0.58, 22, null],
      [330, hz + gd * 0.014, 0.50, 33, null],
      [486, hz + gd * 0.026, 0.56, 44, { fruit: true }],
      [676, hz + gd * 0.040, 0.86, 55, null]
    ];

    /* Everything rooted BELOW the horizon, drawn after the ground.
       Draw order is the whole reason this is a second list. _valley paints
       sky, hills, trees, THEN ground - which is correct for a treeline on
       the skyline and fatal for anything standing in the field: the first
       version of this composition put four mid-ground trees and two big
       foreground trees in the list above, and the ground slab painted over
       all six of them. The valley rendered as bare brown and the trees were
       not missing, they were buried. */
    var near = [
      /* middle distance, hugging the two edges so the path and the
         signposts keep the centre of the screen */
      [702, dy(0.24), 1.25, 101, { fruit: true }],
      [18, dy(0.36), 1.45, 102, null],
      [712, dy(0.62), 1.85, 103, null],
      [12, dy(0.78), 2.10, 104, null],
      /* the foreground pair: trunks at the very bottom of the world,
         canopies reaching up the sides. These are most of the autumn colour
         a phone actually sees, and they give the valley a front. */
      [96, 600, 2.45, 77, null],
      [648, 646, 2.70, 88, { fruit: true }]
    ];

    /* The track climbs from the player's feet to the horizon, wandering past
       the signposts. Tapered hard - a constant-width ribbon running this far
       up a portrait screen reads as a wall, not as a path. */
    var path = {
      pts: [
        [366, bot + 60],
        [332, dy(0.86)],
        [430, dy(0.60)],
        [316, dy(0.34)],
        [378, dy(0.13)],
        [358, hz + 3]
      ],
      w0: 300, w1: 20
    };

    /* Candles stand ON the track, so they are sampled FROM it rather than
       hand-placed beside it - see W.samplePath. A candle floating a few
       units off the path it is supposed to line is exactly the kind of small
       wrong that makes a scene look assembled rather than drawn. */
    var curve = EF.World.samplePath(path.pts, 64);
    var CD = [0.90, 0.74, 0.56, 0.40, 0.26, 0.14];
    var candles = CD.map(function (d) {
      var p = onCurve(curve, 1 - d);
      return { x: p[0] + 96 * d * 0.55, y: p[1], s: ps(d) * 0.62 };
    });

    var kd = 0.62, kp = onCurve(curve, 1 - kd);
    var ld = 0.50, lp = onCurve(curve, 1 - ld);

    return {
      tall: true,
      hz: hz, gy: hz,
      houses: houses, trees: trees, nearTrees: near, path: path,
      litter: { y: hz + 8, h: bot - hz - 8, n: 170 },
      spots: spots, candles: candles,
      lantern: { x: lp[0] - 104 * ld, y: lp[1], s: ps(ld) * 0.92 },
      keeper: { x: kp[0] + 86 * kd, y: kp[1], s: ps(kd) * 0.80 }
    };
  }

  /* Point at fraction u along a sampled curve. The curve runs near-end-first,
     so callers pass 1-d to turn a DEPTH into a position on it. */
  function onCurve(pts, u) {
    var i = EF.clamp(Math.round(u * (pts.length - 1)), 0, pts.length - 1);
    return pts[i];
  }

  /* ------------------------------------------------------------ the HUD box
   *
   * The scene is composed in the 720x540 box; the HUD is not. The day card,
   * the hint line, the toast and the mute button are CHROME - they belong to
   * the edges of the screen, and on a phone the edges of the screen are not
   * the edges of the scene box. In portrait that box starts 818 units above
   * the top of the canvas, so a day card at y=12 and a hint at y=126 render
   * halfway down the sky, printed across the signposts. That is what the
   * first portrait pass shipped and it is the most obviously broken thing in
   * the screenshot.
   *
   * The bottom stops at the pad rather than at the canvas floor, so no HUD
   * line is ever drawn underneath a thumb button.
   *
   * On desktop and in landscape this is EXACTLY (0,0,720,540) - the authored
   * box - so neither layout moves by a pixel. */
  function hudRect() { return EF.hudRect(); }

  function Game(seed) {
    this.seed = (seed === null || seed === undefined) ? 20260919 : seed;
    this.rnd = EF.rng(this.seed);

    this.state = 'title';
    this.t = 0;
    this.day = 1;
    this.days = DAYS;

    this.night = 0;
    this.nightTarget = 0;
    this.warm = 0;

    this.mode = null;
    this.trans = null;

    this.tally = this._freshTally();
    this.doneModes = { harvest: false, rake: false, swing: false };

    this.lantern = { lit: 0, target: 0 };
    this.candles = CANDLE_SPOTS.map(function (c) {
      return { x: c.x, y: c.y, s: c.s, lit: 0, target: 0 };
    });

    this.duskPhase = 'falling';
    this.duskT = 0;
    this.doneT = 0;

    this.hover = null;
    this.toast = '';
    this.toastT = 0;

    this.muted = EF.Store.get('ef_muted', '0') === '1';
    this.paused = false;

    this.drift = new Wd.Drift(26, W, H, 2026);
    this.particles = new EF.Particles(220);

    this.bestLanterns = EF.Store.getNum('ef_best_lanterns', 0);
  }

  Game.W = W;
  Game.H = H;
  Game.DAYS = DAYS;
  Game.LANTERN_COST = LANTERN_COST;
  Game.CANDLE_COST = CANDLE_COST;

  Game.prototype._freshTally = function () {
    return {
      fruit: 0, score: 0, pies: 0, recipe: '',
      wax: 0, kindling: 0, piled: 0,
      apples: 0, hooks: 0, falls: 0, reached: false,
      candles: 0, lantern: false, waxSpent: 0
    };
  };

  /* ------------------------------------------------------- transitions */

  /* "The screen is mid-dip and the player cannot see what they are doing."
     True only while fading OUT; see go() below. */
  Game.prototype.busy = function () {
    return !!(this.trans && !this.trans.switched);
  };

  /* Every state change goes through a dip to warm dark and back. It is 0.8s
     of nothing, and it is what stops "you are in the orchard now" from being
     a jump cut - the one thing that would make three activities feel like
     three programs again. */
  Game.prototype.go = function (state) {
    /* Only the fade-OUT half is uninterruptible. Once the switch has happened
       we are fading back IN and the player is looking at the new scene, so a
       click on it must work - dropping input for 0.4s after arriving somewhere
       is the kind of small dishonesty that makes a UI feel broken. The new dip
       starts at the darkness this one had reached, so there is no pop. */
    if (this.trans && !this.trans.switched) return false;
    var t = 0;
    if (this.trans) t = 1 - EF.clamp(2 - this.trans.t, 0, 1);
    this.trans = { to: state, t: t, switched: false };
    return true;
  };

  Game.prototype._enter = function (state) {
    var seed = this.seed + this.day * 101;
    if (state === 'harvest') { this.mode = new EF.Harvest(this, seed + 1); }
    else if (state === 'rake') { this.mode = new EF.Rake(this, seed + 2); }
    else if (state === 'swing') { this.mode = new EF.Swing(this, seed + 3); }
    else { this.mode = null; }

    if (state === 'dusk') {
      this.nightTarget = 1;
      this.duskPhase = 'falling';
      this.duskT = 0;
      this.toast = 'the sun is going down over the valley';
      this.toastT = 3.4;
    } else if (state === 'title') {
      this._resetDay();
    } else if (state !== 'summary') {
      this.nightTarget = 0;
    }

    this.state = state;
  };

  Game.prototype._resetDay = function () {
    this.day = 1;
    this.night = 0;
    this.nightTarget = 0;
    this.warm = 0;
    this.tally = this._freshTally();
    this.doneModes = { harvest: false, rake: false, swing: false };
    this.lantern.lit = this.lantern.target = 0;
    for (var i = 0; i < this.candles.length; i++) {
      this.candles[i].lit = 0;
      this.candles[i].target = 0;
    }
    this.duskPhase = 'falling';
    this.particles.clear();
  };

  /* Dusk is offered once the two activities the loop actually needs are done.
     The grove is optional on purpose: apples are a bonus, wax is the spine. */
  Game.prototype.duskReady = function () {
    return this.doneModes.harvest && this.doneModes.rake;
  };

  /* --------------------------------------------------------- collecting */

  Game.prototype._collect = function () {
    var r = this.mode.result || {};
    var T = this.tally;
    if (this.state === 'harvest') {
      T.fruit += r.fruit || 0;
      T.score += r.score || 0;
      T.pies += r.pies || 0;
      T.recipe = r.recipe || T.recipe;
      this.doneModes.harvest = true;
      this.toast = 'back to the valley with ' + (r.fruit || 0) + ' fruit';
    } else if (this.state === 'rake') {
      T.wax += r.wax || 0;
      T.kindling += r.kindling || 0;
      T.piled += r.piled || 0;
      this.doneModes.rake = true;
      this.toast = (r.wax || 0) + ' wax rendered from the pile';
    } else if (this.state === 'swing') {
      T.apples += r.apples || 0;
      T.hooks += r.hooks || 0;
      T.falls += r.falls || 0;
      T.reached = T.reached || !!r.reached;
      this.doneModes.swing = true;
      this.toast = 'home from the high grove with ' + (r.apples || 0) + ' apples';
    }
    this.toastT = 3.6;
    this.go('valley');
  };

  /* Leave an activity early. Runs the mode's REAL finish path, so whatever you
     managed still counts - abandoning the orchard at ten seconds should give
     you ten seconds of apples, not a zero. */
  Game.prototype.leaveMode = function () {
    if (!this.mode || this.mode.done || this.busy()) return false;
    this.mode._finish();
    return true;
  };

  /* What "back" means, in one place, for every state that has a way out.
   *
   * This exists because leaveMode() used to be reachable only from the ESC
   * key. A phone has no ESC key, so the orchard, the yard and the grove were
   * one-way doors on the platform most people would open the game on: you
   * played the activity to its end or you reloaded the page. ESC and the
   * touch pad's BACK button now both call this, so there is exactly one
   * definition of leaving and the two inputs cannot drift apart.
   *
   * The stash is the odd one out: it is a read-only board with no mode
   * object, so leaveMode() has nothing to finish and the way out is simply
   * the valley. */
  Game.prototype.back = function () {
    if (this.busy()) return false;
    if (this.state === 'stash') return this.go('valley');
    return this.leaveMode();
  };

  /* Whether back() would do anything - drives the BACK button's disabled
     state, so the pad never offers a press that silently does nothing. */
  Game.prototype.canBack = function () {
    if (this.busy()) return false;
    if (this.state === 'stash') return true;
    return !!(this.mode && !this.mode.done &&
      (this.state === 'harvest' || this.state === 'rake' || this.state === 'swing'));
  };

  /* -------------------------------------------------------------- dusk */

  Game.prototype._lightLantern = function () {
    var T = this.tally;
    if (T.wax < LANTERN_COST) {
      this.toast = 'not enough wax for the lantern - rake a fuller pile tomorrow';
      this.toastT = 4;
      this.duskPhase = 'done';
      this.doneT = 0;
      return false;
    }
    T.wax -= LANTERN_COST;
    T.waxSpent += LANTERN_COST;
    T.lantern = true;
    this.lantern.target = 1;
    this.duskPhase = 'candles';
    this.toast = 'the lantern is lit  -  now the path';
    this.toastT = 3.4;
    if (EF.Audio) EF.Audio.light();
    var gold = P.rgb('candleGold');
    var ln = this._layout().lantern, ls = ln.s || 1;
    for (var i = 0; i < 46; i++) {
      this.particles.spawn(ln.x, ln.y - 4 * ls, (this.rnd() - 0.5) * 150, -60 - this.rnd() * 150,
        1.0 + this.rnd() * 0.8, 4 * ls, gold, { gravity: -30, drag: 0.7, glow: true });
    }
    return true;
  };

  Game.prototype._lightCandle = function (x, y) {
    var T = this.tally;
    if (T.wax < CANDLE_COST) {
      this.duskPhase = 'done';
      this.doneT = 0;
      this.toast = 'out of wax  -  ' + T.candles + ' candles on the path';
      this.toastT = 3;
      return false;
    }
    /* Nearest unlit station to the tap. Tapping vaguely at the path is the
       gesture; making the player hit a small sprite at dusk is not cozy. */
    var best = null, bestD = 1e9;
    for (var i = 0; i < this.candles.length; i++) {
      var c = this.candles[i];
      if (c.target > 0) continue;
      var d = (x === null || x === undefined) ? i : EF.hypot(c.x - x, c.y - y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best) {
      this.duskPhase = 'done';
      this.doneT = 0;
      this.toast = 'the whole path is glowing';
      this.toastT = 3;
      return false;
    }
    T.wax -= CANDLE_COST;
    T.waxSpent += CANDLE_COST;
    T.candles++;
    best.target = 1;
    if (EF.Audio) EF.Audio.chime(T.candles);
    var gold = P.rgb('candleGold');
    for (var p = 0; p < 16; p++) {
      this.particles.spawn(best.x, best.y - 8 * best.s, (this.rnd() - 0.5) * 80, -40 - this.rnd() * 90,
        0.7 + this.rnd() * 0.5, 3, gold, { gravity: -20, drag: 0.9, glow: true });
    }
    if (T.wax < CANDLE_COST || T.candles >= this.candles.length) {
      this.duskPhase = 'done';
      this.doneT = 0;
      this.toast = T.candles + ' candles lit  -  the valley is glowing';
      this.toastT = 3.4;
      if (EF.Audio) EF.Audio.win();
    }
    return true;
  };

  Game.prototype._duskTap = function (x, y) {
    if (this.duskPhase === 'falling') {
      this.duskT = 3.2;           // let an impatient player skip the sundown
      return;
    }
    if (this.duskPhase === 'lantern') { this._lightLantern(); return; }
    if (this.duskPhase === 'candles') { this._lightCandle(x, y); return; }
    if (this.duskPhase === 'done') { this._endDay(); }
  };

  Game.prototype._endDay = function () {
    if (this.state === 'summary' || this.busy()) return;
    var flames = this.tally.candles + (this.tally.lantern ? 1 : 0);
    if (flames > this.bestLanterns) {
      this.bestLanterns = flames;
      EF.Store.set('ef_best_lanterns', flames);
    }
    this.go('summary');
  };

  /* ------------------------------------------------------------- input */

  /* The layout, plus the one piece of valley state that has to follow it.
     The candles carry a lit/target animation that must survive an
     orientation flip, so they are CONSTRUCTED once and their POSITIONS are
     re-read from the layout whenever the layout changes. Baking the
     positions in at construction - which is what the first portrait pass
     did - left every candle, at dusk, sitting where the 720x540 valley used
     to put it while the path it is supposed to line had moved. */
  Game.prototype._layout = function () {
    var L = valleyLayout();
    if (this._lkey !== _vlKey) {
      this._lkey = _vlKey;
      for (var i = 0; i < this.candles.length && i < L.candles.length; i++) {
        this.candles[i].x = L.candles[i].x;
        this.candles[i].y = L.candles[i].y;
        this.candles[i].s = L.candles[i].s;
      }
    }
    return L;
  };

  /* Hit-testing reads the SAME layout the draw does, scale included.
     W.sign puts its origin at the foot of the post and draws the plank in
     local coordinates from (-w/2,-h) to (w/2,0) before scaling by s, so a
     box built from the unscaled w/h - the bug this replaces - was a
     136-unit target under a sign drawn 375 units wide: tappable nowhere
     near where it looked. */
  Game.prototype._hit = function (x, y) {
    var L = this._layout();
    /* NEAREST FIRST - the reverse of the draw order, which paints back to
       front. In portrait the near signs are two and a half times the size of
       the far ones and they can overlap; testing front to back would hand a
       tap to the sign UNDERNEATH the one the player is looking at. */
    for (var i = L.spots.length - 1; i >= 0; i--) {
      var s = L.spots[i], sc = s.s || 1;
      if (x >= s.x - s.w * 0.5 * sc && x <= s.x + s.w * 0.5 * sc &&
          y >= s.y - (s.h + 6) * sc && y <= s.y + 34 * sc) return s;
    }
    var ln = L.lantern, ls = ln.s || 1;
    if (this.duskReady() &&
        x >= ln.x - 30 * ls && x <= ln.x + 30 * ls &&
        y >= ln.y - 34 * ls && y <= ln.y + 60 * ls) {
      return { id: 'dusk', x: ln.x, y: ln.y };
    }
    return null;
  };

  /* The mute control is the one thing that must work in every state. */
  /* Drawn by _mute from the same two numbers, for the same reason the
     signposts are: a control drawn in the screen's corner and hit-tested in
     the scene box's corner is a mute button that does nothing on a phone. */
  function muteAt() {
    var hud = hudRect();
    /* The glyph is authored at radius 15. On desktop s is exactly 1 and this
       returns the original (692, 24). On a phone 15 units is 8 CSS px, which
       is neither readable nor hittable, so it is sized off EF.px like every
       other touch target. */
    var s = EF.portrait ? Math.max(1, EF.px(17) / 15) : 1;
    return { x: hud.right - 28 * s, y: hud.y + 24 * s, s: s };
  }
  function inMute(x, y) {
    var m = muteAt();
    return EF.hypot(x - m.x, y - m.y) < Math.max(20, EF.px(22));
  }

  Game.prototype.pointerDown = function (x, y) {
    if (inMute(x, y)) { this.toggleMute(); return; }
    if (this.busy()) return;

    switch (this.state) {
      case 'title':
        this.go('valley');
        break;
      case 'valley':
        var s = this._hit(x, y);
        if (!s) break;
        if (s.locked) { this.go('stash'); break; }
        this.go(s.id);
        break;
      case 'harvest':
      case 'rake':
      case 'swing':
        /* The activity is frozen behind the dip (see update). Forwarding input
           to a frozen sim would silently eat it - a hook that costs the player
           a vine and does nothing is worse than a tap that never registered. */
        if (this.trans) break;
        this.mode.pointer(x, y, true);
        break;
      case 'stash':
        this.go('valley');
        break;
      case 'dusk':
        this._duskTap(x, y);
        break;
      case 'summary':
        this.go('title');
        break;
    }
  };

  Game.prototype.pointerMove = function (x, y) {
    if (this.busy()) return;
    if (this.state === 'valley') { this.hover = this._hit(x, y); return; }
    if (this.trans) return;
    if (this.state === 'harvest' || this.state === 'rake') { this.mode.pointer(x, y, false); }
  };

  /* Keyboard equivalent of "tap the thing you would obviously tap next". */
  Game.prototype.action = function () {
    if (this.busy()) return;
    switch (this.state) {
      case 'title':
        this.go('valley');
        break;
      case 'valley':
        if (this.duskReady()) this.go('dusk');
        else if (!this.doneModes.harvest) this.go('harvest');
        else this.go('rake');
        break;
      case 'swing':
        if (this.trans) break;
        this.mode.action();
        break;
      case 'stash':
        this.go('valley');
        break;
      case 'dusk':
        this._duskTap(null, null);
        break;
      case 'summary':
        this.go('title');
        break;
    }
  };

  /* What the touch pad's primary button says, and whether pressing it does
     anything. Both live here, beside action(), because they are statements
     about the game's states rather than about the browser: main.js renders
     them but must never decide them, or the label and the behaviour drift
     apart the first time a state is added.

     The orchard and the yard are deliberately NOT actionable. Their verb is
     "aim", which is a drag across the canvas; a button there would be a lit
     control that does nothing, which is worse than a dimmed one that
     explains itself. */
  Game.prototype.canAction = function () {
    if (this.busy()) return false;
    return this.state !== 'harvest' && this.state !== 'rake';
  };

  Game.prototype.actionLabel = function () {
    switch (this.state) {
      case 'title':   return 'BEGIN';
      case 'valley':  return this.duskReady() ? 'LIGHT LANTERN'
                           : (!this.doneModes.harvest ? 'THE ORCHARD' : 'THE YARD');
      case 'harvest': return 'DRAG TO AIM';
      case 'rake':    return 'DRAG TO RAKE';
      /* p.mode is the keeper's own state ('swing' = on a vine, airborne).
         this.mode.swinging does NOT exist - that name only appears on the
         Swing SNAPSHOT, and reading it here would silently be undefined and
         label every frame 'HOOK A VINE'. */
      case 'swing':   return (this.mode && this.mode.p && this.mode.p.mode === 'swing')
                           ? 'LET GO' : 'HOOK A VINE';
      case 'stash':   return 'CLOSE';
      case 'dusk':    return 'LIGHT A CANDLE';
      case 'summary': return 'NEXT DAY';
    }
    return 'BEGIN';
  };

  /* Number keys pick a signpost without a mouse. */
  Game.prototype.pick = function (n) {
    if (this.busy() || this.state !== 'valley') return;
    var s = SPOTS[n];
    if (!s) return;
    this.go(s.locked ? 'stash' : s.id);
  };

  Game.prototype.setAxis = function (dx, dy) {
    if (!this.mode) return;
    if (this.state === 'harvest') this.mode.setAxis(dx);
    else if (this.state === 'rake') this.mode.setAxis(dx, dy);
  };

  Game.prototype.toggleMute = function () {
    this.muted = !this.muted;
    EF.Store.set('ef_muted', this.muted ? '1' : '0');
    if (EF.Audio) EF.Audio.setMuted(this.muted);
  };

  /* Where the signposts ACTUALLY are, for anything outside the game that
     needs to point at one - the touch tests above all. A test that taps
     hand-copied coordinates is the same "two hand-kept copies of where the
     ORCHARD sign is" bug as a mismatched hit box, and it fails the same
     way: silently, and only in the layout nobody ran. */
  Game.prototype.spots = function () { return this._layout().spots; };

  /* Where the mute control actually is. Same reason as spots(): it moved to
     the screen's corner in portrait and a test aiming at the scene box's
     corner was tapping empty sky. */
  Game.prototype.muteSpot = function () { return muteAt(); };

  Game.prototype.pause = function () { this.paused = true; };
  Game.prototype.resume = function () { this.paused = false; };

  /* ------------------------------------------------------------ update */

  Game.prototype.update = function (raw) {
    /* One clamp, here. A backgrounded tab returning with dt=4.0 would teleport
       fruit through the basket and fling the keeper off the grove. */
    var dt = raw > 0.05 ? 0.05 : (raw > 0 ? raw : 0);
    this.t += dt;
    this.toastT = Math.max(0, this.toastT - dt);

    if (this.trans) {
      this.trans.t += dt * 2.5;
      if (this.trans.t >= 1 && !this.trans.switched) {
        this.trans.switched = true;
        this._enter(this.trans.to);
      }
      if (this.trans.t >= 2) this.trans = null;
    }

    /* Light earned is light kept: every flame pulls the palette a little back
       toward daytime, which is the whole "and the scene warms" beat. */
    var flames = this.lantern.lit * 1.4;
    for (var i = 0; i < this.candles.length; i++) flames += this.candles[i].lit;
    this.warm = EF.clamp(flames / (this.candles.length + 1.4), 0, 1);

    this.night = EF.damp(this.night, this.nightTarget, 0.85, dt);
    P.set(this.night * (1 - this.warm * 0.20));

    this.lantern.lit = EF.damp(this.lantern.lit, this.lantern.target, 0.35, dt);
    for (i = 0; i < this.candles.length; i++) {
      var c = this.candles[i];
      c.lit = EF.damp(c.lit, c.target, 0.28, dt);
    }

    if (this.mode) {
      /* Freeze the activity behind the transition dip - nothing should tick
         while the screen is black and the player cannot see or answer it. */
      if (this.trans) return;
      this.mode.update(dt);
      if (this.mode.done) this._collect();
      return;
    }

    this.drift.update(dt, Math.sin(this.t * 0.5) * 30 + 14);
    this.particles.update(dt, 8);

    if (this.state === 'dusk') {
      this.duskT += dt;
      if (this.duskPhase === 'falling' && this.duskT >= 3.2) {
        this.duskPhase = 'lantern';
        this.toast = '';
        this.toastT = 0;
      }
      if (this.duskPhase === 'done') {
        this.doneT += dt;
        if (this.doneT > 4.5) this._endDay();
      }
    }
  };

  /* ------------------------------------------------------------ render */

  Game.prototype.render = function (ctx) {
    P.set(this.night * (1 - this.warm * 0.20));

    if (this.mode && this.state !== 'stash') {
      this.mode.render(ctx);
      this._modeHud(ctx);
    } else {
      this._valley(ctx);
      if (this.state === 'title') this._title(ctx);
      else if (this.state === 'valley') this._valleyHud(ctx);
      else if (this.state === 'dusk') this._duskHud(ctx);
      else if (this.state === 'summary') this._summary(ctx);
      else if (this.state === 'stash') {
        var rs = EF.fullRect(W, H);
        ctx.fillStyle = P.rgba('vignette', 0.45);
        ctx.fillRect(rs.x, rs.y, rs.w, rs.h);
        EF.Stash.drawLockedCard(ctx, W, H, this.t);
      }
    }

    this._mute(ctx);

    if (this.toastT > 0 && this.state !== 'summary') {
      var a = EF.clamp(this.toastT, 0, 1);
      var ht = hudRect();
      EF.text(ctx, this.toast, ht.cx, ht.bottom - 34, 17,
        { color: P.rgba('cream', a), halo: P.rgba('vignette', 0.55 * a) });
    }

    if (this.trans) {
      var f = this.trans.t < 1 ? this.trans.t : (2 - this.trans.t);
      var rt = EF.fullRect(W, H);
      ctx.fillStyle = P.rgba('vignette', EF.clamp(f, 0, 1) * 0.96);
      ctx.fillRect(rt.x, rt.y, rt.w, rt.h);
    }
  };

  /* The valley itself. Title, hub, dusk and the summary all draw THIS, which
     is why lighting the lantern reads as the same place changing rather than
     as a different screen. */
  Game.prototype._valley = function (ctx) {
    var t = this.t;
    var windowLit = 0.45 + this.night * 0.55;

    var L = this._layout();
    var i;

    Wd.sky(ctx, W, H, t);
    Wd.hills(ctx, W, H, L.hz);

    /* the village, sitting back against the hills */
    for (i = 0; i < L.houses.length; i++) {
      Wd.house(ctx, L.houses[i][0], L.houses[i][1], L.houses[i][2], windowLit);
    }
    /* Far trees first, then the near framing pair - back to front, so a
       foreground tree overlaps the village rather than the other way round.
       L.trees is authored in that order. */
    for (i = 0; i < L.trees.length; i++) {
      var tr = L.trees[i];
      Wd.tree(ctx, tr[0], tr[1], tr[2], tr[3], tr[4] || undefined);
    }

    Wd.ground(ctx, W, H, L.gy);
    Wd.path(ctx, W, H, L.gy, L.path);
    Wd.litter(ctx, W, L.litter.y, L.litter.h, 4242, L.litter.n);

    /* Trees rooted in the field, on top of the ground they stand on. Empty
       on desktop and in landscape, where every tree is on the skyline and
       the authored draw order above is untouched. */
    if (L.nearTrees) {
      for (i = 0; i < L.nearTrees.length; i++) {
        var nt = L.nearTrees[i];
        Wd.tree(ctx, nt[0], nt[1], nt[2], nt[3], nt[4] || undefined);
      }
    }

    /* signposts, back to front */
    for (i = L.spots.length - 1; i >= 0; i--) {
      var s = L.spots[i];
      Wd.sign(ctx, s.x, s.y, s.label, this.doneModes[s.id] ? 'done today' : s.sub, {
        w: s.w, h: s.h, s: s.s, time: t, locked: s.locked,
        hover: this.state === 'valley' && this.hover && this.hover.id === s.id
      });
    }

    /* candles along the path, far ones first */
    for (i = this.candles.length - 1; i >= 0; i--) {
      var c = this.candles[i];
      Wd.candle(ctx, c.x, c.y, c.s, c.lit, t);
    }

    Wd.lantern(ctx, L.lantern.x, L.lantern.y, L.lantern.s, this.lantern.lit, t);

    /* the keeper, facing her lantern. Her scale comes from the layout too -
       a keeper left at scale 1 in a portrait valley is a 30-unit figure
       standing among 300-unit signposts, which reads as a bug rather than
       as distance. */
    Wd.keeper(ctx, L.keeper.x, L.keeper.y, {
      face: L.lantern.x < L.keeper.x ? -1 : 1, time: t, scale: L.keeper.s,
      lit: 0.55 + this.night * 0.45
    });

    this.particles.draw(ctx);
    this.drift.draw(ctx, 0.5 + this.night * 0.2);

    P.grain(ctx, W, H);
    P.vignette(ctx, W, H, 0.30);
  };

  /* --------------------------------------------------------------- HUD */

  Game.prototype._dayCard = function (ctx) {
    var T = this.tally;
    var hud = hudRect();
    var x = hud.x + 14, y = hud.y + 12, w = 244, h = 82;
    EF.card(ctx, x, y, w, h, 0.9);
    EF.text(ctx, 'DAY ' + this.day + ' OF ' + this.days, x + 12, y + 19, 15,
      { align: 'left', weight: '700', color: P.get('candleGold'), halo: false });
    EF.text(ctx, 'autumn in the valley', x + w - 12, y + 19, 11,
      { align: 'right', weight: '600', color: P.rgba('cream', 0.6), halo: false });

    EF.text(ctx, 'fruit ' + T.fruit + '    apples ' + T.apples + '    pies ' + T.pies,
      x + 12, y + 44, 13, { align: 'left', weight: '600', color: P.rgba('cream', 0.88), halo: false });
    EF.text(ctx, 'wax ' + T.wax + '    kindling ' + T.kindling + '    candles ' + T.candles,
      x + 12, y + 65, 13, { align: 'left', weight: '600', color: P.rgba('candleGold', 0.92), halo: false });
  };

  Game.prototype._valleyHud = function (ctx) {
    this._dayCard(ctx);

    var hint;
    if (!this.doneModes.harvest) hint = 'the orchard is dropping fruit  -  go and catch it';
    else if (!this.doneModes.rake) hint = 'the yard needs raking  -  leaves become wax';
    else hint = 'dusk is close  -  tap the lantern to light the valley';

    /* Below the day card, not across it: centred at y=40 this line ran
       straight through the card's own text. */
    var hud = hudRect();
    EF.text(ctx, hint, hud.cx, hud.y + 126, 17,
      { color: P.rgba('cream', 0.94), halo: P.rgba('vignette', 0.55) });

    if (this.duskReady()) {
      /* A ring around the lantern once it is the obvious next thing. */
      var pulse = 0.45 + 0.35 * Math.sin(this.t * 3);
      var ln = this._layout().lantern, ls = ln.s || 1;
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -this.t * 14;
      ctx.strokeStyle = P.rgba('candleGold', pulse);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(ln.x, ln.y + 14 * ls, 34 * ls, 50 * ls, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (this.toastT <= 0) {
      /* The hint has to name an input the player actually has. On a phone
         there are no keys 1 2 3 and no M, and telling somebody to "click"
         a signpost they are about to tap is the small kind of wrong that
         makes a whole build feel like it was never opened on a phone. */
      EF.text(ctx, EF.touch ? 'tap a signpost   -   the pad below does the rest'
                            : 'click a signpost   -   keys 1 2 3   -   M mutes', hud.cx, hud.bottom - 20, 12,
        { weight: '600', color: P.rgba('cream', 0.5), halo: false });
    }
  };

  /* A thin strip over an activity: which day it is and how to get out. */
  Game.prototype._modeHud = function (ctx) {
    /* The corners, deliberately. The middle of the bottom edge belongs to the
       activity - the rake writes its "nothing here can be lost" line there,
       and all three lines were landing on the same pixels. */
    var hud = hudRect();
    EF.text(ctx, 'day ' + this.day + ' of ' + this.days, hud.x + 14, hud.bottom - 16, 12,
      { align: 'left', weight: '700', color: P.rgba('cream', 0.55), halo: P.rgba('vignette', 0.4) });
    if (this.mode && this.mode.t < 8) {
      EF.text(ctx, EF.touch ? 'BACK  -  to the valley' : 'ESC  -  back to the valley', hud.right - 14, hud.bottom - 16, 12,
        { align: 'right', weight: '600', color: P.rgba('cream', 0.45), halo: P.rgba('vignette', 0.4) });
    }
  };

  Game.prototype._duskHud = function (ctx) {
    this._dayCard(ctx);
    var T = this.tally;
    var line = '', sub = '';

    if (this.duskPhase === 'falling') {
      line = 'dusk';
      sub = 'the valley goes dark before you light it';
    } else if (this.duskPhase === 'lantern') {
      line = 'light the lantern';
      sub = LANTERN_COST + ' wax  -  you have ' + T.wax;
    } else if (this.duskPhase === 'candles') {
      line = 'light the path';
      sub = CANDLE_COST + ' wax a candle  -  ' + T.wax + ' wax left';
    } else {
      line = 'the valley is glowing';
      sub = 'tap to finish day ' + this.day;
    }

    EF.text(ctx, line, W * 0.5, 128, 26,
      { color: P.get('candleGold'), halo: P.rgba('vignette', 0.6) });
    EF.text(ctx, sub, W * 0.5, 156, 14,
      { weight: '600', color: P.rgba('cream', 0.8), halo: P.rgba('vignette', 0.5) });

    /* Show where the wax can go, but only while there is wax to spend. */
    if (this.duskPhase === 'candles' && T.wax >= CANDLE_COST) {
      var pulse = 0.35 + 0.35 * Math.sin(this.t * 3.4);
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -this.t * 12;
      ctx.strokeStyle = P.rgba('candleGold', pulse);
      ctx.lineWidth = 2;
      for (var i = 0; i < this.candles.length; i++) {
        var c = this.candles[i];
        if (c.target > 0) continue;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y - 4 * c.s, 17 * c.s, 20 * c.s, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  Game.prototype._title = function (ctx) {
    var a = 0.55 + 0.45 * Math.sin(this.t * 2.2);
    EF.card(ctx, W * 0.5 - 246, 52, 492, 132, 0.72);
    EF.text(ctx, 'EMBERFALL', W * 0.5, 100, 56,
      { color: P.get('candleGold'), halo: P.rgba('vignette', 0.65) });
    EF.text(ctx, 'thirty days of autumn  -  and one lantern to keep', W * 0.5, 142, 16,
      { weight: '600', color: P.rgba('cream', 0.88), halo: P.rgba('vignette', 0.5) });
    EF.text(ctx, 'gather by day  -  light the paths by night', W * 0.5, 166, 13,
      { weight: '600', color: P.rgba('cream', 0.62), halo: false });

    EF.text(ctx, 'tap anywhere to begin day 1', W * 0.5, H - 62, 18,
      { color: P.rgba('candleGold', a), halo: P.rgba('vignette', 0.55) });
    if (this.bestLanterns > 0) {
      EF.text(ctx, 'best evening so far: ' + this.bestLanterns + ' flames lit', W * 0.5, H - 34, 12,
        { weight: '600', color: P.rgba('cream', 0.55), halo: false });
    }
  };

  Game.prototype._summary = function (ctx) {
    var T = this.tally;
    var rv = EF.fullRect(W, H);
    ctx.fillStyle = P.rgba('vignette', 0.42);
    ctx.fillRect(rv.x, rv.y, rv.w, rv.h);

    var cw = 432, ch = 340, x = (W - cw) * 0.5, y = (H - ch) * 0.5 - 8;
    EF.card(ctx, x, y, cw, ch, 0.95);

    EF.text(ctx, 'DAY ' + this.day + ' OF ' + this.days, W * 0.5, y + 34, 24,
      { color: P.get('candleGold'), halo: P.rgba('vignette', 0.6) });
    EF.text(ctx, T.lantern ? 'the lantern is lit and the valley is warm'
      : 'the valley waits for its light',
      W * 0.5, y + 60, 13, { weight: '600', color: P.rgba('cream', 0.72), halo: false });

    var rows = [
      ['orchard', T.recipe ? (T.recipe + '  x' + T.pies) : 'no recipe finished'],
      ['fruit gathered', String(T.fruit)],
      ['harvest score', String(T.score)],
      ['leaves piled', String(T.piled)],
      ['kindling', String(T.kindling)],
      ['high grove', this.doneModes.swing ? (T.apples + ' apples, ' + T.hooks + ' vines')
        : 'not visited today'],
      ['lantern', T.lantern ? 'lit  (' + LANTERN_COST + ' wax)' : 'unlit'],
      ['path candles', T.candles + ' of ' + this.candles.length],
      ['wax left over', String(T.wax)]
    ];

    var ry = y + 94;
    for (var i = 0; i < rows.length; i++) {
      var warmRow = i >= 6;
      EF.text(ctx, rows[i][0], x + 26, ry, 13,
        { align: 'left', weight: '600', color: P.rgba('cream', 0.66), halo: false });
      EF.text(ctx, rows[i][1], x + cw - 26, ry, 13,
        { align: 'right', weight: '700',
          color: warmRow ? P.rgba('candleGold', 0.95) : P.rgba('cream', 0.92), halo: false });
      ry += 23;
    }

    EF.text(ctx, (this.days - this.day) + ' days to the harvest festival', W * 0.5, y + ch - 44, 14,
      { weight: '700', color: P.rgba('candleGold', 0.9), halo: false });
    var a = 0.45 + 0.4 * Math.sin(this.t * 2.4);
    EF.text(ctx, 'tap to return to the title', W * 0.5, y + ch - 22, 12,
      { weight: '600', color: P.rgba('cream', a), halo: false });
  };

  Game.prototype._mute = function (ctx) {
    var m = muteAt();
    var x = 0, y = 0;
    ctx.save();
    ctx.translate(m.x, m.y);
    if (m.s !== 1) ctx.scale(m.s, m.s);
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = P.rgba('panel', 0.45);
    ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.fill();
    ctx.fillStyle = P.rgba('cream', 0.9);
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 3); ctx.lineTo(x - 3, y - 3); ctx.lineTo(x + 2, y - 8);
    ctx.lineTo(x + 2, y + 8); ctx.lineTo(x - 3, y + 3); ctx.lineTo(x - 7, y + 3);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = P.rgba('cream', 0.9);
    ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    if (this.muted) {
      ctx.beginPath();
      ctx.moveTo(x + 5, y - 5); ctx.lineTo(x + 11, y + 5);
      ctx.moveTo(x + 11, y - 5); ctx.lineTo(x + 5, y + 5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x + 4, y, 5, -0.9, 0.9);
      ctx.moveTo(x + 12, y - 6);
      ctx.arc(x + 4, y, 9, -0.8, 0.8);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* --------------------------------------------------------- inspection */

  Game.prototype.snapshot = function () {
    var lit = 0;
    for (var i = 0; i < this.candles.length; i++) if (this.candles[i].target > 0) lit++;
    return {
      state: this.state,
      day: this.day,
      days: this.days,
      night: +this.night.toFixed(3),
      warm: +this.warm.toFixed(3),
      duskPhase: this.duskPhase,
      duskReady: this.duskReady(),
      transitioning: !!this.trans,
      done: {
        harvest: this.doneModes.harvest,
        rake: this.doneModes.rake,
        swing: this.doneModes.swing
      },
      tally: {
        fruit: this.tally.fruit, score: this.tally.score, pies: this.tally.pies,
        wax: this.tally.wax, kindling: this.tally.kindling, piled: this.tally.piled,
        apples: this.tally.apples, candles: this.tally.candles, lantern: this.tally.lantern
      },
      candlesLit: lit,
      lanternLit: +this.lantern.lit.toFixed(3),
      muted: this.muted,
      persistent: EF.Store.persistent,
      mode: this.mode ? this.mode.snapshot() : null
    };
  };

  Game.SPOTS = SPOTS;
  Game.CANDLE_SPOTS = CANDLE_SPOTS;
  Game.LANTERN = LANTERN;
  EF.Game = Game;

}(window));
