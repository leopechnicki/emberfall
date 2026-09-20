# EMBERFALL

A cozy autumn game. Thirty days of autumn in one valley: gather fruit in the
orchard, rake leaves into candle wax, swing the vine grove, and light the
village lanterns at dusk.

**Play: https://leopechnicki.github.io/emberfall/**

Zero dependencies, zero build step. Double-click `index.html` and it runs.

## Controls

|            | Desktop                  | Phone                        |
|------------|--------------------------|------------------------------|
| Aim        | mouse move / arrows, WASD| drag on the canvas           |
| Act        | tap the canvas / Space   | tap the canvas / **ACTION**  |
| Leave      | Esc                      | **BACK**                     |
| Mute       | M                        | **SOUND**                    |

On a phone the canvas **is** the viewport. The scene is authored in a fixed
720x540 logical space, but the leftover on a taller screen is not letterbox
and not a DOM pad - it is more world: `main.js` measures it into `EF.bleed`
and the backdrop primitives paint it, so the sky and the ground simply
extend. The two controls that need a finger, `BACK` and the primary `ACTION`,
are painted onto that world at a fixed CSS-pixel size (`EF.px`), because
anything sized in game units scales with the canvas and a 44-unit control
renders about 24 real pixels on a phone.

Each scene with a sky in it also *composes* differently in portrait: the
horizon goes near the top and the scene runs toward the player with a
perspective scale, rather than sitting in a 720x540 strip pinned to the
bottom of a tall canvas. Desktop and landscape keep the authored composition
exactly - see `test:framing` below, which asserts both halves of that.

`BACK` is the one that mattered most. Leaving an activity was once bound to
`Esc` and nothing else, so on a phone the orchard, the yard and the grove were
one-way doors: play to the end or reload. `Esc` and `BACK` now both call the
same `Game.back()`, so the two inputs cannot drift apart.

## Structure

The game hangs off one global, `window.EF`, and loads as plain scripts in
dependency order - ES modules are CORS-blocked on `file://`, and
"double-click and it plays" is a requirement here.

```
palette  every colour, and the day/night mix
utils    clamp / damp / rng / store / particles / text + panels
world    the valley's drawing kit (sky, trees, lanterns, the keeper)
audio    the small WebAudio kit
harvest / rake / swing / stash    the activities
game     the valley, the day, the tally, dusk
main     canvas fitting, input, the touch pad, the loop
```

## Tests

```bash
npm install          # playwright only, for the harnesses
npm run test:verify   # 46 checks: the full day on desktop, art + palette audit
npm run test:mobile   # 45 checks: real touch on a 390x844 and 844x390 phone
npm run test:framing  # 52 checks: how much of the phone the GAME actually fills
npm run test:ci       # all three
```

CI runs `test:framing` and `test:mobile` as blocking gates on every push,
and `test:verify` as a reported, non-gating job: it plays a whole day in real
time and its grove traversal is flaky on shared runners because the test
driver polls the pendulum over CDP and releases the vine when it notices.
That is a property of the driver, not of the game - see the comment at the
top of `.github/workflows/ci.yml`. It is reliable locally, which is where it
is expected to be green.

`test:framing` is the one that exists because the same complaint came back
twice. It measures the horizon's y position **in the rendered frame** - it
reads no constant out of the source, so `HORIZON = 330` cannot satisfy it -
and requires the playable scene band to be at least 55% of a 390x844 screen
with sky at most 35%. It also asserts the desktop and landscape layouts are
still the authored constants, exactly, and refuses to report a number for a
frame it cannot honestly measure (see `test/framelib.mjs` on why a night
frame is one of those). Every run writes `*_overlay.png` with the detected
horizon drawn on the frame, so the detector's opinion is checkable by eye.

Both suites drive real Google Chrome (`channel: 'chrome'`) and report the
channel rather than silently falling back, so a green run means something.
The mobile suite dispatches genuine touch events through CDP - hand-built
`PointerEvent`s are non-primary and `main.js` is right to drop them.

Neither suite fabricates an outcome: the test hooks (`endHarvest`, `fillRake`,
`skipSwing`) run the game's own code paths, and the swing traversal check
waits on the game's own arrival flag rather than on the rounded progress bar.

## Deploy

GitHub Pages, from `main` at the repo root. Static files, no build. Every
asset reference is relative because Pages serves from the `/emberfall/`
subpath - a leading-slash path would 404 in production while working from
`file://`.

## Licence

MIT - see `LICENSE`.
