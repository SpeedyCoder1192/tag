# Picks the best chase from each recording and cuts the top N into rec/clips/.
# python3 -I tools/pick.py N
import glob, json, math, os, sys
N = int(sys.argv[1]) if len(sys.argv) > 1 else 5
BEFORE, AFTER = 5.0, 2.7
picks = []
for path in sorted(glob.glob("rec/*-hard.json")):
    rec = json.load(open(path)); F = rec["frames"]
    tags = [i for i in range(1, len(F)) if F[i]["tg"] != F[i - 1]["tg"]]
    cands = []
    for n, i in enumerate(tags):
        t = F[i]["t"]
        prev_t = F[tags[n - 1]]["t"] if n else -1e9
        next_t = F[tags[n + 1]]["t"] if n + 1 < len(tags) else 1e9
        # a clean clip: no other tag in the lead-up or in the aftermath we show
        if t - BEFORE * 1000 < max(prev_t, F[0]["t"]) or next_t < t + AFTER * 1000 or F[-1]["t"] < t + AFTER * 1000:
            continue
        tagger, victim = F[i - 1]["tg"], F[i]["tg"]
        d, vy, prev = [], 0, None
        for f in F:
            if not (t - BEFORE * 1000 <= f["t"] < t): continue
            a = next((p for p in f["p"] if p[0] == tagger), None); b = next((p for p in f["p"] if p[0] == victim), None)
            if not a or not b: continue
            d.append(math.hypot(a[1] - b[1], a[2] - b[2]))
            if prev: vy += abs(a[2] - prev[0]) + abs(b[2] - prev[1])
            prev = (a[2], b[2])
        if not d: continue
        score = sum(1 for x in d if x < 260) / len(d) * 3 + min(vy / 3000, 2)
        cands.append((round(score, 2), t / 1000, path))
    cands.sort(reverse=True)
    picks += [(c, rank) for rank, c in enumerate(cands[:2])]
# every map's best chase first, then second-best ones to fill up
picks = [c for c, rank in sorted(picks, key=lambda x: (x[1], -x[0][0]))]
os.makedirs("rec/clips", exist_ok=True)
for f in glob.glob("rec/clips/*.json"): os.remove(f)
used = {}
for score, t, path in picks[:N]:
    name = os.path.basename(path).split("-")[0]
    used[name] = used.get(name, 0) + 1
    if used[name] > 1: name += str(used[name])
    os.system(f"python3 -I tools/clip.py {path} {t} {BEFORE} {AFTER + 0.4} rec/clips/{name}.json 2")
    print("picked", name, "tag at", round(t, 2), "score", score)
