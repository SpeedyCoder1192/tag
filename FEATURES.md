# Features

Everything this mod adds on top of the original TAG. Kept up to date as things are added.

## Players

- **CPU players** — 0 to 5 bots, set in the CPU PLAYERS box on the player screen.
  - Four levels: Easy, Medium, Hard and Impossible. Impossible bots move faster than the
    rules allow.
  - They path-find around each level with the game's own physics (rotated platforms
    included), and chase, flee and juke.
  - Hard bots moonwalk too.
- **Up to 6 players** — MAX in the CPU PLAYERS box sets 2 to 6.
  - With 5 or 6 the player screen becomes one row of six real boxes, and players 5 and 6
    are added into the level.
  - They get a P5 / P6 label over them in game.
- **Device test** — runs on first load and suggests a MAX that won't lag on this
  device. RE-TEST runs it again.
- **16 colours** — left and right in the lobby pick from Red, Orange, Yellow, Lime,
  Green, Teal, Cyan, Blue, Navy, Violet, Purple, Pink, Brown, White, Gray and Black.
  Two players can't share a colour. Down leaves your slot.

## Online

- **Host and join** — HOST GAME gives a 5-letter code, and friends type it in to join (up
  to 6 players). It runs over PeerJS, peer to peer.
  - Every device draws the game itself and only gets positions from the host, so it stays
    sharp.
  - The host runs the bots, and guests can bring bots of their own.
- **Ping tags** — everyone's ping shows over their player (can be turned off).
- **"Thy sons change settings?"** — the host decides whether guests can change settings,
  add bots and use the menus.
- **Voice chat** — turn VOICE on in the online box.
  - To talk, hold V (keyboard) or the MIC button (touch), or switch to open mic in settings.
  - A speaker icon shows next to whoever is talking, in game and in the menus, with a big
    one in the lobby.
  - It has its own volume setting.
  - It needs the https address, because browsers only allow the microphone there, so http
    visitors are sent to https automatically.

## Flashbangs

- **Levels 0 to 3**, set with FLASH in the CPU PLAYERS box.
  - **Level 1:** you get flashbanged when you get tagged.
  - **Level 2:** level 1, plus when you're it and get juked (someone jumps over you or
    slips past you), or when you camp one platform for 4 seconds.
  - **Level 3:** all of the above for everyone, plus every double jump.
- **The effect:**
  - A grenade flies in (from the transition video, pre-keyed), Deltarune's "Jarona" plays,
    the bang hits on the white, and the white melts away.
  - Several flashbangs at once stack and play together, each grenade coming from a
    different side.
- **Gentle flashing** (in settings) makes the white dimmer, with no flicker.

## Moves

- **Moonwalk** — while running, double-tap backwards (or flick the stick back twice).
  - You glide backwards still facing forwards, and can't be tagged for half a second.
  - It recharges for 4 seconds, shown as a bar under you.
  - Only runners can do it, not whoever is it.
  - It works in both directions and plays the "hee-hee".

## Meme pop-ups

All of these show for everyone, on every flash level, and sit on top of any flashbang.
The MEME POP-UPS setting turns them off.

- **MJ** — when anyone moonwalks, Michael moonwalks in your face for a second, mirrored
  to face the way they're going.
- **Orange dunk** — when the orange player drops on someone from above:
  - The dunk clip fades in as they come down, timed so the dunk lands as the tag does,
    then gets out of the way fast.
  - If they miss, it just fades away.
- **Among Us kills** — when a tag matches the colours in a kill animation, that kill plays:

  | Tagger | Tagged | Kill |
  |---|---|---|
  | Black | Green | the gun |
  | Red | Green | the knife |
  | Red | Blue | the hands |
  | Purple | White | the tongue blast, with its scream |

- **Laughing cat** — if the one who got killed tags their killer straight back (the very
  next tag), the laughing cat points at them, with the laugh.

## Controls

- **Keyboard** — WASD, the arrow keys, TFGH and IJKL for players 1 to 4. Gamepads work too.
- **Touch** — a joystick and JUMP / OK / MIC buttons.
  - They show up when you touch the screen and hide when you use a keyboard (or force them
    on or off in settings).
  - The pad size and which side the stick is on can be changed.

## Screens

- **Splash** — a replay of one of 5 recorded bot chases (picked at random), drawn by the
  game itself.
  - It slows down and pushes in, freezes on black-and-white anime-style impact frames, and
    then the flashbang hits, with 2 seconds of pure white before a fade.
  - Then come "TAG" and the caption "but it's a shit ton better". Any key or tap skips it,
    and it can be turned off in settings.
- **The panel** — the CPU PLAYERS and ONLINE boxes are docked into the game's own screen,
  in the game's style.
- **Guide** — the ? button opens 8 pages covering everything, with keyboard and touch
  versions of the controls. It opens by itself the first time.
- **Settings** — the gear button. Kept on this device.
  - Intro
  - Effects volume
  - Flashing (full or gentle)
  - Screen shake
  - Meme pop-ups
  - Ping tags
  - Double-tap speed (for moonwalks)
  - Touch pad (auto, on or off)
  - Pad size
  - Stick side
  - Talk mode (hold V or open mic)
  - Voice volume

## The page

- **One HTML file** with every sound, clip and replay embedded. It's hosted on GitHub
  Pages at speedycoder1192.qzz.io/tag/.
- **Cleaned up** — the original page's ads, trackers and referrer tricks are gone. It
  has its own title and icon.
- **Play offline** — the PLAY OFFLINE button (top left of the main menu) saves the whole
  game as one `tag.html`, about 2.8 MB, to open from your files with no internet.
  - It's built in your browser from the live files: this page plus the original game's
    engine, sprites and sounds, all packed in.
  - Everything works except online play and voice chat, which need the website (the
    online box says so).
  - The original host only has the game's own sounds as .ogg, which Safari can't play,
    so those few sounds are silent in Safari (on the website too).
- The game's engine, sprites and levels still load from the original game's host.
