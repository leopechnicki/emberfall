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

On a phone a control pad appears below (portrait) or beside (landscape) the
scene. It is not decoration: the scene is a fixed 720x540 logical space, so a
phone leaves ~551 px of letterbox that used to be dead. The pad turns that
into thumb-sized controls in real CSS pixels, because anything drawn *inside*
the canvas scales with the canvas and a 44 px control in game units renders
about 24 real pixels on a phone.

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
npm run test:verify  # 46 checks: the full day on desktop, art + palette audit
npm run test:mobile  # 44 checks: real touch on a 390x844 and 844x390 phone
npm run test:ci      # both
```

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
