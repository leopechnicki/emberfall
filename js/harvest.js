/* EMBERFALL - HARVEST.
 *
 * The orchard. Fruit falls, wind pushes it sideways, you move a basket.
 *
 * The thing that makes this more than "catch the falling objects" is the
 * RECIPE CARD: each round names a dish, and the dish is an ORDERED list.
 * Catching the next ingredient in sequence steps the multiplier up; catching
 * something else is still food but does not advance you; catching an acorn or
 * a wasp drops the multiplier and knocks a step off. So the decision is never
 * "can I reach it" - it is "do I want it YET", which is a decision the wind
 * gets to argue with.
 *
 * Cozy rules: nothing here can kill you and the round always ends on a timer.
 * The worst outcome is a small basket of apples and no pie.
 */
(function (global) {
  'use strict';

  var EF = global.EF;
  var P = EF.Palette;
  var Wd = EF.World;
  var TAU = EF.TAU;

  var ROUND = 45;            // seconds
  var GROUND_Y = 470;
  var BASKET_Y = 448;
  var BASKET_HW = 46;        // half width of the catching mouth

  /* Ingredient roster. `good` items feed the village; the other two are the
     only way to lose progress. */
  var KINDS = {
    apple:    { col: 'apple',    good: true,  food: 1, pts: 10, r: 11, fall: 128 },
    pumpkin:  { col: 'pumpkin',  good: true,  food: 2, pts: 16, r: 15, fall: 108 },
    cinnamon: { col: 'cinnamon', good: true,  food: 0, pts: 8,  r: 10, fall: 142 },
    honey:    { col: 'honey',    good: true,  food: 0, pts: 12, r: 11, fall: 118 },
    acorn:    { col: 'acorn',    good: false, food: 0, pts: 0,  r: 9,  fall: 168 },
    wasp:     { col: 'wasp',     good: false, food: 0, pts: 0,  r: 10, fall: 96  }
  };

  var RECIPES = [
    { name: 'Apple Pie',    steps: ['apple', 'apple', 'apple', 'cinnamon', 'cinnamon', 'honey'], bonus: 120 },
    { name: 'Spiced Cider', steps: ['apple', 'cinnamon', 'honey', 'apple', 'cinnamon'],          bonus: 100 },
    { name: 'Pumpkin Loaf', steps: ['pumpkin', 'pumpkin', 'cinnamon', 'honey'],                  bonus: 110 }
  ];

  function Harvest(game, seed) {
    this.game = game;
    this.rnd = EF.rng(seed || 20260919);
    this.t = 0;
    this.left = ROUND;
    this.done = false;

    this.items = [];
    this.spawnIn = 0.5;
    this.wind = 0;
    this.gust = 0;
    this.gustIn = 4 + this.rnd() * 4;

    this.bx = 360;             // basket position and its input target
    this.target = 360;
    this.axis = 0;             // keyboard -1 / 0 / +1

    this.recipe = RECIPES[(this.rnd() * RECIPES.length) | 0];
    this.step = 0;
    this.mult = 1;
    this.pies = 0;
    this.fruit = 0;
    this.score = 0;

    this.pop = 0;              // basket squash on a catch
    this.shake = 0;
    this.flash = 0;            // warm flash on a recipe completion
    this.toast = '';
    this.toastT = 0;

    this.particles = new EF.Particles(220);
    this.drift = new Wd.Drift(22, 720, 540, 31337);
  }

  Harvest.prototype.label = 'Harvest';

  /* ------------------------------------------------------------ input */

  Harvest.prototype.pointer = function (x /*, y, down */) {
    this.target = EF.clamp(x, BASKET_HW, 720 - BASKET_HW);
    this.axis = 0;
  };
  Harvest.prototype.setAxis = function (d) { this.axis = d; };

  /* ------------------------------------------------------------ logic */

  Harvest.prototype._needed = function () { return this.recipe.steps[this.step]; };

  /* Spawn weights lean toward whatever the recipe wants next, so the card is a
     promise the round can actually keep. Without this the player is graded on
     the RNG's mood rather than on their own choices. */
  Harvest.prototype._pick = function () {
    var need = this._needed();
    var table = [
      ['apple', 22], ['pumpkin', 13], ['cinnamon', 13], ['honey', 10],
      ['acorn', 16], ['wasp', 11]
    ];
    for (var i = 0; i < table.length; i++) if (table[i][0] === need) table[i][1] += 22;
    var total = 0, j;
    for (j = 0; j < table.length; j++) total += table[j][1];
    var r = this.rnd() * total;
    for (j = 0; j < table.length; j++) { r -= table[j][1]; if (r <= 0) return table[j][0]; }
    return 'apple';
  };

  Harvest.prototype._spawn = function () {
    var kind = this._pick();
    var k = KINDS[kind];
    this.items.push({
      kind: kind, x: 50 + this.rnd() * 620, y: -24,
      vx: (this.rnd() - 0.5) * 30,
      vy: k.fall * (0.85 + this.rnd() * 0.35),
      rot: this.rnd() * TAU, spin: (this.rnd() - 0.5) * 3.2,
      r: k.r, caught: false
    });
  };

  Harvest.prototype._catch = function (it) {
    var k = KINDS[it.kind];
    this.pop = 1;
    var col = P.rgb(k.col);

    if (!k.good) {
      /* The only punishment in the whole game, and it is small on purpose. */
      this.mult = 1;
      this.step = Math.max(0, this.step - 1);
      this.shake = 1;
      this.toast = it.kind === 'wasp' ? 'a wasp! shake it off' : 'just an acorn';
      this.toastT = 1.6;
      for (var i = 0; i < 12; i++) {
        this.particles.spawn(it.x, it.y, (this.rnd() - 0.5) * 140, -40 - this.rnd() * 90,
          0.5 + this.rnd() * 0.3, 4, col, { gravity: 320, drag: 0.8 });
      }
      if (EF.Audio) EF.Audio.thud();
      return;
    }

    this.fruit += k.food;

    if (it.kind === this._needed()) {
      this.step++;
      this.mult = Math.min(3, 1 + this.step * 0.25);
      this.toast = 'in order! x' + this.mult.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
      this.toastT = 1.2;
      if (EF.Audio) EF.Audio.chime(this.step);
    } else {
      this.toast = 'into the basket';
      this.toastT = 0.9;
      if (EF.Audio) EF.Audio.pip();
    }

    this.score += Math.round(k.pts * this.mult);

    for (var p = 0; p < 10; p++) {
      this.particles.spawn(it.x, it.y, (this.rnd() - 0.5) * 90, -60 - this.rnd() * 70,
        0.4 + this.rnd() * 0.35, 4, col, { gravity: 300, drag: 1.0, leaf: true, spin: 6 });
    }

    if (this.step >= this.recipe.steps.length) {
      this.pies++;
      this.score += this.recipe.bonus;
      this.flash = 1;
      this.toast = this.recipe.name + ' done!  +' + this.recipe.bonus;
      this.toastT = 2.4;
      this.step = 0;
      this.mult = 1;
      if (EF.Audio) EF.Audio.win();
      var gold = P.rgb('candleGold');
      for (var e = 0; e < 40; e++) {
        this.particles.spawn(this.bx, BASKET_Y, (this.rnd() - 0.5) * 260, -120 - this.rnd() * 180,
          0.8 + this.rnd() * 0.6, 4, gold, { gravity: 260, drag: 0.9, glow: true });
      }
    }
  };

  Harvest.prototype.update = function (dt) {
    if (this.done) return;
    this.t += dt;
    this.left = Math.max(0, this.left - dt);

    this.pop = Math.max(0, this.pop - dt * 3.4);
    this.shake = Math.max(0, this.shake - dt * 2.6);
    this.flash = Math.max(0, this.flash - dt * 1.4);
    this.toastT = Math.max(0, this.toastT - dt);

    /* Wind: two slow sines plus occasional gusts. Slow enough to read and
       plan around - a wind you cannot predict is just noise. */
    var base = Math.sin(this.t * 0.33) * 52 + Math.sin(this.t * 0.81 + 1.2) * 30;
    this.gustIn -= dt;
    if (this.gustIn <= 0) {
      this.gust = (this.rnd() > 0.5 ? 1 : -1) * (70 + this.rnd() * 60);
      this.gustIn = 5 + this.rnd() * 5;
    }
    this.gust = EF.damp(this.gust, 0, 0.55, dt);
    this.wind = base + this.gust;

    this.drift.update(dt, this.wind);
    this.particles.update(dt, this.wind * 0.3);

    /* basket */
    if (this.axis !== 0) this.target = EF.clamp(this.target + this.axis * 520 * dt, BASKET_HW, 720 - BASKET_HW);
    this.bx = EF.damp(this.bx, this.target, 0.055, dt);

    /* spawning */
    this.spawnIn -= dt;
    if (this.spawnIn <= 0 && this.left > 1.2) {
      this._spawn();
      this.spawnIn = 0.42 + this.rnd() * 0.36;
    }

    /* items */
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      var k = KINDS[it.kind];
      /* Wasps fight the wind and drift toward the basket - they are the one
         thing in the orchard with an opinion. */
      var w = it.kind === 'wasp' ? this.wind * 0.25 + (this.bx - it.x) * 0.5 : this.wind;
      it.vx = EF.damp(it.vx, w, 0.35, dt);
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.rot += it.spin * dt;
      if (it.x < 14) { it.x = 14; it.vx = Math.abs(it.vx) * 0.4; }
      if (it.x > 706) { it.x = 706; it.vx = -Math.abs(it.vx) * 0.4; }

      var mouthTop = BASKET_Y - 12;
      if (it.y + it.r >= mouthTop && it.y - it.r <= BASKET_Y + 18 &&
          Math.abs(it.x - this.bx) <= BASKET_HW + it.r * 0.4) {
        this._catch(it);
        this.items.splice(i--, 1);
        continue;
      }
      if (it.y - it.r > GROUND_Y + 10) {
        /* A miss just lands in the grass. Puff of leaf dust, no penalty. */
        if (k.good) {
          for (var d = 0; d < 5; d++) {
            this.particles.spawn(it.x, GROUND_Y + 6, (this.rnd() - 0.5) * 70, -20 - this.rnd() * 40,
              0.45, 3, P.rgb('leafOchre'), { gravity: 220, drag: 1.4 });
          }
        }
        this.items.splice(i--, 1);
      }
    }

    if (this.left <= 0 && this.items.length === 0) this._finish();
    else if (this.left <= 0) {
      /* let the last few land rather than yanking the round away */
      for (var j = 0; j < this.items.length; j++) this.items[j].vy += 220 * dt;
    }
  };

  Harvest.prototype._finish = function () {
    this.done = true;
    this.result = { fruit: this.fruit, score: this.score, pies: this.pies, recipe: this.recipe.name };
  };

  /* ----------------------------------------------------------- drawing */

  function drawItem(ctx, it, t) {
    var k = KINDS[it.kind];
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot * (it.kind === 'wasp' ? 0.12 : 1));
    var c = P.get(k.col);

    if (it.kind === 'apple') {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(0, 0, k.r, 0, TAU); ctx.fill();
      ctx.fillStyle = P.shade('apple', 0.35, 0.5);
      ctx.beginPath(); ctx.ellipse(-3.5, -4, 3.6, 2.4, -0.6, 0, TAU); ctx.fill();
      ctx.strokeStyle = P.get('barkDark'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -k.r); ctx.lineTo(1.5, -k.r - 5); ctx.stroke();
      ctx.fillStyle = P.get('leafMoss');
      ctx.beginPath(); ctx.ellipse(5, -k.r - 4, 5, 2.6, -0.5, 0, TAU); ctx.fill();

    } else if (it.kind === 'pumpkin') {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(0, 0, k.r, k.r * 0.86, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = P.shade('pumpkin', -0.25, 0.55); ctx.lineWidth = 1.6;
      for (var s = -1; s <= 1; s++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, k.r * (0.32 + s * 0.001) + Math.abs(s) * k.r * 0.26, k.r * 0.84, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.strokeStyle = P.get('mossDeep'); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -k.r * 0.86); ctx.lineTo(0, -k.r - 4); ctx.stroke();

    } else if (it.kind === 'cinnamon') {
      ctx.fillStyle = c;
      EF.roundRect(ctx, -4, -k.r, 8, k.r * 2, 3.4); ctx.fill();
      ctx.strokeStyle = P.shade('cinnamon', -0.3, 0.7); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-1, -k.r + 2); ctx.lineTo(-1, k.r - 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -k.r + 2); ctx.lineTo(2, k.r - 2); ctx.stroke();

    } else if (it.kind === 'honey') {
      ctx.fillStyle = P.rgba('honey', 0.95);
      EF.roundRect(ctx, -k.r * 0.72, -k.r * 0.8, k.r * 1.44, k.r * 1.7, 4); ctx.fill();
      ctx.fillStyle = P.get('barkDark');
      ctx.fillRect(-k.r * 0.8, -k.r - 1, k.r * 1.6, 4.5);
      ctx.fillStyle = P.shade('honey', 0.4, 0.6);
      ctx.beginPath(); ctx.ellipse(-2.5, -1, 2.2, 4, 0, 0, TAU); ctx.fill();

    } else if (it.kind === 'acorn') {
      ctx.fillStyle = P.shade('acorn', 0.18);
      ctx.beginPath(); ctx.ellipse(0, 2, k.r * 0.8, k.r, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = P.get('barkDark');
      ctx.beginPath(); ctx.ellipse(0, -k.r * 0.5, k.r * 0.92, k.r * 0.5, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -k.r * 0.9); ctx.lineTo(0, -k.r - 3);
      ctx.strokeStyle = P.get('barkDark'); ctx.lineWidth = 2; ctx.stroke();

    } else { /* wasp */
      var wob = Math.sin(t * 26 + it.x) * 0.5;
      ctx.fillStyle = P.rgba('cream', 0.42);
      ctx.beginPath(); ctx.ellipse(-4, -6 + wob, 7, 3.4, -0.7, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(4, -6 - wob, 7, 3.4, 0.7, 0, TAU); ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(0, 0, k.r, k.r * 0.68, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = P.get('barkDark');
      ctx.fillRect(-4, -k.r * 0.68, 2.6, k.r * 1.36);
      ctx.fillRect(1.4, -k.r * 0.68, 2.6, k.r * 1.36);
    }
    ctx.restore();
  }

  Harvest.prototype.render = function (ctx) {
    var w = 720, h = 540, t = this.t;

    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 7 * this.shake, (Math.random() - 0.5) * 7 * this.shake);
    }

    Wd.sky(ctx, w, h, t);
    Wd.hills(ctx, w, h, 350);

    /* Orchard row. Seeded, so it is the same orchard every time. */
    var rows = [[70, 0.86, 11], [210, 1.0, 22], [360, 0.92, 33], [510, 1.04, 44], [650, 0.88, 55]];
    for (var i = 0; i < rows.length; i++) {
      Wd.tree(ctx, rows[i][0], GROUND_Y + 8, rows[i][1], rows[i][2], { fruit: true });
    }

    Wd.ground(ctx, w, h, GROUND_Y);
    Wd.litter(ctx, w, GROUND_Y + 4, h - GROUND_Y - 4, 777, 150);

    this.drift.draw(ctx, 0.55);

    for (i = 0; i < this.items.length; i++) drawItem(ctx, this.items[i], t);

    this.particles.draw(ctx);
    this._basket(ctx);

    if (this.flash > 0) {
      ctx.fillStyle = P.rgba('candleGold', 0.24 * this.flash);
      ctx.fillRect(0, 0, w, h);
    }

    P.grain(ctx, w, h);
    P.vignette(ctx, w, h, 0.30);
    ctx.restore();

    this._card(ctx);
    this._windGauge(ctx);
    this._timer(ctx);

    if (this.toastT > 0) {
      var a = EF.clamp(this.toastT, 0, 1);
      EF.text(ctx, this.toast, w * 0.5, GROUND_Y - 56, 21,
        { color: P.rgba('cream', a), halo: P.rgba('vignette', 0.5 * a) });
    }
  };

  Harvest.prototype._basket = function (ctx) {
    var x = this.bx, y = BASKET_Y;
    var sq = 1 + this.pop * 0.16;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sq, 2 - sq);

    ctx.fillStyle = P.shade('cinnamon', -0.15);
    ctx.beginPath();
    ctx.moveTo(-BASKET_HW, -12);
    ctx.lineTo(BASKET_HW, -12);
    ctx.lineTo(BASKET_HW * 0.74, 24);
    ctx.lineTo(-BASKET_HW * 0.74, 24);
    ctx.closePath();
    ctx.fill();

    /* weave */
    ctx.strokeStyle = P.rgba('barkDark', 0.34);
    ctx.lineWidth = 2;
    for (var r = -6; r < 24; r += 9) {
      ctx.beginPath(); ctx.moveTo(-BASKET_HW * 0.94, r); ctx.lineTo(BASKET_HW * 0.94, r); ctx.stroke();
    }
    for (var c = -3; c <= 3; c++) {
      ctx.beginPath();
      ctx.moveTo(BASKET_HW * c / 3.2, -12);
      ctx.lineTo(BASKET_HW * 0.74 * c / 3.2, 24);
      ctx.stroke();
    }

    /* rim + handle */
    ctx.fillStyle = P.shade('cinnamon', 0.2);
    EF.roundRect(ctx, -BASKET_HW - 3, -17, BASKET_HW * 2 + 6, 9, 4.5); ctx.fill();
    ctx.strokeStyle = P.shade('cinnamon', 0.1);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -14, BASKET_HW * 0.56, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
  };

  /* The recipe card - the round's whole brief, always on screen. */
  Harvest.prototype._card = function (ctx) {
    var x = 14, y = 12, w = 232, h = 96;
    EF.card(ctx, x, y, w, h, 0.9);
    EF.text(ctx, this.recipe.name, x + 12, y + 20, 17,
      { align: 'left', color: P.get('candleGold'), halo: P.rgba('vignette', 0.5) });

    var steps = this.recipe.steps;
    var sx = x + 14, sy = y + 52;
    for (var i = 0; i < steps.length; i++) {
      var cx = sx + i * 27;
      var doneStep = i < this.step;
      var isNext = i === this.step;
      ctx.globalAlpha = doneStep ? 0.45 : 1;
      ctx.fillStyle = P.get(KINDS[steps[i]].col);
      ctx.beginPath(); ctx.arc(cx, sy, 9.5, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      if (doneStep) {
        ctx.strokeStyle = P.get('cream'); ctx.lineWidth = 2.4; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - 4, sy); ctx.lineTo(cx - 1, sy + 3.4); ctx.lineTo(cx + 4.5, sy - 3.6);
        ctx.stroke();
      }
      if (isNext) {
        ctx.strokeStyle = P.rgba('candleGold', 0.6 + 0.4 * Math.sin(this.t * 6));
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(cx, sy, 13.5, 0, TAU); ctx.stroke();
      }
    }
    EF.text(ctx, 'in order  -  x' + this.mult.toFixed(2), x + 12, y + 79, 13,
      { align: 'left', weight: '600', color: P.rgba('cream', 0.85), halo: false });
  };

  Harvest.prototype._windGauge = function (ctx) {
    /* Inset from the right edge, not flush to it: the mute control lives at
       (692, 24) in every scene and the gauge was sitting under it. */
    var x = 720 - 166, y = 12, w = 114, h = 44;
    EF.card(ctx, x, y, w, h, 0.85);
    EF.text(ctx, 'WIND', x + w * 0.5, y + 13, 11,
      { weight: '700', color: P.rgba('cream', 0.7), halo: false });
    var cx = x + w * 0.5, cy = y + 30;
    var mag = EF.clamp(Math.abs(this.wind) / 140, 0, 1);
    var dir = this.wind >= 0 ? 1 : -1;
    ctx.strokeStyle = P.rgba('candleGold', 0.45 + mag * 0.5);
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    var len = 14 + mag * 26;
    ctx.beginPath();
    ctx.moveTo(cx - dir * len * 0.5, cy);
    ctx.lineTo(cx + dir * len * 0.5, cy);
    ctx.lineTo(cx + dir * len * 0.5 - dir * 7, cy - 5);
    ctx.moveTo(cx + dir * len * 0.5, cy);
    ctx.lineTo(cx + dir * len * 0.5 - dir * 7, cy + 5);
    ctx.stroke();
  };

  Harvest.prototype._timer = function (ctx) {
    var w = 260, x = 360 - w * 0.5, y = 14, h = 9;
    EF.roundRect(ctx, x, y, w, h, 4.5);
    ctx.fillStyle = P.rgba('panel', 0.45); ctx.fill();
    var u = this.left / ROUND;
    EF.roundRect(ctx, x, y, Math.max(3, w * u), h, 4.5);
    ctx.fillStyle = P.rgba(u < 0.2 ? 'leafRusset' : 'candleGold', 0.9); ctx.fill();
    EF.text(ctx, Math.ceil(this.left) + 's', 360, y + 28, 14,
      { weight: '700', color: P.rgba('cream', 0.85) });
  };

  Harvest.prototype.snapshot = function () {
    return {
      mode: 'harvest', t: +this.t.toFixed(2), left: +this.left.toFixed(2),
      items: this.items.length, fruit: this.fruit, score: this.score,
      pies: this.pies, step: this.step, mult: +this.mult.toFixed(2),
      wind: Math.round(this.wind), basket: Math.round(this.bx), done: this.done
    };
  };

  Harvest.ROUND = ROUND;
  EF.Harvest = Harvest;

}(window));
