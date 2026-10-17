# Cuts a compact replay clip around one tag: python3 -I clip.py REC.json TAG_SECONDS BEFORE AFTER OUT.json [EVERY_NTH]
import json, sys
rec = json.load(open(sys.argv[1])); tag = float(sys.argv[2]) * 1000
before, after = float(sys.argv[3]) * 1000, float(sys.argv[4]) * 1000
anims = []
def a(name):
    if name not in anims: anims.append(name)
    return anims.index(name)
r = lambda v: round(v)
step = int(sys.argv[6]) if len(sys.argv) > 6 else 1
frames = []
for n, f in enumerate(rec["frames"]):
    if n % step: continue
    if not (tag - before <= f["t"] <= tag + after): continue
    frames.append([
        round((f["t"] - (tag - before)) / 1000, 3),
        [r(f["cam"][0]), r(f["cam"][1]), f["cam"][2]],
        f["tg"],
        [[p[0], r(p[1]), r(p[2]), r(p[3]), r(p[4]), p[5], a(p[6]), p[7]] for p in f["p"] if p[8]],
        [[r(i[0]), r(i[1]), r(i[2]), r(i[3]), a(i[4]), i[5]] for i in f["ind"] if i[6]],
        [[r(s[0]), r(s[1]), r(s[2]), r(s[3]), s[4], a(s[5]), s[6]] for s in f["st"]],
    ])
clip = {"layout": rec["layout"], "plats": rec["plats"], "anims": anims, "tagAt": before / 1000, "frames": frames}
out = json.dumps(clip, separators=(",", ":"))
open(sys.argv[5], "w").write(out)
print(len(frames), "frames,", len(out) // 1024, "KB, anims:", anims)
