/* EMBERFALL - bootstrap: canvas fitting, input, main loop.
 *
 * Same shape as SKYHOOK's js/main.js, and for the same reasons: the game owns
 * the simulation, this file owns the browser. Anything here is about pixels,
 * pointers, keys or the tab being hidden - never about autumn.
 *
 * Two differences from Skyhook, both forced by this game's verbs:
 *   1. Pointer MOVE matters. Skyhook is one-touch; Emberfall drags a basket
 *      and sweeps a rake, so move events are gameplay input, not hover fluff.
 *   2. There is a keyboard axis (arrows / WASD). The basket and the rake are
 *      positional, and a game about a cozy afternoon should not require a
 *      mouse to play.
 *
 * The touch pad used to be three real DOM <button>s living in the 551 px of
 * dead page below a letterboxed 4:3 canvas. Klaudia rejected that build by
 * name: the game on a tiny screen, buttons eating the rest, and it read as
 * AI-generated chrome bolted onto a picture. Both problems had the same
 * root cause - the canvas was NOT the screen, so something else had to be.
 *
 * Now it is. The canvas element is sized to the whole viewport; the extra
 * space beyond the fixed 720x540 scene is real drawn world (EF.bleed, see
 * utils.js), and the two controls that need a finger - BACK and the primary
 * ACTION - are painted directly onto that world at a fixed CSS-pixel size
 * (EF.px) instead of living in the DOM. Nothing overlays the play area:
 * there is no play area distinct from the canvas any more.
 */
(function (global) {
  'use strict';

  var EF = global.EF;
  var canvas = document.getElementById('game');
  var stage = document.getElementById('stage');
  var app = document.getElementById('app');
  var ctx = canvas.getContext('2d', { alpha: false });

  var W = EF.Game.W, H = EF.Game.H;
  var P = EF.Palette;

  /* ?seed=123 replays a day exactly - the orchard, the yard and the grove are
     all seeded from it. Handy when a screenshot or a bug needs to be the same
     twice. */
  var seedParam = null;
  try {
    var m = /[?&]seed=(-?\d+)/.exec(global.location.search || '');
    if (m) seedParam = parseInt(m[1], 10);
  } catch (e) { /* ignore */ }

  var game = new EF.Game(seedParam);

  /* ---------------- touch or not ------------------------------------- */

  /* A coarse pointer is the honest test for "this is a finger", not a user
     agent string and not screen width: a 390 px browser window on a desktop
     still has a mouse, and a 1024 px tablet still does not.
     'ontouchstart' is the fallback for engines without matchMedia.
     Re-evaluated on change so a hybrid laptop that grows a touchscreen, or a
     devtools device-emulation toggle, lands in the right layout. */
  var coarseMQ = null;
  try { coarseMQ = global.matchMedia('(pointer: coarse)'); } catch (e) { coarseMQ = null; }

  function isTouch() {
    if (coarseMQ) return coarseMQ.matches;
    return ('ontouchstart' in global) || (global.navigator || {}).maxTouchPoints > 0;
  }

  var touch = false;

  function applyMode() {
    touch = isTouch();
    var landscape = (global.innerWidth || 1) > (global.innerHeight || 1);
    document.body.classList.toggle('touch', touch);
    document.body.classList.toggle('landscape', touch && landscape);
    /* The renderer draws its own footer hint and needs to know whether this
       device has an Esc key - game.js reads EF.touch to choose between
       'ESC - back to the valley' and 'BACK - to the valley'. */
    EF.touch = touch;
    return landscape;
  }

  /* ---------------- fit the canvas to the whole viewport -------------- */

  /* How much of the bled world at the bottom (portrait) or side (landscape)
     the on-canvas pad reserves for itself, in real CSS pixels. Small on
     purpose: the pad is two buttons, not a console, and every pixel not
     spent on it is more valley visible on the phone that rejected the old
     build for showing too little of it. */
  var FOOTER_CSS = 108;    // portrait: reserved strip along the true bottom
  var GUTTER_CSS = 128;    // landscape: reserved strip along the true right edge
  var BTN_MARGIN = 14;
  var BTN_GAP = 12;
  var BTN_H = 60;          // > the 44 px WCAG 2.5.5 floor, sized for a thumb
  var BACK_W = 84;

  function fit() {
    var landscape = applyMode();

    /* Desktop keeps its original geometry EXACTLY: measure the stage and let
       flexbox own the layout, no bleed, no on-canvas pad. Deviating here is
       how a mobile fix silently reshapes the build that was already signed
       off. */
    if (!touch) {
      EF.bleed = { x: 0, top: 0, bottom: 0 };
      padGeom = null;
      stage.style.width = '';
      stage.style.height = '';
      var r0 = stage.getBoundingClientRect();
      /* Contain-fit at the scene's own 720x540 aspect - the canvas is a
         letterboxed box centred in #stage by #stage's own flex centring,
         same as it always was. This is the one place that still does that;
         everywhere else (touch) the canvas is simply the whole viewport. */
      var f0 = Math.min(Math.max(1, r0.width) / W, Math.max(1, r0.height) / H);
      sizeCanvas(Math.round(W * f0), Math.round(H * f0));
      return;
    }

    /* On touch the canvas IS the viewport - #stage simply matches #app's
       content box, safe-area insets already excluded by the CSS padding on
       #app, so the pad never lands under a notch or the home indicator. */
    var r = app.getBoundingClientRect();
    var cs = global.getComputedStyle(app);
    var availW = Math.max(1, r.width - num(cs.paddingLeft) - num(cs.paddingRight));
    var availH = Math.max(1, r.height - num(cs.paddingTop) - num(cs.paddingBottom));

    stage.style.width = availW + 'px';
    stage.style.height = availH + 'px';

    /* Portrait fits the scene's WIDTH to the screen (it already was the
       screen's width at 4:3) and lets the extra HEIGHT become bled world
       plus the footer. Landscape fits the scene's HEIGHT and bleeds width
       left+right instead. Either way the canvas below ends up exactly
       availW x availH - never less. */
    var f = landscape ? (availH / H) : (availW / W);
    f = Math.max(0.01, f);
    EF.cssPerUnit = f;

    if (landscape) {
      var totalLogicalW = availW / f;
      EF.bleed = { x: Math.max(0, (totalLogicalW - W) / 2), top: 0, bottom: 0 };
    } else {
      var totalLogicalH = availH / f;
      var footer = Math.min(EF.px(FOOTER_CSS), Math.max(0, totalLogicalH - H));
      var top = Math.max(0, totalLogicalH - H - footer);
      EF.bleed = { x: 0, top: top, bottom: footer };
    }

    sizeCanvas(availW, availH);
    computePad(landscape);
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function sizeCanvas(cssW, cssH) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.style.width = Math.round(cssW) + 'px';
    canvas.style.height = Math.round(cssH) + 'px';
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));

    var b = EF.bleed;
    var totalW = W + b.x * 2, totalH = H + b.top + b.bottom;
    var sx = canvas.width / totalW, sy = canvas.height / totalH;
    /* Logical (-bleed.x, -bleed.top) is the top-left of the bled canvas, so
       that is what has to land on device pixel (0,0) - see EF.fullRect(). */
    ctx.setTransform(sx, 0, 0, sy, b.x * sx, b.top * sy);
    ctx.imageSmoothingEnabled = true;
  }

  fit();
  if (coarseMQ) {
    var onCoarse = function () { fit(); };
    if (coarseMQ.addEventListener) coarseMQ.addEventListener('change', onCoarse);
    else if (coarseMQ.addListener) coarseMQ.addListener(onCoarse);
  }
  global.addEventListener('resize', fit, { passive: true });
  global.addEventListener('orientationchange', function () { setTimeout(fit, 120); }, { passive: true });
  if (global.ResizeObserver) {
    try { new global.ResizeObserver(fit).observe(stage); } catch (e) { /* ignore */ }
  }

  /* ---------------- input ------------------------------------------- */

  /* Client pixel -> logical game coordinate, in the SAME space every
     hand-placed scene coordinate already lives in: (0,0) is still the top
     of the 720x540 scene even though the canvas now extends above and
     below it, so nothing in game.js / harvest.js / rake.js / swing.js has
     to know bleed exists. */
  function toLogical(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    var b = EF.bleed;
    var totalW = W + b.x * 2, totalH = H + b.top + b.bottom;
    return {
      x: (clientX - r.left) / Math.max(1, r.width) * totalW - b.x,
      y: (clientY - r.top) / Math.max(1, r.height) * totalH - b.top
    };
  }

  var audioArmed = false;
  function armAudio() {
    if (audioArmed) return;
    audioArmed = true;
    EF.Audio.init();
    EF.Audio.setMuted(game.muted);
    EF.Audio.resume();
  }

  function coords(e) {
    if (e.touches && e.touches.length) return { cx: e.touches[0].clientX, cy: e.touches[0].clientY };
    return { cx: e.clientX, cy: e.clientY };
  }

  function onDown(e) {
    if (e.cancelable) e.preventDefault();
    armAudio();
    var c = coords(e);
    var p = toLogical(c.cx, c.cy);

    /* The pad intercepts before the world does - a tap on BACK must never
       also be read as a tap on whatever signpost happens to sit under it. */
    if (touch && padGeom) {
      var hit = hitPad(p.x, p.y);
      if (hit === 'action') { if (game.canAction()) game.action(); return; }
      if (hit === 'back')   { if (game.canBack())   game.back();   return; }
    }
    game.pointerDown(p.x, p.y);
  }

  function onMove(e) {
    var c = coords(e);
    var p = toLogical(c.cx, c.cy);
    game.pointerMove(p.x, p.y);
  }

  /* In the touch fallback the browser synthesises a mousedown after every
     touchstart, so one tap would arrive twice. */
  var lastTouchAt = 0;
  var TOUCH_GHOST_MS = 750;

  if (global.PointerEvent) {
    stage.addEventListener('pointerdown', function (e) {
      if (e.isPrimary === false) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      onDown(e);
    }, { passive: false });
    stage.addEventListener('pointermove', function (e) {
      if (e.isPrimary === false) return;
      onMove(e);
    }, { passive: true });
  } else {
    stage.addEventListener('touchstart', function (e) {
      lastTouchAt = Date.now();
      onDown(e);
    }, { passive: false });
    stage.addEventListener('touchmove', function (e) {
      if (e.cancelable) e.preventDefault();
      onMove(e);
    }, { passive: false });
    stage.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (Date.now() - lastTouchAt < TOUCH_GHOST_MS) return;   // ghost click
      onDown(e);
    }, { passive: false });
    stage.addEventListener('mousemove', onMove, { passive: true });
  }

  /* Stop iOS double-tap zoom / long-press callout over the play area. */
  stage.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
  stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------------- the on-canvas touch pad --------------------------- */

  /* Two buttons, painted straight onto the bled world instead of living in
     the DOM: a wood plank in the same material as the valley's signposts
     (js/world.js:W.sign), not a rounded-rectangle-with-gradient app button -
     that generic shape is a fair part of why the first build "looked
     AI-generated". Sized through EF.px() so a 60 CSS px button is 60 real
     pixels on a phone regardless of how the logical scene is scaled.

     game.js owns what the buttons SAY and whether pressing them does
     anything (actionLabel / canAction / canBack) for exactly the reason its
     own comments give: rendering them here but deciding them there is how a
     label and a behaviour end up agreeing. */
  var padGeom = null;

  function computePad(landscape) {
    var b = EF.bleed;
    var margin = EF.px(BTN_MARGIN), gap = EF.px(BTN_GAP), btnH = EF.px(BTN_H);

    if (!landscape) {
      var backW = EF.px(BACK_W);
      var y = (H + b.bottom) - margin - btnH;
      var actionX = -b.x + margin + backW + gap;
      var actionW = (W + b.x) - margin - actionX;
      padGeom = {
        back:   { x: -b.x + margin, y: y, w: backW, h: btnH },
        action: { x: actionX, y: y, w: Math.max(EF.px(44), actionW), h: btnH }
      };
    } else {
      var gutterCss = b.x * EF.cssPerUnit;
      var btnW = Math.min(EF.px(GUTTER_CSS - BTN_MARGIN * 2), Math.max(EF.px(44), b.x - margin * 2));
      var x = (W + b.x) - margin - btnW;
      var totalH = btnH * 2 + gap;
      var y0 = H * 0.5 - totalH * 0.5;
      padGeom = {
        action: { x: x, y: y0, w: btnW, h: btnH },
        back:   { x: x, y: y0 + btnH + gap, w: btnW, h: btnH }
      };
      if (gutterCss < 44) padGeom = null;   // no honest room for a finger - drop the pad rather than crowd it
    }
  }

  function hitPad(x, y) {
    if (!padGeom) return null;
    var a = padGeom.action;
    if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return 'action';
    var k = padGeom.back;
    if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return 'back';
    return null;
  }

  function padButton(r, label, enabled, primary) {
    var cx = r.x + r.w * 0.5, cy = r.y + r.h * 0.5;
    ctx.save();
    ctx.globalAlpha = enabled ? 1 : 0.4;

    EF.deckle(ctx, r.x, r.y, r.w, r.h, Math.min(2.2, r.h * 0.06));
    if (primary) {
      var g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      g.addColorStop(0, P.get('candleGold'));
      g.addColorStop(1, P.get('ember'));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = P.rgba('bark', 0.94);
    }
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = P.rgba('candleGold', primary ? 0.7 : 0.32);
    ctx.stroke();

    /* one grain line, the same quiet wood-grain language as the signposts */
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = primary ? P.rgba('panel', 0.16) : P.rgba('barkDark', 0.4);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y + r.h * 0.68);
    ctx.lineTo(r.x + r.w, r.y + r.h * 0.72);
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    EF.text(ctx, label, cx, cy, primary ? 15 : 13, {
      weight: '700',
      color: primary ? P.get('panel') : P.rgba('cream', enabled ? 0.92 : 0.55),
      halo: primary ? false : P.rgba('vignette', 0.45)
    });
  }

  function drawPad() {
    if (!touch || !padGeom) return;
    padButton(padGeom.back, 'BACK', game.canBack(), false);
    padButton(padGeom.action, game.actionLabel(), game.canAction(), true);
  }

  /* ---------------- keyboard ----------------------------------------- */

  /* Held keys become an axis rather than a nudge-per-event, so a held arrow
     moves the basket smoothly instead of at the OS key-repeat rate. */
  var held = { left: false, right: false, up: false, down: false };

  function pushAxis() {
    var dx = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    var dy = (held.down ? 1 : 0) - (held.up ? 1 : 0);
    game.setAxis(dx, dy);
  }

  function axisKey(k) {
    if (k === 'ArrowLeft' || k === 'KeyA') return 'left';
    if (k === 'ArrowRight' || k === 'KeyD') return 'right';
    if (k === 'ArrowUp' || k === 'KeyW') return 'up';
    if (k === 'ArrowDown' || k === 'KeyS') return 'down';
    return null;
  }

  global.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    var k = e.code || e.key;
    var ax = axisKey(k);
    if (ax) {
      e.preventDefault();
      if (!held[ax]) { held[ax] = true; pushAxis(); }
      return;
    }
    if (e.repeat) return;

    if (k === 'Space' || k === 'Enter' || k === ' ') {
      e.preventDefault();
      armAudio();
      game.action();
    } else if (k === 'Escape') {
      /* back(), not leaveMode(): game.js defines leaving in ONE place so the
         ESC key and the pad's BACK button cannot drift apart. */
      game.back();
    } else if (k === 'KeyM' || k === 'm') {
      armAudio();
      game.toggleMute();
    } else if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3' || k === 'Digit4') {
      armAudio();
      game.pick(parseInt(k.slice(5), 10) - 1);
    }
  });

  global.addEventListener('keyup', function (e) {
    var ax = axisKey(e.code || e.key);
    if (ax && held[ax]) { held[ax] = false; pushAxis(); }
  });

  /* ---------------- main loop ---------------------------------------- */

  var last = 0;
  var running = true;

  /* Raw elapsed time goes to the game, which owns the clamp. Inventing a
     1/60 dt after a stall is how a backgrounded tab comes back in slow motion
     or three seconds into the future. */
  function frame(ts) {
    global.requestAnimationFrame(frame);
    if (!last) { last = ts; return; }
    var dt = (ts - last) / 1000;
    last = ts;
    if (running) game.update(dt);
    game.render(ctx);
    drawPad();
  }

  /* Backgrounding is an interruption, not a pause button: the orchard timer
     should not run down inside a phone call. */
  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    last = 0;
    if (document.hidden) {
      game.pause();
      if (EF.Audio.ctx) { try { EF.Audio.ctx.suspend(); } catch (e) { /* ignore */ } }
    } else {
      game.resume();
      if (audioArmed) EF.Audio.resume();
    }
  });

  global.addEventListener('blur', function () { last = 0; }, { passive: true });

  global.requestAnimationFrame(frame);

  /* ---------------- test / debug surface ------------------------------
     Everything below drives the game through its REAL code paths. Nothing
     here fabricates a result: endHarvest runs the clock out, fillRake banks
     leaves through the same _bank the rake calls, skipSwing arrives at the
     goal through the same arrival check. A test hook that invents an outcome
     proves only that the hook works. */
  global.__EMBERFALL = {
    game: game,
    canvas: canvas,
    stage: stage,
    fit: fit,
    version: '2.0.0',

    snapshot: function () { return game.snapshot(); },
    tap: function () { game.action(); },
    tapAt: function (x, y) { game.pointerDown(x, y); },
    moveTo: function (x, y) { game.pointerMove(x, y); },

    /* For tests: the pad's current geometry and a tap dispatched through the
       real hitPad()/onDown() decision, not a shortcut that skips it. */
    padGeom: function () { return padGeom; },
    tapClient: function (cx, cy) { onDown({ clientX: cx, clientY: cy, cancelable: false }); },

    /* Jump straight to a scene. For screenshots and for starting a test in
       the middle of the day without playing the first half of it. */
    goTo: function (state) { game._enter(state); },

    /* Run the orchard clock out. The round then finishes itself the normal
       way, on the next update, via Harvest._finish. */
    endHarvest: function () {
      if (game.state !== 'harvest' || !game.mode) return false;
      game.mode.left = 0;
      game.mode.items.length = 0;
      return true;
    },
    /* Bank the rest of the pile through the real banking path. */
    fillRake: function (n) {
      if (game.state !== 'rake' || !game.mode) return 0;
      return game.mode.fill(n);
    },
    /* Arrive at the high orchard through the real arrival check. */
    skipSwing: function () {
      if (game.state !== 'swing' || !game.mode) return false;
      game.mode.skipToGoal();
      return true;
    }
  };

}(window));
