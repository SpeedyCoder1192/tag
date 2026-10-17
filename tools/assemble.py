# Usage: python3 -I tools/assemble.py OUT.html [caption-font.woff2]
# Builds the single-file game: the cleaned-up page, the splash and the add-ons, with
# every sound, clip, recording and font embedded so nothing extra needs hosting.
# Original game page + splash (sound, replay and caption font embedded) + bots/online script.
import base64, glob, os, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(f"{root}/page.html", encoding="utf-8").read()   # the game's own page, cleaned up
bot = open(f"{root}/src/bot.js", encoding="utf-8").read()
splash = open(f"{root}/src/splash.js", encoding="utf-8").read()
font = sys.argv[2] if len(sys.argv) > 2 else f"{root}/media/fredoka.woff2"
b64 = lambda p: base64.b64encode(open(p, "rb").read()).decode()
# sounds and the transition clip, shared by the splash and the in-game flashbangs
media = ('<script>window.TAG_MEDIA={flashbang:"%s",jarona:"%s",transition:%s,palette:%s,dunk:%s,heehee:"%s",mj:%s,amogus:%s,scream:"%s"};</script>' %
         (b64(f"{root}/media/flashbang.mp3"), b64(f"{root}/media/jarona.mp3"), open(f"{root}/media/grenade.json").read(),
          open(f"{root}/media/palette.json").read(), open(f"{root}/media/dunk.json").read(), b64(f"{root}/media/heehee.mp3"),
          open(f"{root}/media/mj.json").read(), open(f"{root}/media/amogus.json").read(), b64(f"{root}/media/scream.mp3")))
# the laughing cat, once its files are in
if os.path.exists(f"{root}/media/cat.json") and os.path.exists(f"{root}/media/laugh.mp3"):
    media = media.replace("};</script>", ',cat:%s,laugh:"%s"};</script>' % (open(f"{root}/media/cat.json").read(), b64(f"{root}/media/laugh.mp3")))
for key, value in (("__CAPTION_FONT__", b64(font)),
                   ("__REPLAYS__", "[" + ",".join(open(c).read() for c in sorted(glob.glob(f"{root}/rec/clips/*.json"))) + "]")):
    assert splash.count(key) == 1, key
    splash = splash.replace(key, value)
if os.environ.get("TEST"):
    bot = bot.replace("/*TEST_EXPORTS*/", "window.__fb = fb; window.__flashbang = flashbang; window.__settings = settings; window.__paints = function () { return paints; }; window.__vkey = virtualKey; window.__touch = touch; window.__dunk = dunk; window.__mw = mw; window.__mj = mj; window.__kill = kill; window.__killTag = killTag; window.__voice = voice; window.__prefs = prefs; window.__mode = function () { return mode; }; window.__endMode = endMode;")
    # test builds only: #at=SECONDS freezes the splash on that moment, #clip=N picks the clip
    splash = splash.replace("/*TEST_HOOK*/", 'var m = /at=([0-9.]+)/.exec(location.hash); if (m) { t = +m[1]; dt = 1 / 60; }')
    splash = splash.replace("var REPLAY = REPLAYS[Math.floor(Math.random() * REPLAYS.length)];",
        "var REPLAY = REPLAYS[(/clip=(\\d)/.exec(location.hash) || [0, Math.floor(Math.random() * REPLAYS.length)])[1]];")
out = src.replace("<body>", "<body>\n" + media + "\n<script>\n" + splash + "</script>", 1)
out = out.replace("</body></html>", "<script>\n" + bot + "</script>\n</body></html>")
open(sys.argv[1], "w", encoding="utf-8").write(out)
print(sys.argv[1], len(out) // 1024, "KB")
