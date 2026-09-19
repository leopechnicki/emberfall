/* EMBERFALL - audio.
 *
 * Small WebAudio kit, built to be COZY rather than arcade: slow attacks, soft
 * triangle/sine bodies, filtered noise for leaves and wind. Nothing here
 * clicks, buzzes or stings - an arcade "coin" sound would undo the art
 * direction in one frame.
 *
 * Everything is created lazily on the first real user gesture, because browsers
 * will not let an AudioContext start before one. Every call is a no-op if the
 * context never came up, so audio can fail completely and the game is fine.
 */
(function (global) {
  'use strict';

  var EF = global.EF;
  var A = { ctx: null, master: null, muted: false, ready: false };

  A.init = function () {
    if (A.ctx) return;
    var C = global.AudioContext || global.webkitAudioContext;
    if (!C) return;
    try {
      A.ctx = new C();
      A.master = A.ctx.createGain();
      A.master.gain.value = A.muted ? 0 : 0.34;
      A.master.connect(A.ctx.destination);
      A.ready = true;
    } catch (e) { A.ctx = null; A.ready = false; }
  };

  A.resume = function () {
    if (A.ctx && A.ctx.state === 'suspended') { try { A.ctx.resume(); } catch (e) { } }
  };

  A.setMuted = function (m) {
    A.muted = !!m;
    if (A.master) A.master.gain.setTargetAtTime(A.muted ? 0 : 0.34, A.ctx.currentTime, 0.02);
  };

  function tone(freq, dur, type, gain, detune) {
    if (!A.ready || A.muted) return;
    var t0 = A.ctx.currentTime;
    var o = A.ctx.createOscillator();
    var g = A.ctx.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(freq, t0);
    if (detune) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * detune), t0 + dur);
    /* 25 ms attack: the difference between "a bell" and "a beep". */
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(A.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, cutoff, gain, sweep) {
    if (!A.ready || A.muted) return;
    var t0 = A.ctx.currentTime;
    var n = Math.floor(A.ctx.sampleRate * dur);
    var buf = A.ctx.createBuffer(1, n, A.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = A.ctx.createBufferSource();
    src.buffer = buf;
    var f = A.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(cutoff, t0);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * sweep), t0 + dur);
    f.Q.value = 0.8;
    var g = A.ctx.createGain();
    g.gain.setValueAtTime(gain || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t0); src.stop(t0 + dur);
  }

  /* A warm pentatonic ladder - catching the recipe in order walks UP it, so
     the combo is audible before the player reads the multiplier. */
  var LADDER = [392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

  A.chime = function (step) { tone(LADDER[Math.min(LADDER.length - 1, step | 0)], 0.5, 'triangle', 0.18); };
  A.pip = function () { tone(329.63, 0.22, 'sine', 0.12); };
  A.thud = function () { tone(98, 0.26, 'sine', 0.2, 0.55); noise(0.16, 260, 0.08); };
  A.rustle = function () { noise(0.1, 2600 + Math.random() * 1800, 0.045, 0.5); };
  A.gust = function () { noise(1.1, 520, 0.1, 2.6); };
  A.woosh = function () { noise(0.3, 900, 0.09, 2.2); };
  A.hook = function () { tone(261.63, 0.18, 'triangle', 0.14); noise(0.12, 1800, 0.05); };
  A.win = function () {
    tone(523.25, 0.7, 'triangle', 0.16);
    setTimeout(function () { tone(659.25, 0.7, 'triangle', 0.15); }, 110);
    setTimeout(function () { tone(783.99, 0.9, 'triangle', 0.14); }, 230);
  };
  A.light = function () {
    tone(196, 1.1, 'sine', 0.16);
    tone(392, 1.4, 'triangle', 0.10);
    setTimeout(function () { tone(587.33, 1.2, 'sine', 0.09); }, 180);
  };

  EF.Audio = A;

}(window));
