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
    for (var i = 0; i < 46; i++) {
      this.particles.spawn(LANTERN.x, LANTERN.y - 4, (this.rnd() - 0.5) * 150, -60 - this.rnd() * 150,
        1.0 + this.rnd() * 0.8, 4, gold, { gravity: -30, drag: 0.7, glow: true });
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

  Game.prototype._hit = function (x, y) {
    for (var i = 0; i < SPOTS.length; i++) {
      var s = SPOTS[i];
      if (x >= s.x - s.w * 0.5 && x <= s.x + s.w * 0.5 && y >= s.y - s.h - 6 && y <= s.y + 34) return s;
    }
    if (this.duskReady() &&
        x >= LANTERN.x - 30 && x <= LANTERN.x + 30 && y >= LANTERN.y - 34 && y <= LANTERN.y + 60) {
      return { id: 'dusk', x: LANTERN.x, y: LANTERN.y };
    }
    return null;
  };

  /* The mute control is the one thing that must work in every state. */
  function inMute(x, y) { return EF.hypot(x - 692, y - 24) < 20; }

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
        ctx.fillStyle = P.rgba('vignette', 0.45);
        ctx.fillRect(0, 0, W, H);
        EF.Stash.drawLockedCard(ctx, W, H, this.t);
      }
    }

    this._mute(ctx);

    if (this.toastT > 0 && this.state !== 'summary') {
      var a = EF.clamp(this.toastT, 0, 1);
      EF.text(ctx, this.toast, W * 0.5, H - 34, 17,
        { color: P.rgba('cream', a), halo: P.rgba('vignette', 0.55 * a) });
    }

    if (this.trans) {
      var f = this.trans.t < 1 ? this.trans.t : (2 - this.trans.t);
      ctx.fillStyle = P.rgba('vignette', EF.clamp(f, 0, 1) * 0.96);
      ctx.fillRect(0, 0, W, H);
    }
  };

  /* The valley itself. Title, hub, dusk and the summary all draw THIS, which
     is why lighting the lantern reads as the same place changing rather than
     as a different screen. */
  Game.prototype._valley = function (ctx) {
    var t = this.t;
    var windowLit = 0.45 + this.night * 0.55;

    Wd.sky(ctx, W, H, t);
    Wd.hills(ctx, W, H, HORIZON);

    /* the village, sitting back against the hills */
    Wd.house(ctx, 88, GROUND_Y + 6, 0.92, windowLit);
    Wd.house(ctx, 208, GROUND_Y + 2, 0.74, windowLit);
    Wd.house(ctx, 626, GROUND_Y + 6, 0.86, windowLit);

    Wd.tree(ctx, 28, GROUND_Y + 10, 0.95, 11);
    Wd.tree(ctx, 152, GROUND_Y + 8, 0.70, 22);
    Wd.tree(ctx, 300, GROUND_Y + 6, 0.62, 33);
    Wd.tree(ctx, 470, GROUND_Y + 8, 0.66, 44, { fruit: true });
    Wd.tree(ctx, 692, GROUND_Y + 12, 1.00, 55);

    Wd.ground(ctx, W, H, GROUND_Y);
    Wd.path(ctx, W, H, GROUND_Y);
    Wd.litter(ctx, W, GROUND_Y + 6, H - GROUND_Y - 6, 4242, 170);

    /* signposts, back to front */
    for (var i = SPOTS.length - 1; i >= 0; i--) {
      var s = SPOTS[i];
      Wd.sign(ctx, s.x, s.y, s.label, this.doneModes[s.id] ? 'done today' : s.sub, {
        w: s.w, h: s.h, time: t, locked: s.locked,
        hover: this.state === 'valley' && this.hover && this.hover.id === s.id
      });
    }

    /* candles along the path, far ones first */
    for (i = this.candles.length - 1; i >= 0; i--) {
      var c = this.candles[i];
      Wd.candle(ctx, c.x, c.y, c.s, c.lit, t);
    }

    Wd.lantern(ctx, LANTERN.x, LANTERN.y, LANTERN.s, this.lantern.lit, t);

    /* the keeper, facing her lantern */
    Wd.keeper(ctx, KEEPER.x, KEEPER.y, {
      face: 1, time: t, scale: 1,
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
    var x = 14, y = 12, w = 244, h = 82;
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
    EF.text(ctx, hint, W * 0.5, 126, 17,
      { color: P.rgba('cream', 0.94), halo: P.rgba('vignette', 0.55) });

    if (this.duskReady()) {
      /* A ring around the lantern once it is the obvious next thing. */
      var pulse = 0.45 + 0.35 * Math.sin(this.t * 3);
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -this.t * 14;
      ctx.strokeStyle = P.rgba('candleGold', pulse);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(LANTERN.x, LANTERN.y + 14, 34, 50, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (this.toastT <= 0) {
      /* The hint has to name an input the player actually has. On a phone
         there are no keys 1 2 3 and no M, and telling somebody to "click"
         a signpost they are about to tap is the small kind of wrong that
         makes a whole build feel like it was never opened on a phone. */
      EF.text(ctx, EF.touch ? 'tap a signpost   -   the pad below does the rest'
                            : 'click a signpost   -   keys 1 2 3   -   M mutes', W * 0.5, H - 20, 12,
        { weight: '600', color: P.rgba('cream', 0.5), halo: false });
    }
  };

  /* A thin strip over an activity: which day it is and how to get out. */
  Game.prototype._modeHud = function (ctx) {
    /* The corners, deliberately. The middle of the bottom edge belongs to the
       activity - the rake writes its "nothing here can be lost" line there,
       and all three lines were landing on the same pixels. */
    EF.text(ctx, 'day ' + this.day + ' of ' + this.days, 14, H - 16, 12,
      { align: 'left', weight: '700', color: P.rgba('cream', 0.55), halo: P.rgba('vignette', 0.4) });
    if (this.mode && this.mode.t < 8) {
      EF.text(ctx, EF.touch ? 'BACK  -  to the valley' : 'ESC  -  back to the valley', W - 14, H - 16, 12,
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
    ctx.fillStyle = P.rgba('vignette', 0.42);
    ctx.fillRect(0, 0, W, H);

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
    var x = 692, y = 24;
    ctx.save();
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
