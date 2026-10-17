# TAG — but it's a shit ton better

A mod of the browser game **TAG** (a Construct 2 game) that adds a pile of things on top,
all in one HTML file. Open `index.html` in a browser, or play it on GitHub Pages.

## What's added

- **CPU players** — 0–5 bots, Easy / Medium / Hard / Impossible. They path-find around
  each level using the game's own physics, chase, flee, juke and moonwalk.
- **Up to 6 players** — the game has 4 slots; players 5 and 6 are added on top.
- **Online play** — host a game and share the 5-letter code. Friends' devices run their
  own copy and get positions from the host, so it stays sharp; pings show over players.
  Host decides whether *thy sons* (friends) may change settings.
- **16 colours** — pick with left/right in the lobby (down leaves your slot).
- **Flashbang levels 1–3** — get flashbanged for getting tagged, juked, camping a
  platform, or (on 3) for anything anyone does.
- **Moonwalk** — while running, double-tap backwards: glide back for half a second and
  you can't be tagged. 4 second cooldown.
- **Touch controls** — a joystick and buttons appear when you touch the screen.
- **Splash** — a replay of a real bot chase, a flashbang, and the caption.
- **Easter egg** — be orange and land on someone from above.

## Controls

| | Keyboard | Touch |
|---|---|---|
| Move | WASD / arrows / TFGH / IJKL | joystick |
| Jump | W / Up / T / I | JUMP or stick up |
| Drop through | S / Down | stick down |
| Menus / start | Space, Enter | OK |
| Moonwalk | while running, double-tap backwards | two quick flicks back |

## Building

`index.html` is generated. Edit `src/bot.js` (bots, online, panel, effects) or
`src/splash.js`, then:

```sh
python3 tools/assemble.py index.html
```

`page.html` is the game's own page (cleaned up); everything in `media/` and `rec/clips/`
gets embedded. `tools/record.mjs`, `tools/pick.py` and `tools/clip.py` record bot games
and cut the splash replays (they need Chromium and Node).

## Notes

- The game itself (engine, sprites, levels) still loads from the site the original was
  hosted on (see `<base href>` in `page.html`). If that goes away, this stops working.
- TAG is not my game, and the sounds and clips (flashbang sound, Deltarune's "Jarona",
  the Michael Jackson clip and gif, the dunk video) belong to their owners.
  The caption font is [Fredoka](https://fonts.google.com/specimen/Fredoka) (SIL Open Font License).
