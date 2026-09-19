/* EMBERFALL - RAKE.
 *
 * The cozy one. Sweep loose leaves into a pile before the gusts scatter them.
 * The pile is not scenery: saved leaves render down into WAX and KINDLING,
 * which is the only way to make a candle, which is the only way to light a
 * lantern. That is the whole reason raking exists in the loop.
 *
 * Design constraint from the brief: "slow, warm, cannot lose". So:
 *   - there is no timer and no fail state, anywhere in this file;
 *   - a gust can only move leaves you have NOT banked - the pile is sacred;
 *   - gusts are telegraphed a full 1.6s before they land.
 * The only thing the player can lose is time, and time here costs nothing.
 */
(function (global) {
  'use strict';

  var EF = global.EF;
  var P = EF.Palette;
  var Wd = EF.World;
  var TAU = EF.TAU;

  var LEAVES = 150;
  var TARGET = 78;            // leaves to bank before the pile is "ready"
  var PILE_X = 566, PILE_Y = 424, PILE_R = 58;
  var RAKE_R = 52;
  var GROUND_Y = 318;         // grass starts high: this scene is nearly all yard
  var LEAF_COLS = ['leafRusset', 'leafOrange', 'leafAmber', 'leafGold', 'leafOchre'];

  function Rake(game, seed) {
    this.game = game;
    this.rnd = EF.rng(seed || 606011);
    this.t = 0;
    this.done = false;
    this.ready = false;
    this.readyT = 0;

    this.leaves = [];
    for (var i = 0; i < LEAVES; i++) {
      var lx, ly;
      /* Keep the starting scatter out of the pile ring, or the round begins
         with free points and the first sweep feels unearned. */
      do {
        lx = 40 + this.rnd() * 640;
        ly = GROUND_Y + 22 + this.rnd() * (540 - GROUND_Y - 52);
      } while (EF.hypot(lx - PILE_X, ly - PILE_Y) < PILE_R + 26);
      this.leaves.push({
        x: lx, y: ly, vx: 0, vy: 0,
        rot: this.rnd() * TAU, spin: 0,
        s: 4.4 + this.rnd() * 3.4,
        col: LEAF_COLS[(this.rnd() * LEAF_COLS.length) | 0],
        piled: false, settle: 0
      });
    }

    this.piled = 0;
    this.wax = 0;
    this.kindling = 0;

    this.rx = 200; this.ry = 430;       // rake position
    this.px = 200; this.py = 430;       // previous, for the sweep vector
    this.tx = 200; this.ty = 430;       // input target
    this.axisX = 0; this.axisY = 0;
    this.swing = 0;                     // visual: how hard the rake is moving

    this.gustIn = 9;
    this.gustWarn = 0;
    this.gustPower = 0;
    this.gustDir = 1;
    this.gusts = 0;

    this.toast = 'sweep the leaves toward the pile';
    this.toastT = 3.4;

    this.particles = new EF.Particles(160);
    this.drift = new Wd.Drift(16, 720, 540, 8181);
  }

  Rake.prototype.label = 'Rake';

  Rake.prototype.pointer = function (x, y) {
    this.tx = EF.clamp(x, 16, 704);
    this.ty = EF.clamp(y, GROUND_Y + 6, 528);
    this.axisX = this.axisY = 0;
  };
  Rake.prototype.setAxis = function (dx, dy) { this.axisX = dx; this.axisY = dy; };

  Rake.prototype._bank = function (q) {
    q.piled = true;
    this.piled++;
    this.kindling = Math.round(this.piled * 0.5);
    this.wax = Math.floor(this.piled / 14);
    if (EF.Audio) EF.Audio.rustle();
    if (this.piled >= TARGET && !this.ready) {
      this.ready = true;
      this.readyT = 0;
      this.toast = 'the pile is ready  -  ' + this.wax + ' wax, ' + this.kindling + ' kindling';
      this.toastT = 3;
      if (EF.Audio) EF.Audio.win();
      var gold = P.rgb('candleGold');
      for (var i = 0; i < 34; i++) {
        this.particles.spawn(PILE_X, PILE_Y, (this.rnd() - 0.5) * 220, -80 - this.rnd() * 160,
          0.9 + this.rnd() * 0.5, 4, gold, { gravity: 200, drag: 0.9, glow: true });
      }
    }
  };

  Rake.prototype.update = function (dt) {
    if (this.done) return;
    this.t += dt;
    this.toastT = Math.max(0, this.toastT - dt);

    if (this.axisX || this.axisY) {
      this.tx = EF.clamp(this.tx + this.axisX * 420 * dt, 16, 704);
      this.ty = EF.clamp(this.ty + this.axisY * 420 * dt, GROUND_Y + 6, 528);
    }

    this.px = this.rx; this.py = this.ry;
    this.rx = EF.damp(this.rx, this.tx, 0.045, dt);
    this.ry = EF.damp(this.ry, this.ty, 0.045, dt);
    var sdx = this.rx - this.px, sdy = this.ry - this.py;
    var speed = EF.hypot(sdx, sdy) / Math.max(dt, 1e-4);
    this.swing = EF.damp(this.swing, EF.clamp(speed / 500, 0, 1), 0.08, dt);

    /* ---- gusts. Telegraphed, and harmless to anything already banked. */
    this.gustIn -= dt;
    if (this.gustIn <= 0 && this.gustWarn <= 0 && this.gustPower <= 0) {
      this.gustWarn = 1.6;
      this.gustDir = this.rnd() > 0.5 ? 1 : -1;
    }
    if (this.gustWarn > 0) {
      this.gustWarn -= dt;
      if (this.gustWarn <= 0) {
        this.gustPower = 1;
        this.gusts++;
        this.gustIn = 9 + this.rnd() * 5;
        if (EF.Audio) EF.Audio.gust();
      }
    }
    if (this.gustPower > 0) this.gustPower = Math.max(0, this.gustPower - dt * 0.85);

    var gust = this.gustDir * this.gustPower * 170;
    this.drift.update(dt, gust + Math.sin(this.t * 0.6) * 20);
    this.particles.update(dt, gust * 0.4);

    /* ---- leaves */
    var nx = sdx === 0 && sdy === 0 ? 0 : sdx / Math.max(1e-4, EF.hypot(sdx, sdy));
    var ny = sdx === 0 && sdy === 0 ? 0 : sdy / Math.max(1e-4, EF.hypot(sdx, sdy));

    for (var i = 0; i < this.leaves.length; i++) {
      var q = this.leaves[i];

      if (q.piled) {
        /* Banked leaves creep toward the mound and stay there. */
        q.x = EF.damp(q.x, PILE_X + (q.settle - 0.5) * PILE_R * 1.3, 0.25, dt);
        q.y = EF.damp(q.y, PILE_Y + (q.spin - 0.5) * PILE_R * 0.62, 0.25, dt);
        continue;
      }

      /* rake push */
      var dx = q.x - this.rx, dy = q.y - this.ry;
      var d = EF.hypot(dx, dy);
      if (d < RAKE_R && speed > 25) {
        var falloff = 1 - d / RAKE_R;
        var push = EF.clamp(speed * 0.55, 0, 460) * falloff;
        /* Mostly along the sweep, a little radially out - that mix is what
           makes a rake feel like a rake instead of a magnet. */
        q.vx += (nx * 0.82 + (d > 0.1 ? dx / d : 0) * 0.30) * push * dt * 9;
        q.vy += (ny * 0.82 + (d > 0.1 ? dy / d : 0) * 0.30) * push * dt * 9;
        q.spin = (this.rnd() - 0.5) * 6;
      }

      /* gust - only ever touches loose leaves */
      if (this.gustPower > 0) {
        q.vx += gust * dt * 2.1;
        q.vy += (this.rnd() - 0.5) * 60 * this.gustPower * dt * 2.1;
      }

      var fr = Math.exp(-4.6 * dt);
      q.vx *= fr; q.vy *= fr;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rot += q.spin * dt;
      q.spin *= fr;

      if (q.x < 10) { q.x = 10; q.vx = Math.abs(q.vx) * 0.3; }
      if (q.x > 710) { q.x = 710; q.vx = -Math.abs(q.vx) * 0.3; }
      if (q.y < GROUND_Y + 8) { q.y = GROUND_Y + 8; q.vy = Math.abs(q.vy) * 0.3; }
      if (q.y > 532) { q.y = 532; q.vy = -Math.abs(q.vy) * 0.3; }

      if (EF.hypot(q.x - PILE_X, q.y - PILE_Y) < PILE_R) {
        q.settle = this.rnd();
        q.spin = this.rnd();
        this._bank(q);
        for (var p = 0; p < 3; p++) {
          this.particles.spawn(q.x, q.y, (this.rnd() - 0.5) * 60, -30 - this.rnd() * 40,
            0.4, 3, P.rgb(q.col), { gravity: 150, drag: 1.6, leaf: true, spin: 5 });
        }
      }
    }

    if (this.ready) {
      this.readyT += dt;
      /* A beat to enjoy it, then the day moves on. No input required - the
         cozy mode should never end on a "press any key". */
      if (this.readyT > 2.6) this._finish();
    }
  };

  Rake.prototype._finish = function () {
    this.done = true;
    this.result = { wax: this.wax, kindling: this.kindling, piled: this.piled, gusts: this.gusts };
  };

  /* ----------------------------------------------------------- drawing */

  Rake.prototype.render = function (ctx) {
    var w = 720, h = 540, t = this.t;

    Wd.sky(ctx, w, h, t);
    Wd.hills(ctx, w, h, GROUND_Y - 6);

    /* The yard: a house, a fence line, one big maple. */
    Wd.tree(ctx, 128, GROUND_Y + 30, 0.92, 4141);
    Wd.house(ctx, 320, GROUND_Y + 26, 1.0, 0.3);
    Wd.tree(ctx, 656, GROUND_Y + 24, 0.7, 9292);

    Wd.ground(ctx, w, h, GROUND_Y + 22);

    /* fence */
    ctx.strokeStyle = P.rgba('bark', 0.8);
    ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (var fx = 24; fx < w; fx += 46) {
      ctx.beginPath(); ctx.moveTo(fx, GROUND_Y + 22); ctx.lineTo(fx, GROUND_Y - 6); ctx.stroke();
    }
    ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(0, GROUND_Y + 6); ctx.lineTo(w, GROUND_Y + 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, GROUND_Y + 16); ctx.lineTo(w, GROUND_Y + 16); ctx.stroke();

    this._pileRing(ctx);

    /* loose leaves, then the mound, then banked leaves on top of it */
    var i, q;
    for (i = 0; i < this.leaves.length; i++) {
      q = this.leaves[i];
      if (q.piled) continue;
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.fillStyle = P.get(q.col);
      ctx.beginPath(); ctx.ellipse(0, 0, q.s, q.s * 0.52, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = P.rgba('barkDark', 0.22);
      ctx.fillRect(-q.s, -0.5, q.s * 2, 1);
      ctx.restore();
    }

    this._mound(ctx);

    for (i = 0; i < this.leaves.length; i++) {
      q = this.leaves[i];
      if (!q.piled) continue;
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      ctx.fillStyle = P.get(q.col);
      ctx.beginPath(); ctx.ellipse(0, 0, q.s, q.s * 0.52, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    this.particles.draw(ctx);
    this.drift.draw(ctx, 0.5);
    this._rake(ctx);

    if (this.gustWarn > 0) this._gustWarning(ctx);

    P.grain(ctx, w, h);
    P.vignette(ctx, w, h, 0.28);

    this._hud(ctx);

    if (this.toastT > 0) {
      EF.text(ctx, this.toast, 360, GROUND_Y - 34, 19,
        { color: P.rgba('cream', EF.clamp(this.toastT, 0, 1)),
          halo: P.rgba('vignette', 0.5 * EF.clamp(this.toastT, 0, 1)) });
    }
  };

  Rake.prototype._pileRing = function (ctx) {
    var pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);
    ctx.save();
    ctx.setLineDash([9, 7]);
    ctx.lineDashOffset = -this.t * 16;
    ctx.strokeStyle = P.rgba('candleGold', 0.32 + pulse * 0.2);
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(PILE_X, PILE_Y, PILE_R, PILE_R * 0.66, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  };

  Rake.prototype._mound = function (ctx) {
    var u = EF.clamp(this.piled / TARGET, 0, 1);
    if (u <= 0.01) return;
    var hgt = 10 + u * 42;
    var wid = PILE_R * (0.5 + u * 0.72);
    ctx.save();
    ctx.fillStyle = P.rgba('leafOrange', 0.92);
    ctx.beginPath();
    ctx.ellipse(PILE_X, PILE_Y + 8, wid, hgt * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = P.rgba('leafRusset', 0.75);
    ctx.beginPath();
    ctx.ellipse(PILE_X - wid * 0.22, PILE_Y + 12, wid * 0.6, hgt * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = P.rgba('leafGold', 0.6);
    ctx.beginPath();
    ctx.ellipse(PILE_X + wid * 0.24, PILE_Y - 2, wid * 0.42, hgt * 0.26, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  Rake.prototype._rake = function (ctx) {
    var x = this.rx, y = this.ry;
    var ang = Math.atan2(this.ry - this.py, this.rx - this.px);
    if (!isFinite(ang)) ang = 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang + Math.PI * 0.5);       // head sits across the sweep

    /* soft shadow so it sits ON the grass, not above it */
    ctx.fillStyle = P.rgba('vignette', 0.16);
    ctx.beginPath(); ctx.ellipse(2, 6, 46, 12, 0, 0, TAU); ctx.fill();

    /* handle */
    ctx.strokeStyle = P.get('bark');
    ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -54); ctx.stroke();

    /* head + tines */
    ctx.strokeStyle = P.shade('bark', 0.2);
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(40, 0); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = P.shade('bark', -0.1);
    for (var i = -4; i <= 4; i++) {
      var tx = i * 9.5;
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.quadraticCurveTo(tx * 1.12, 8, tx * 1.2, 15);
      ctx.stroke();
    }
    ctx.restore();

    /* sweep arc - a faint trail so fast sweeps read as force */
    if (this.swing > 0.05) {
      ctx.save();
      ctx.strokeStyle = P.rgba('cream', 0.13 * this.swing);
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(this.px, this.py);
      ctx.lineTo(this.rx, this.ry);
      ctx.stroke();
      ctx.restore();
    }
  };

  Rake.prototype._gustWarning = function (ctx) {
    var a = 0.45 + 0.55 * Math.sin(this.t * 12);
    var dir = this.gustDir;
    EF.text(ctx, dir > 0 ? 'gust coming  >>>' : '<<<  gust coming', 360, GROUND_Y + 54, 18,
      { color: P.rgba('candleGold', a), halo: P.rgba('vignette', 0.55) });
    ctx.save();
    ctx.strokeStyle = P.rgba('cream', 0.22 * a);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    for (var i = 0; i < 6; i++) {
      var y = GROUND_Y + 90 + i * 58;
      var ph = (this.t * 300 + i * 90) % 900 - 100;
      var sx = dir > 0 ? ph : 720 - ph;
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.quadraticCurveTo(sx + dir * 40, y - 9, sx + dir * 84, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  Rake.prototype._hud = function (ctx) {
    var x = 14, y = 12, w = 246, h = 74;
    EF.card(ctx, x, y, w, h, 0.9);
    EF.text(ctx, 'THE PILE', x + 12, y + 18, 14,
      { align: 'left', weight: '700', color: P.get('candleGold'), halo: false });

    var bx = x + 12, by = y + 32, bw = w - 24, bh = 10;
    EF.roundRect(ctx, bx, by, bw, bh, 5);
    ctx.fillStyle = P.rgba('panel', 0.5); ctx.fill();
    var u = EF.clamp(this.piled / TARGET, 0, 1);
    EF.roundRect(ctx, bx, by, Math.max(4, bw * u), bh, 5);
    ctx.fillStyle = P.rgba('leafOrange', 0.95); ctx.fill();

    EF.text(ctx, this.piled + ' / ' + TARGET + ' leaves', bx, y + 60, 13,
      { align: 'left', weight: '600', color: P.rgba('cream', 0.85), halo: false });
    EF.text(ctx, this.wax + ' wax  -  ' + this.kindling + ' kindling', x + w - 12, y + 60, 13,
      { align: 'right', weight: '600', color: P.rgba('candleGold', 0.95), halo: false });

    EF.text(ctx, 'no timer  -  nothing here can be lost', 360, 524, 12,
      { weight: '600', color: P.rgba('cream', 0.5), halo: false });
  };

  Rake.prototype.snapshot = function () {
    return {
      mode: 'rake', t: +this.t.toFixed(2), piled: this.piled, target: TARGET,
      wax: this.wax, kindling: this.kindling, gusts: this.gusts,
      ready: this.ready, done: this.done,
      rake: [Math.round(this.rx), Math.round(this.ry)]
    };
  };

  /* A test/debug affordance, and also the honest answer to "how do you prove a
     mode with no timer completes": bank the remaining leaves directly through
     the real _bank path, so every side effect is the real one. */
  Rake.prototype.fill = function (n) {
    var added = 0;
    for (var i = 0; i < this.leaves.length && (n === undefined || added < n); i++) {
      var q = this.leaves[i];
      if (q.piled) continue;
      q.settle = this.rnd(); q.spin = this.rnd();
      this._bank(q);
      added++;
      if (this.ready) break;
    }
    return added;
  };

  Rake.TARGET = TARGET;
  Rake.PILE = { x: PILE_X, y: PILE_Y, r: PILE_R };
  EF.Rake = Rake;

}(window));
