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
  - Everything works in it. Online play and voice chat work too when there's internet
    (friends on the file and on the website can play together).
  - The original host only has the game's own sounds as .ogg, which Safari can't play,
    so those few sounds are silent in Safari (on the website too).
- The game's engine, sprites and levels still load from the original game's host.

## Game modes

A MODE row in the CPU PLAYERS box (the host picks it online, and friends see everything
the host does). `var GAME_MODES = false;` at the top of `src/bot.js` hides the row and
makes every game Classic.

- **Classic** — the game as it is.
- **Hot Potato** — one fuse of 12 to 20 seconds burns while the potato gets passed
  around. Whoever holds it when it runs out explodes and is out, and someone random gets
  the next one. Last one standing wins.
- **Infection** — whoever's caught joins the taggers (with an arrow of their own, a green
  tint, a drunken sway and a limp). Infect everyone to win; anyone left when the timer runs
  out wins for the runners.
- **Freeze Tag** — catches freeze people in place, with an icy tint; a free runner touching
  them thaws them. Anyone left frozen for 10 seconds blinks, then breaks out as a freezer.
  Freezers glow blue and runners glow orange. Freeze everyone to win; runners win if
  anyone's free at the end.
- **Juggernaut** — whoever starts as it is drawn bigger, moves faster and can triple jump
  (hard and impossible bots use it too). Anyone they catch is smashed out. Smash everyone,
  or survive the timer.
- **King of the Hill** — one platform glows gold and moves every 20 seconds. Standing on it
  scores a point a second (shared between everyone on it), but not while you're it. First
  to 25 points, or the most at the end.
- **Reverse Tag** — everyone chases whoever has the arrow, and holding it scores a point a
  second. Touching the holder steals it. First to 25 points, or the most at the end.
- **Blackout** — Classic in the dark, with a soft light around each player. Every tag lights
  the map for a moment and a flashbang lights it up fully. Bots only see who's near them.
- **Teams** — two teams (blue and red glows), picked alternately. The team with the tagger
  chases first: every chaser can catch, and caught runners go grey and stay put. Then
  everyone goes back to the start and the other team chases. Catching more wins, or the
  faster full sweep. The scoreboard shows each team's time or count.
- **Gun Game** — everyone starts red and climbs the palette one colour at a time, with a
  P1 to P6 label over everyone.
  - Everyone has a gun, fired with down (no new keys). Hitting someone moves you up a
    colour and them down one; a touch catch also moves the catcher up.
  - The guns get harder as you climb: rifle, shotgun, lobbed grenade, pistol, then bare
    hands on black.
  - A catch while black takes you back to your own colour, and wins.
  - Any hit, touch or bullet, starts the game's 3-2-1, and nobody can be hit until it's
    over. You can't catch whoever just caught you.
- **Sudden Death** — no timer: the whole game speeds up 15% every 10 seconds until someone
  is caught. They're out, the speed resets and someone random is it. Last one standing.
- **Random** — the game freezes behind a slot machine (rows of **I LOVE GAMBLING** in the
  game's font, a reel of the modes that ticks, slows and lands with a ding), then plays
  whatever it landed on.

Mode catches respect moonwalks, and nobody can moonwalk while caught, frozen or chasing.
