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
 */
(function (global) {
  'use strict';

  var EF = global.EF;
  var canvas = document.getElementById('game');
  var stage = document.getElementById('stage');
  var app = document.getElementById('app');
  var pad = document.getElementById('pad');
  var btnAction = document.getElementById('pad-action');
  var btnBack = document.getElementById('pad-back');
  var btnMute = document.getElementById('pad-mute');
  var ctx = canvas.getContext('2d', { alpha: false });

  var W = EF.Game.W, H = EF.Game.H;

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

  /* The pad exists in the markup but is display:none until this runs, so a
     desktop renders byte-for-byte the page that was verified 46/46. */
  function applyMode() {
    touch = isTouch();
    var landscape = (global.innerWidth || 1) > (global.innerHeight || 1);
    document.body.classList.toggle('touch', touch);
    document.body.classList.toggle('landscape', touch && landscape);
    return landscape;
  }

  /* ---------------- fit the logical canvas into the stage ------------ */

  /* How much of the screen the pad is allowed to take. The scene is a fixed
     720x540 logical space, so on a phone the canvas is already as wide (or as
     tall) as it can be without cropping the grove out of frame - what was
     wrong was the 551 px of dead plum left over in portrait, not the canvas.
     These two fractions turn that leftover into the controls.
     The ceilings stop a tall phone from rendering three absurd slabs. */
  var PAD_PORTRAIT = 0.34, PAD_PORTRAIT_MAX = 320;
  var PAD_LANDSCAPE = 0.30, PAD_LANDSCAPE_MAX = 300;

  function fit() {
    var landscape = applyMode();

    /* Desktop keeps its original geometry EXACTLY: measure the stage and let
       flexbox own the layout. Deviating here is how a mobile fix silently
       reshapes the build that was already signed off. */
    if (!touch) {
      pad.style.width = '';
      pad.style.height = '';
      stage.style.width = '';
      stage.style.height = '';
      sizeCanvas(stage.getBoundingClientRect().width, stage.getBoundingClientRect().height);
      return;
    }

    /* On touch, #stage is flex:0 0 auto (CSS) so it no longer eats the line;
       this function is the only place that knows how the space is split, so
       it sizes both boxes itself. Measuring #app minus its safe-area padding
       is what keeps the pad clear of an iOS home indicator. */
    var r = app.getBoundingClientRect();
    var cs = global.getComputedStyle(app);
    var availW = Math.max(1, r.width - num(cs.paddingLeft) - num(cs.paddingRight));
    var availH = Math.max(1, r.height - num(cs.paddingTop) - num(cs.paddingBottom));

    var padW, padH, boxW, boxH;
    if (landscape) {
      padW = Math.min(Math.round(availW * PAD_LANDSCAPE), PAD_LANDSCAPE_MAX);
      padH = availH;
      boxW = availW - padW;
      boxH = availH;
    } else {
      padH = Math.min(Math.round(availH * PAD_PORTRAIT), PAD_PORTRAIT_MAX);
      padW = availW;
      boxW = availW;
      boxH = availH - padH;
    }

    var size = sizeCanvas(boxW, boxH);

    /* Shrink-wrap the stage onto the canvas so the pad sits against the
       artwork instead of across a band of leftover plum. */
    stage.style.width = size.w + 'px';
    stage.style.height = size.h + 'px';
    pad.style.width = Math.round(landscape ? padW : Math.max(padW, size.w)) + 'px';
    pad.style.height = Math.round(padH) + 'px';
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function sizeCanvas(availW, availH) {
    var f = Math.min(Math.max(1, availW) / W, Math.max(1, availH) / H);
    var cssW = Math.round(W * f);
    var cssH = Math.round(H * f);

    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));

    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.imageSmoothingEnabled = true;
    return { w: cssW, h: cssH };
  }

  fit();
  if (coarseMQ) {
    var onCoarse = function () { fit(); syncPad(); };
    if (coarseMQ.addEventListener) coarseMQ.addEventListener('change', onCoarse);
    else if (coarseMQ.addListener) coarseMQ.addListener(onCoarse);
  }
  global.addEventListener('resize', fit, { passive: true });
  global.addEventListener('orientationchange', function () { setTimeout(fit, 120); }, { passive: true });
  if (global.ResizeObserver) {
    try { new global.ResizeObserver(fit).observe(stage); } catch (e) { /* ignore */ }
  }

  /* ---------------- input ------------------------------------------- */

  function toLogical(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left) / Math.max(1, r.width) * W,
      y: (clientY - r.top) / Math.max(1, r.height) * H
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

  /* ---------------- the touch pad ------------------------------------ */

  /* Why these are real <button>s and not more canvas drawing: anything drawn
     inside the canvas scales with the canvas, so a 44 px control in game
     units renders about 24 real pixels on a phone - under the documented
     minimum finger target. The pad lives outside the canvas, in real CSS
     pixels, which is the only way its size is honest.

     Each handler calls exactly the same Game method the keyboard calls, so a
     phone and a desktop cannot drift into two different games. */
  function padPress(fn) {
    return function (e) {
      e.preventDefault();          // no 300 ms tap delay, no synthesised click
      e.stopPropagation();
      armAudio();
      fn();
      syncPad();                   // relabel immediately, don't wait a frame
    };
  }

  /* pointerup, not click: on iOS a click on a button inside a
     touch-action:none ancestor can be swallowed entirely. */
  function bind(btn, fn) {
    if (!btn) return;
    var h = padPress(fn);
    btn.addEventListener('pointerup', h, { passive: false });
    btn.addEventListener('click', function (e) { e.preventDefault(); });
    /* Engines with no PointerEvent (older WebViews) still need a way in. */
    if (!global.PointerEvent) btn.addEventListener('touchend', h, { passive: false });
  }

  bind(btnAction, function () { game.action(); });
  bind(btnBack, function () { game.back(); });
  bind(btnMute, function () { game.toggleMute(); });

  /* Mirror the game's state onto the three controls. Called every frame, so
     it writes only on change - relabelling a button on every frame trashes
     layout and makes the text flicker under the thumb. */
  var padState = { label: '', action: null, back: null, muted: null };

  function syncPad() {
    if (!touch) return;

    var label = game.actionLabel();
    if (label !== padState.label) { btnAction.textContent = label; padState.label = label; }

    var canAct = game.canAction();
    if (canAct !== padState.action) { btnAction.disabled = !canAct; padState.action = canAct; }

    /* The assertion this whole pad exists for: leaving an activity used to be
       bound to ESC and nothing else, so on a phone the orchard, the yard and
       the grove were one-way doors. */
    var canBack = game.canBack();
    if (canBack !== padState.back) { btnBack.disabled = !canBack; padState.back = canBack; }

    if (game.muted !== padState.muted) {
      btnMute.textContent = game.muted ? 'SOUND OFF' : 'SOUND ON';
      btnMute.setAttribute('aria-pressed', game.muted ? 'true' : 'false');
      padState.muted = game.muted;
    }
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
    syncPad();
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
    version: '1.0.0',

    snapshot: function () { return game.snapshot(); },
    tap: function () { game.action(); },
    tapAt: function (x, y) { game.pointerDown(x, y); },
    moveTo: function (x, y) { game.pointerMove(x, y); },

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
