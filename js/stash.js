/* EMBERFALL - SQUIRREL STASH.  STUB, ON PURPOSE.
 *
 * The fourth activity from the design: a memory game with a squirrel you meet
 * around day 5. It is NOT implemented in this vertical slice, and this file
 * exists so that fact is visible in the game instead of only in a document -
 * the valley draws a real signpost for it with a real "day 5" lock, rather
 * than the slice quietly pretending the design has three activities.
 *
 * When it is built, it becomes a module with the same shape as Harvest / Rake
 * / Swing (update, render, pointer, snapshot, done, result) and the signpost
 * stops being locked. Nothing else in the game needs to change.
 */
(function (global) {
  'use strict';

  var EF = global.EF;
  var P = EF.Palette;

  EF.Stash = {
    label: 'Squirrel Stash',
    implemented: false,
    unlocksOnDay: 5,
    blurb: 'A squirrel hides acorns while you watch, then asks you to remember where. Not built yet.',

    /* Drawn by the valley when the player pokes the locked signpost. */
    drawLockedCard: function (ctx, w, h, t) {
      var cw = 380, ch = 132, x = (w - cw) * 0.5, y = h * 0.5 - ch * 0.5;
      EF.card(ctx, x, y, cw, ch, 0.95);
      EF.text(ctx, 'SQUIRREL STASH', w * 0.5, y + 28, 19,
        { color: P.get('candleGold'), halo: P.rgba('vignette', 0.5) });
      EF.text(ctx, 'You meet her on day ' + EF.Stash.unlocksOnDay + '.', w * 0.5, y + 60, 15,
        { weight: '600', color: P.rgba('cream', 0.9), halo: false });
      EF.text(ctx, 'Not built yet - this slice is day 1.', w * 0.5, y + 84, 13,
        { weight: '600', color: P.rgba('cream', 0.6), halo: false });
      var a = 0.4 + 0.3 * Math.sin(t * 3);
      EF.text(ctx, 'tap anywhere to go back', w * 0.5, y + 110, 12,
        { weight: '600', color: P.rgba('cream', a), halo: false });
    }
  };

}(window));
