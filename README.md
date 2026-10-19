# TAG — but it's a shit ton better

A mod of the browser game **TAG** (a Construct 2 game) that adds a pile of things on top,
all in one HTML file. Open `index.html` in a browser, or play it on GitHub Pages.

## What's added

The short version is below. [FEATURES.md](FEATURES.md) has the full list.

- **CPU players** — 0–5 bots, Easy / Medium / Hard / Impossible. They path-find around
  each level using the game's own physics, chase, flee, juke and moonwalk.
- **Up to 6 players** — the game has 4 slots; with a max of 5 or 6 the player screen
  becomes one row of six boxes, and players 5 and 6 are added into the level on top.
- **Online play** — host a game and share the 5-letter code. Friends' devices run their
  own copy and get positions from the host, so it stays sharp; pings show over players.
  Host decides whether *thy sons* (friends) may change settings.
- **Voice chat** — turn VOICE on in the online box and hold **V** (or **MIC** on touch) to
  talk, or switch to open mic in settings. A speaker shows next to whoever's talking.
  Needs the https:// address (browsers only allow microphones there).
- **16 colours** — pick with left/right in the lobby (down leaves your slot).
- **Flashbang levels 1–3** — get flashbanged for getting tagged, juked, camping a
  platform, or (on 3) for anything anyone does.
- **Moonwalk** — while running, double-tap backwards: glide back for half a second and
  you can't be tagged. 4 second cooldown.
- **Touch controls** — a joystick and buttons appear when you touch the screen.
- **Play offline** — the button at the top left of the main menu saves the whole game
  as one file that runs with no internet (everything but online play).
- **Splash** — a replay of a real bot chase, a flashbang, and the caption.
- **How to play** — the **?** button opens a guide to everything, with keyboard and
  touch versions of the controls. It opens by itself the first time.
- **Settings** — the gear button: intro, effects volume, gentle flashing (dimmer white,
  no flicker), screen shake, the meme pop-ups, ping tags, double-tap speed, and the
  touch pad (auto/on/off, size, which side the stick is on). Kept per device.
- **Game modes** (switched off for now) — 11 modes, from Hot Potato and Freeze Tag to Gun
  Game and Random. Set `GAME_MODES = true` at the top of `src/bot.js` to turn them on.
  See [FEATURES.md](FEATURES.md).
- **Easter eggs** — be orange and land on someone from above. Or catch someone in the right
  colours for an Among Us kill, then get them back.

## Controls

| | Keyboard | Touch |
|---|---|---|
| Move | WASD / arrows / TFGH / IJKL | joystick |
| Jump | W / Up / T / I | JUMP or stick up |
| Drop through | S / Down | stick down |
| Menus / start | Space, Enter | OK |
| Moonwalk | while running, double-tap backwards | two quick flicks back |
| Talk (voice chat) | hold V | hold MIC |

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
  hosted on (see `<base href>` in `page.html`). If that goes away, this stops working,
  but offline copies saved with PLAY OFFLINE keep working.
- TAG is not my game, and the sounds and clips (flashbang sound, Deltarune's "Jarona",
  the Michael Jackson clip and gif, the dunk video, the Among Us kill animations and
  sound, the laughing cat) belong to their owners.
  The caption font is [Fredoka](https://fonts.google.com/specimen/Fredoka) (SIL Open Font License).
