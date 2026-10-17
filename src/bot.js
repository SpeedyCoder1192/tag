// ---- CPU players, extra slots and online play ----
// Bots drive players through the game's own "Input" function, using input IDs that
// no keyboard or gamepad maps to, so they never fight a human for keys.
(function () {
	"use strict";

	var BOT_IDS = [9, 10, 11, 15, 16];
	var MAX_PLAYERS = 6;   // the game has 4 built-in slots; players 5 and 6 are added on top
	var T_SLOT = 9, T_PLAYER = 18, T_FAST = 22, T_BOUNCE = 36;
	var STEP = 1 / 60;
	var G = 2000, MAX_FALL = 1000, ACC = 1500, DEC = 1500;

	var LEVELS = {
		easy:   { react: 0.40, replan: 0.9,  miss: 0.30, hesitate: 0.35, predict: false, smartFlee: false, juke: false },
		medium: { react: 0.18, replan: 0.45, miss: 0.08, hesitate: 0.08, predict: false, smartFlee: true,  juke: false },
		hard:   { react: 0.03, replan: 0.2,  miss: 0,    hesitate: 0,    predict: true,  smartFlee: true,  juke: true, moonwalk: true },
		// no reaction time, replans constantly, and moves 15% faster than the rules allow
		impossible: { react: 0, replan: 0.1, miss: 0,    hesitate: 0,    predict: true,  smartFlee: true,  juke: true, moonwalk: true, boost: 1.15 }
	};

	var settings = { count: 1, level: "medium", limit: 4, flash: 0, sons: 0 };
	try {
		var saved = JSON.parse(localStorage.getItem("tagBots"));
		if (saved && saved.count >= 0 && saved.count <= BOT_IDS.length && LEVELS[saved.level]) {
			settings.count = saved.count;
			settings.level = saved.level;
			if (saved.limit >= 2 && saved.limit <= MAX_PLAYERS) settings.limit = saved.limit;
			settings.limitPicked = !!saved.limitPicked;
			settings.flash = saved.flash >= 0 && saved.flash <= 3 ? saved.flash : 0;
			settings.sons = saved.sons ? 1 : 0;
		}
	} catch (e) {}

	function saveSettings() {
		try { localStorage.setItem("tagBots", JSON.stringify(settings)); } catch (e) {}
	}

	var rt = null, vars = {}, world = null, bots = {}, history = [], clock = 0;

	function gvar(name) {
		if (!vars[name]) {
			for (var i = 0; i < rt.all_global_vars.length; i++)
				if (rt.all_global_vars[i].name === name) vars[name] = rt.all_global_vars[i];
		}
		return vars[name] ? vars[name].data : undefined;
	}

	function instances(typeIndex) {
		var t = rt.types_by_index[typeIndex];
		return t ? t.instances : [];
	}

	function input(id, what) {
		// a friend's bots run on their own device and send their key presses to the host
		if (net.role === "guest") return guestBotInput(id, what);
		window.c2_callFunction("Input", [id, what]);
	}

	// ---------- level geometry ----------

	function buildWorld() {
		var players = instances(T_PLAYER);
		if (!players.length) return null;
		var p = players[0];
		// unrotated collision box (players tilt on slopes, so their live bbox isn't reliable)
		var box = { l: -p.width / 2, r: p.width / 2, t: -p.height * 0.47, b: p.height / 2 };

		var solids = [], thrus = [], rects = [];
		rt.types_by_index.forEach(function (type, ti) {
			if (type.is_family) return;
			type.instances.forEach(function (inst) {
				if (!inst.extra || inst.extra.isPlatformBehavior) return;
				var solid = !!inst.extra.solidEnabled, thru = !solid && !!inst.extra.jumpthruEnabled;
				if (!solid && !thru) return;
				inst.update_bbox();
				var q = inst.bquad, b = inst.bbox;
				var r = { l: b.left, r: b.right, t: b.top, b: b.bottom, rot: inst.angle !== 0,
					poly: [[q.tlx, q.tly], [q.trx, q.try_], [q.brx, q.bry], [q.blx, q.bly]],
					x1: q.tlx, y1: q.tly, x2: q.trx, y2: q.try_,
					thru: thru, fast: ti === T_FAST, bounce: ti === T_BOUNCE, inst: inst };
				r.slope = r.x2 !== r.x1 ? (r.y2 - r.y1) / (r.x2 - r.x1) : 0;
				if (r.rot) {
					// separating axes are the rectangle's two edge directions
					r.axes = [[q.trx - q.tlx, q.try_ - q.tly], [q.blx - q.tlx, q.bly - q.tly]].map(function (a) {
						var len = Math.hypot(a[0], a[1]), nx = a[0] / len, ny = a[1] / len;
						var d = r.poly.map(function (pt) { return pt[0] * nx + pt[1] * ny; });
						return [nx, ny, Math.min.apply(null, d), Math.max.apply(null, d)];
					});
				}
				(solid ? solids : thrus).push(r);
				rects.push(r);
			});
		});

		var w = { layout: rt.running_layout, box: box, solids: solids, thrus: thrus, count: rects.length,
			surfaces: [], byInst: new Map(), graphs: {}, bottom: rt.running_layout.height + 200 };

		rects.forEach(function (r) {
			// only the top side of roughly level pieces can be stood on
			if (r.x2 - r.x1 < 16 || Math.abs(r.slope) > 1 || Math.min(r.y1, r.y2) <= 0) return;
			var s = { id: w.surfaces.length, rect: r, top: Math.min(r.y1, r.y2),
				l: r.x1 - box.r + 2, r: r.x2 - box.l - 2, fast: r.fast, bounce: r.bounce, thru: r.thru };
			// trim the ends that are blocked by walls
			while (s.l < s.r && overlapSolid(w, s.l, standY(w, s, s.l), r)) s.l += 4;
			while (s.r > s.l && overlapSolid(w, s.r, standY(w, s, s.r), r)) s.r -= 4;
			if (s.r - s.l < 8) return;
			w.surfaces.push(s);
			w.byInst.set(r.inst, s);
		});
		w.byRect = new Map(w.surfaces.map(function (s) { return [s.rect, s]; }));
		return w;
	}

	function lineY(r, x) {
		x = Math.max(r.x1, Math.min(r.x2, x));
		return r.y1 + (x - r.x1) * r.slope;
	}

	// Player centre y when standing on s at x.
	function standY(w, s, x) {
		return Math.min(lineY(s.rect, x + w.box.l), lineY(s.rect, x + w.box.r)) - w.box.b - 0.05;
	}

	function hits(w, x, y, r) {
		var L = x + w.box.l, R = x + w.box.r, T = y + w.box.t, B = y + w.box.b;
		if (R <= r.l || L >= r.r || B <= r.t || T >= r.b) return false;
		if (!r.rot) return true;
		var cx = (L + R) / 2, cy = (T + B) / 2, hw = (R - L) / 2, hh = (B - T) / 2;
		for (var k = 0; k < 2; k++) {
			var a = r.axes[k], c = cx * a[0] + cy * a[1], ext = hw * Math.abs(a[0]) + hh * Math.abs(a[1]);
			if (c + ext <= a[2] || c - ext >= a[3]) return false;
		}
		return true;
	}

	function overlapSolid(w, x, y, except) {
		for (var i = 0; i < w.solids.length; i++)
			if (w.solids[i] !== except && hits(w, x, y, w.solids[i])) return w.solids[i];
		return null;
	}

	// Steps a copy of the Platform behaviour forward until the player lands.
	// Returns { surf, x, t } or null if it never lands on anything we know about.
	function simulate(w, o) {
		var x = o.x, y = o.y, dx = o.dx, dy = o.dy, used = false;
		for (var f = 1; f <= 150; f++) {
			var vmax = o.vmax;
			if (o.fastTop !== undefined && y + w.box.b > o.fastTop - 16) vmax = o.fastV;

			if (o.dj && !used && dy > -60) { dy = -o.jump; used = true; }
			else { dy += G * STEP; if (dy > MAX_FALL) dy = MAX_FALL; }

			if (o.hold === 0) dx = dx > 0 ? Math.max(0, dx - DEC * STEP) : Math.min(0, dx + DEC * STEP);
			else if (o.hold < 0) dx -= (dx > 0 ? ACC + DEC : ACC) * STEP;
			else dx += (dx < 0 ? ACC + DEC : ACC) * STEP;
			if (dx > vmax) dx = vmax; else if (dx < -vmax) dx = -vmax;

			var px = x, py = y;
			x += dx * STEP;
			if (overlapSolid(w, x, y)) {
				// slopes and small ledges get stepped up, like the real behaviour does
				var lift = Math.abs(dx * STEP) + 2, up = 1;
				while (up <= lift && overlapSolid(w, x, y - up)) up++;
				if (up <= lift) y -= up;
				else { x = px; dx = 0; }
			}

			y += dy * STEP;
			if (dy < 0) {
				if (overlapSolid(w, x, y)) { y = py; dy = 0; }
				continue;
			}
			var land = overlapSolid(w, x, y);
			if (!land) {
				for (var i = 0; i < w.thrus.length; i++) {
					var r = w.thrus[i];
					if (hits(w, x, y, r) && !hits(w, x, py, r)) { land = r; break; }
				}
			}
			if (land) {
				var s = w.byRect.get(land);
				if (!s) return null;
				return { surf: s, x: Math.max(s.l, Math.min(s.r, x)), t: f * STEP };
			}
			if (y > w.bottom) return null;
		}
		return null;
	}

	// Every way to get from one surface to another, sampled along each surface
	// and merged into takeoff windows the bot can aim for.
	function buildGraph(w, vmax, doubleJump) {
		var raw = [];
		function add(from, kind, dir, hold, x, res, dj) {
			if (!res || res.surf === from) return;
			raw.push({ from: from.id, to: res.surf.id, kind: kind, dir: dir, hold: hold, dj: !!dj, x: x, landX: res.x, t: res.t });
		}

		w.surfaces.forEach(function (s) {
			var jump = s.bounce ? 1200 : 900;
			var base = { vmax: vmax, fastV: vmax * 2, fastTop: s.fast ? s.top : undefined, jump: jump };
			function sim(x, dy0, dx, dy, hold, extra) {
				var o = Object.assign({}, base, { x: x, y: standY(w, s, x) + dy0, dx: dx, dy: dy, hold: hold }, extra);
				return simulate(w, o);
			}
			for (var x = s.l; x <= s.r + 0.1; x += 16) {
				if (overlapSolid(w, x, standY(w, s, x))) continue;
				[-1, 1].forEach(function (d) {
					add(s, "run", d, d, x, sim(x, 0, d * vmax, -jump, d));
					add(s, "run", d, 0, x, sim(x, 0, d * vmax, -jump, 0));
					if (doubleJump) add(s, "run", d, d, x, sim(x, 0, d * vmax, -jump, d, { dj: true }), true);
				});
				[-1, 0, 1].forEach(function (h) {
					add(s, "stand", 0, h, x, sim(x, 0, 0, -jump, h));
					if (doubleJump) add(s, "stand", 0, h, x, sim(x, 0, 0, -jump, h, { dj: true }), true);
					if (s.thru) add(s, "drop", 0, h, x, sim(x, 2, 0, 0, h));
				});
			}
			// walking off either end
			[[-1, s.l - 1], [1, s.r + 1]].forEach(function (e) {
				var d = e[0];
				[d, 0, -d].forEach(function (h) {
					add(s, "walk", d, h, e[1] - d, sim(e[1], 0, d * vmax, 0, h));
				});
			});
		});

		// merge neighbouring samples that do the same thing into one window
		raw.sort(function (a, b) {
			return a.from - b.from || a.to - b.to || a.kind.localeCompare(b.kind) || a.dir - b.dir ||
				a.hold - b.hold || (a.dj - b.dj) || a.x - b.x;
		});
		var edges = w.surfaces.map(function () { return []; }), cur = null;
		raw.forEach(function (e) {
			if (cur && cur.from === e.from && cur.to === e.to && cur.kind === e.kind && cur.dir === e.dir &&
				cur.hold === e.hold && cur.dj === e.dj && e.x - cur.xb <= 17 && cur.kind !== "walk") {
				cur.xb = e.x; cur.landX += e.landX; cur.t += e.t; cur.n++;
				return;
			}
			cur = { from: e.from, to: e.to, kind: e.kind, dir: e.dir, hold: e.hold, dj: e.dj,
				xa: e.x, xb: e.x, landX: e.landX, t: e.t, n: 1 };
			edges[e.from].push(cur);
		});
		edges.forEach(function (list) {
			list.forEach(function (e) {
				e.landX /= e.n; e.t /= e.n;
				if (e.dir < 0) { var a = e.xa; e.xa = e.xb; e.xb = a; } // xa is always the end you reach first
			});
		});
		return edges;
	}

	function graphFor(vmax) {
		var dj = gvar("doubleJump") === 1;
		var key = vmax + (dj ? "dj" : "");
		if (!world.graphs[key]) world.graphs[key] = buildGraph(world, vmax, dj);
		return world.graphs[key];
	}

	// ---------- path finding ----------

	function walkSpeed(s, vmax) { return s.fast ? vmax * 2 : vmax; }

	// Time to get from x into position to use edge e.
	function approachCost(e, x, v) {
		if (e.kind === "run") {
			var d = e.dir;
			if ((x - e.xa) * d <= 0) return Math.abs(e.xa - x) / v;
			if ((x - e.xb) * d <= 0) return 0.12;
			return (Math.abs(x - e.xa) + 120) / v;
		}
		var lo = Math.min(e.xa, e.xb), hi = Math.max(e.xa, e.xb);
		var dist = x < lo ? lo - x : x > hi ? x - hi : 0;
		return dist / v + (e.kind === "stand" ? 0.2 : e.kind === "drop" ? 0.1 : 0);
	}

	function dijkstra(edges, startSurf, startX, vmax) {
		var n = world.surfaces.length;
		var dist = new Array(n).fill(Infinity), arr = new Array(n), first = new Array(n), done = new Array(n).fill(false);
		dist[startSurf.id] = 0; arr[startSurf.id] = startX;
		for (;;) {
			var u = -1;
			for (var i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
			if (u < 0) break;
			done[u] = true;
			var v = walkSpeed(world.surfaces[u], vmax);
			edges[u].forEach(function (e) {
				var c = dist[u] + approachCost(e, arr[u], v) + e.t;
				if (c < dist[e.to]) {
					dist[e.to] = c; arr[e.to] = e.landX;
					first[e.to] = u === startSurf.id ? e : first[u];
				}
			});
		}
		return { dist: dist, arr: arr, first: first, vmax: vmax };
	}

	function timeTo(paths, s, x) {
		return paths.dist[s.id] + Math.abs(paths.arr[s.id] - x) / walkSpeed(s, paths.vmax);
	}

	// ---------- reading the game ----------

	function floorOf(inst) {
		var plat = inst.behavior_insts[0];
		var f = plat.lastFloorObject;
		if (!f || plat.dy !== 0) return null;
		var s = world.byInst.get(f);
		// lastFloorObject is also set for a frame after bumping a ceiling
		if (!s || Math.abs(inst.y + world.box.b - lineY(s.rect, inst.x)) > 24) return null;
		return s;
	}

	// Surface someone is on, or the one they'll come down on.
	function landingOf(p, predict) {
		if (p.surf) return { surf: p.surf, x: p.x };
		if (predict) {
			var res = simulate(world, { x: p.x, y: p.y, dx: p.dx, dy: p.dy, hold: Math.sign(p.dx), vmax: 400, jump: 900 });
			if (res) return { surf: res.surf, x: res.x };
		}
		var best = null;
		world.surfaces.forEach(function (s) {
			var top = lineY(s.rect, p.x);
			if (top >= p.y + world.box.b - 2 && p.x >= s.l && p.x <= s.r && (!best || top < best.y)) best = { surf: s, y: top };
		});
		return best ? { surf: best.surf, x: p.x } : null;
	}

	function snapshot() {
		var list = instances(T_PLAYER).map(function (inst) {
			var plat = inst.behavior_insts[0];
			return { slot: inst.instance_vars[2], input: inst.instance_vars[4], x: inst.x, y: inst.y,
				dx: plat.dx, dy: plat.dy, surf: floorOf(inst), inst: inst };
		});
		history.push({ time: clock, players: list });
		while (history.length > 2 && history[1].time < clock - 1) history.shift();
		return list;
	}

	// What a bot with this reaction time "sees" right now.
	function perceived(react) {
		for (var i = history.length - 1; i >= 0; i--)
			if (history[i].time <= clock - react) return history[i].players;
		return history[0].players;
	}

	// ---------- the bot ----------

	function Bot(id) {
		this.id = id;
		this.edge = null;        // edge being executed
		this.air = null;         // edge we jumped/fell with
		this.goal = null;
		this.target = -1;        // slot being chased
		this.nextPlan = 0;
		this.planSurf = null;
		this.runup = false;
		this.jumpDelay = -1;
		this.pauseUntil = 0;
		this.nextPause = 2 + Math.random() * 3;
		this.stuck = 0;
		this.lastX = 0;
		this.randomTarget = false;
	}

	Bot.prototype.press = function (dir) {
		if (dir < 0) input(this.id, "left");
		else if (dir > 0) input(this.id, "right");
	};

	Bot.prototype.jump = function () {
		input(this.id, "up");
	};

	// Walk to x and stop there.
	Bot.prototype.walkTo = function (me, x) {
		var d = x - me.x;
		if (Math.abs(d) < 4) return;
		if (Math.sign(me.dx) === Math.sign(d) && me.dx * me.dx / (2 * DEC) >= Math.abs(d)) return;
		this.press(Math.sign(d));
	};

	Bot.prototype.tick = function (me, all, cfg) {
		var tagger = gvar("taggerID");
		var isTagger = me.slot === tagger;
		var vmax = this.vmax = (isTagger ? 450 : 400) * (cfg.boost || 1);
		var seen = perceived(cfg.react);
		var others = seen.filter(function (p) { return p.slot !== me.slot; });
		if (!others.length) return;

		// easy/medium bots zone out now and then
		if (cfg.hesitate > 0 && clock >= this.nextPause) {
			if (Math.random() < cfg.hesitate) this.pauseUntil = clock + 0.2 + Math.random() * 0.35;
			this.nextPause = clock + 1.5 + Math.random() * 2.5;
		}
		if (clock < this.pauseUntil) return;

		if (!me.surf) return this.inAir(me, others);
		this.air = null;

		var edges = graphFor(vmax);

		// stuck against something: hop
		if (Math.abs(me.x - this.lastX) < 0.5 && this.holding) this.stuck += STEP; else this.stuck = 0;
		this.lastX = me.x;
		if (this.stuck > 0.4) { this.stuck = 0; this.jump(); this.nextPlan = 0; return; }

		if (clock >= this.nextPlan || this.planSurf !== me.surf) {
			this.nextPlan = clock + cfg.replan * (0.8 + Math.random() * 0.4);
			this.planSurf = me.surf;
			this.plan(me, others, seen, isTagger, tagger, vmax, edges, cfg);
		}

		this.holding = false;
		if (isTagger) this.chase(me, others, cfg);
		else if (!this.flee(me, seen, tagger, cfg)) this.follow(me, cfg);
	};

	Bot.prototype.plan = function (me, others, seen, isTagger, tagger, vmax, edges, cfg) {
		var mine = dijkstra(edges, me.surf, me.x, vmax);
		var self = this;
		this.paths = mine;

		if (isTagger) {
			// chase whoever is quickest to reach (easy bots sometimes pick someone at random)
			if (cfg.miss > 0.2 && Math.random() < 0.15) this.randomTarget = !this.randomTarget;
			var best = null, bestT = Infinity, current = null;
			others.forEach(function (p) {
				var land = landingOf(p, cfg.predict);
				if (!land) return;
				var t = timeTo(mine, land.surf, land.x);
				if (self.randomTarget) t = Math.random();
				if (p.slot === self.target) current = { land: land, t: t };
				if (t < bestT) { bestT = t; best = { p: p, land: land }; }
			});
			if (!best) { this.goal = null; return; }
			if (current && current.t < bestT * 1.25 + 0.2) best.land = current.land;
			else this.target = best.p.slot;
			this.goal = best.land;
		} else {
			var t = seen.filter(function (p) { return p.slot === tagger; })[0];
			var tl = t && landingOf(t, cfg.predict);
			if (!tl) { this.goal = null; return; }
			if (!cfg.smartFlee) {
				// easy: just head for whichever end of the map is further from the tagger
				var far = world.surfaces.reduce(function (a, s) {
					var sx = t.x < rt.running_layout.width / 2 ? s.r : s.l;
					var d = Math.abs(sx - t.x) + Math.abs(s.top - t.y) * 0.5;
					return d > a.d && mine.dist[s.id] < Infinity ? { d: d, surf: s, x: sx } : a;
				}, { d: -1 });
				this.goal = far.surf ? { surf: far.surf, x: far.x } : null;
			} else {
				// go where the tagger needs the longest to follow, but not through them
				var theirs = dijkstra(graphFor(450), tl.surf, tl.x, 450);
				var bestScore = -Infinity, goal = null, keep = -Infinity, prev = this.goal;
				world.surfaces.forEach(function (s) {
					[s.l + 24, (s.l + s.r) / 2, s.r - 24].forEach(function (x) {
						var my = timeTo(mine, s, x), their = timeTo(theirs, s, x);
						if (my === Infinity) return;
						if (their === Infinity) their = 6;
						var score = Math.min(their, 4) - 0.7 * my;
						if (x < 140 || x > rt.running_layout.width - 140) score -= 0.6; // corners are traps
						// don't all hide in the same spot
						others.forEach(function (o) {
							if (o.slot !== tagger && Math.abs(o.x - x) < 150 && Math.abs(o.y + world.box.b - s.top) < 60) score -= 0.5;
						});
						var e = mine.first[s.id];
						if (e && Math.abs(e.xa - t.x) < 90 && Math.abs(me.surf.top - t.y - world.box.b) < 40) score -= 2;
						if (score > bestScore) { bestScore = score; goal = { surf: s, x: x }; }
						if (prev && prev.surf === s && Math.abs(prev.x - x) < 1) keep = score;
					});
				});
				this.goal = prev && keep > bestScore - 0.25 ? prev : goal;
			}
		}

		this.edge = this.goal && this.goal.surf !== me.surf ? mine.first[this.goal.surf.id] || null : null;
		this.runup = false;
		this.jumpDelay = -1;
	};

	Bot.prototype.chase = function (me, others, cfg) {
		var self = this;
		var t = others.filter(function (p) { return p.slot === self.target; })[0];
		this.direct = false;
		// close enough: go straight for them
		if (t && Math.abs(t.x - me.x) < 160 &&
			(t.surf === me.surf || Math.abs(t.y - me.y) < 40 || (!t.surf && Math.abs(t.x - me.x) < 100 && Math.abs(t.y - me.y) < 160))) {
			var lead = cfg.predict ? t.dx * 0.12 : 0;
			this.holding = true;
			this.direct = true;
			this.press(Math.sign(t.x + lead - me.x) || 1);
			var above = me.y - t.y;
			if (above > 24 && Math.abs(t.x - me.x) < 90 && (t.dy >= -100 || cfg.predict)) this.tryJump(cfg);
			return;
		}
		this.follow(me, cfg);
	};

	// Close-range escape. Returns true if it handled movement itself.
	Bot.prototype.flee = function (me, seen, tagger, cfg) {
		var t = seen.filter(function (p) { return p.slot === tagger; })[0];
		if (!t) return false;
		var dx = me.x - t.x;
		if (Math.abs(dx) > 150 || Math.abs(me.y - t.y) > 60) return false;

		var away = Math.sign(dx) || 1, s = me.surf;
		var end = away < 0 ? s.l : s.r;
		var room = overlapSolid(world, end + away * 24, standY(world, s, end) - 4) ? Math.abs(end - me.x) : Infinity;
		var approaching = Math.sign(t.dx) === -away && Math.abs(t.dx) > 100;

		// about to be caught: moonwalk out of it (it's on a cooldown, the host keeps track)
		if (cfg.moonwalk && Math.abs(dx) < 75 && Math.abs(me.y - t.y) < 40 && (approaching || Math.abs(dx) < 45)) requestMoonwalk(this.id, away);

		this.holding = true;
		if (cfg.juke && room < 160 && Math.abs(dx) < 130 && (approaching || room < 40)) {
			// cornered: go at them and jump over
			this.press(-away);
			if (Math.abs(dx) < 100) this.tryJump(cfg);
			return true;
		}
		if (!cfg.smartFlee || Math.abs(dx) < 90) {
			this.press(away);
			if (room < 30) this.tryJump(cfg);
			return true;
		}
		this.holding = false;
		return false;
	};

	// Follow the planned route towards this.goal.
	Bot.prototype.follow = function (me, cfg) {
		var g = this.goal;
		if (!g) return;
		if (g.surf === me.surf || !this.edge) {
			if (Math.abs(g.x - me.x) > 4) this.holding = true;
			return this.walkTo(me, g.x);
		}
		var e = this.edge, d = e.dir;
		this.holding = true;

		if (e.kind === "walk") return this.press(d);

		if (e.kind === "run") {
			if (this.runup) {
				this.press(-d);
				var room = d > 0 ? me.x - me.surf.l : me.surf.r - me.x;
				if ((e.xa - me.x) * d >= 70 || room < 8) this.runup = false;
				return;
			}
			var fastEnough = me.dx * d >= 0.85 * this.vmax;
			if ((me.x - e.xb) * d > 4 || ((me.x - e.xa) * d > 0 && !fastEnough && (e.xb - me.x) * d < 40)) {
				this.runup = true;
				return this.press(-d);
			}
			this.press(d);
			if ((me.x - e.xa) * d >= -2 && fastEnough) this.tryJump(cfg, e);
			return;
		}

		var mid = (e.xa + e.xb) / 2, half = Math.abs(e.xb - e.xa) / 2 + 3;
		if (Math.abs(me.x - mid) > half) return this.walkTo(me, mid);
		if (e.kind === "drop") { input(this.id, "down"); this.air = e; return; }
		if (Math.abs(me.dx) < 60) this.tryJump(cfg, e);
	};

	Bot.prototype.tryJump = function (cfg, e) {
		// easy/medium bots fumble the timing sometimes
		if (this.jumpDelay < 0 && cfg.miss > 0 && Math.random() < cfg.miss) this.jumpDelay = 3 + Math.floor(Math.random() * 12);
		if (this.jumpDelay > 0) { this.jumpDelay--; return; }
		this.jumpDelay = -1;
		this.jump();
		this.air = e || null;
		this.djDone = false;
	};

	Bot.prototype.inAir = function (me, others) {
		var e = this.air, self = this;
		if (e) {
			this.press(e.hold);
			if (e.dj && !this.djDone && me.dy > -60) { this.jump(); this.djDone = true; }
			return;
		}
		if (this.direct) {
			var t = others.filter(function (p) { return p.slot === self.target; })[0];
			if (t) return this.press(Math.sign(t.x - me.x));
		}
		// no plan (knocked off, walked off): drift towards the goal
		var g = this.goal;
		if (g && Math.abs(g.x - me.x) > 12) this.press(Math.sign(g.x - me.x));
	};


	// ---------- seats ----------
	// Players 1-4 use the game's own lobby slots. Players 5-6 ("extras") only exist
	// here: they're listed in the panel and spawned into the level when it starts.

	var COLORS = ["Red", "Blue", "Yellow", "Purple"];
	var extras = [];   // [{ id, color }]

	function slotOf(id) {
		var s = instances(T_SLOT);
		for (var i = 0; i < s.length; i++) if (s[i].instance_vars[1] === id) return s[i];
		return null;
	}

	function freeSlot() {
		return instances(T_SLOT).some(function (s) { return s.instance_vars[1] === 0; });
	}

	function leaveSlot(slot) {
		slot.instance_vars[1] = 0;
		slot.instance_vars[2] = 0;
	}

	function seated(id) {
		return !!slotOf(id) || extras.some(function (e) { return e.id === id; });
	}

	function seatCount() {
		return instances(T_SLOT).filter(function (s) { return s.instance_vars[1]; }).length + extras.length;
	}

	function addExtra(id) {
		if (extras.length >= MAX_PLAYERS - 4) return false;
		var used = [0, 0, 0, 0];
		instances(T_SLOT).forEach(function (s) { if (s.instance_vars[2]) used[s.instance_vars[2] - 1]++; });
		// extras count a bit more so 5 and 6 don't end up the same colour
		extras.forEach(function (e) { used[COLORS.indexOf(e.color)] += 1.5; });
		var c = used.indexOf(Math.min.apply(null, used));
		extras.push({ id: id, color: COLORS[c] });
		return true;
	}

	function unseat(id) {
		var slot = slotOf(id);
		if (slot) leaveSlot(slot);
		extras = extras.filter(function (e) { return e.id !== id; });
	}

	// Seat a non-keyboard player: a built-in slot if one is free, else an extra one.
	function seat(id) {
		if (seated(id) || seatCount() >= settings.limit) return;
		if (freeSlot()) input(id, "join");
		else addExtra(id);
	}

	// Everyone the host controls without a keyboard: its own bots, then friends' bots.
	function autoIds() {
		var ids = BOT_IDS.slice(0, settings.count);
		net.guests.forEach(function (g) { ids = ids.concat(g.bots); });
		return ids;
	}

	function syncLobby() {
		if (net.role === "guest" || gvar("gameState") !== "Menu" || gvar("currMenu") !== "Players") return;
		var wanted = autoIds();
		var known = wanted.concat(net.guests.map(function (g) { return g.human; }), [TOUCH_ID]);

		// drop seats nobody owns any more (ids 1-8 are keyboards and gamepads)
		instances(T_SLOT).forEach(function (s) {
			var id = s.instance_vars[1];
			if (id > 8 && known.indexOf(id) < 0) leaveSlot(s);
		});
		extras = extras.filter(function (e) { return known.indexOf(e.id) >= 0; });

		// over the limit: send bots home, newest first
		for (var i = wanted.length - 1; i >= 0 && seatCount() > settings.limit; i--) unseat(wanted[i]);

		wanted.forEach(seat);

		// colours of players who've left are free again
		var here = seatedPlayers().map(function (p) { return p.id; });
		Object.keys(paints).forEach(function (id) { if (here.indexOf(+id) < 0) delete paints[id]; });

		// keep a built-in slot open for keyboard players while there's room
		if (!freeSlot() && seatCount() < settings.limit && extras.length < MAX_PLAYERS - 4) {
			var bot = instances(T_SLOT).filter(function (s) { return wanted.indexOf(s.instance_vars[1]) >= 0; }).pop();
			if (bot) { var id = bot.instance_vars[1]; leaveSlot(bot); addExtra(id); }
		}
	}

	function setText(inst, text) {
		if (inst && inst.text !== text) { inst.text = text; inst.text_changed = true; rt.redraw = true; }
	}

	// What a lobby slot shows for players the game itself doesn't know about.
	function slotLabel(id) {
		if (BOT_IDS.indexOf(id) >= 0) return "CPU";
		if (id === TOUCH_ID) return "TOUCH";
		var g = guestOf(id);
		if (!g) return null;
		if (g.bots.indexOf(id) >= 0) return "CPU";
		return g.ping ? g.ping + "ms" : "...";
	}

	function labelSlots() {
		instances(T_SLOT).forEach(function (s, i) {
			var label = net.role === "guest" ? net.labels[i] : slotLabel(s.instance_vars[1]);
			if (label) setText(s, label);
		});
	}

	// ---------- players 5 and 6 ----------

	function spawnPlayer(slot, id, color, x, y) {
		var type = rt.types_by_index[T_PLAYER], layer = rt.getLayerByName("Players");
		if (!layer) return null;
		var p = rt.createInstance(type, layer, x, y);
		if (!p) return null;
		p.instance_vars[1] = "Idle";
		p.instance_vars[2] = slot;
		p.instance_vars[3] = 1;
		p.instance_vars[4] = id;
		p.instance_vars[5] = color;
		p.behavior_insts[0].enableDoubleJump = gvar("doubleJump") === 1;
		p.extra.solidEnabled = gvar("playerCollision") === 1;
		// same "on created" triggers the game's Create Object action fires
		rt.isInOnDestroy++;
		[p].concat(p.siblings || []).forEach(function (i) {
			rt.trigger(Object.getPrototypeOf(i.type.plugin).cnds.OnCreated, i);
		});
		rt.isInOnDestroy--;
		return p;
	}

	var spawnedFor = null;
	function spawnExtras() {
		if (spawnedFor === rt.running_layout || !world) return;
		spawnedFor = rt.running_layout;
		var spots = world.surfaces.filter(function (s) { return s.r - s.l > 120 && s.top > 100; });
		extras.forEach(function (e, k) {
			var s = spots[Math.floor(Math.random() * spots.length)], x = s.l + 40 + Math.random() * (s.r - s.l - 80);
			spawnPlayer(4 + k, e.id, e.color, x, standY(world, s, x));
		});
	}

	// ---------- hooking into the game ----------

	// The impossible level cheats a little: its players get extra speed.
	var boosted = new Map();
	function boost(inst, factor) {
		var plat = inst.behavior_insts[0];
		if (!boosted.has(plat)) {
			var posttick = plat.posttick;
			plat.posttick = function () {
				var f = boosted.get(this), m = this.maxspeed, a = this.acc;
				this.maxspeed = m * f; this.acc = a * f;
				posttick.call(this);
				this.maxspeed = m; this.acc = a;
			};
		}
		boosted.set(plat, factor);
	}

	function ensureWorld(cfg) {
		if (world && clock - (world.checked || 0) < 1) return;
		var fresh = buildWorld();
		if (!world || !fresh || fresh.count !== world.count) {
			world = fresh;
			// build up front; the round starts with a countdown that hides the hitch
			if (world) { graphFor(400 * (cfg.boost || 1)); graphFor(450 * (cfg.boost || 1)); graphFor(450); }
		}
		if (world) world.checked = clock;
	}

	function beforeLogic() {
		clock = performance.now() / 1000;
		if (rt.running_layout !== (world && world.layout)) { world = null; bots = {}; history = []; }
		if (net.role === "guest") return guestBeforeLogic();

		syncLobby();
		moonwalkBefore();
		guestInputs();
		touchInputs();
		if (gvar("gameState") !== "Game" || !instances(T_PLAYER).length) return;

		var cfg = LEVELS[settings.level];
		ensureWorld(cfg);
		if (!world) return;
		spawnExtras();

		var all = snapshot();
		all.forEach(function (me) {
			if (BOT_IDS.indexOf(me.input) >= 0) {
				boost(me.inst, cfg.boost || 1);
				var bot = bots[me.input] || (bots[me.input] = new Bot(me.input));
				bot.tick(me, all, cfg);
			} else if (net.boosts[me.input]) {
				boost(me.inst, net.boosts[me.input]);
			}
		});
	}

	function afterLogic() {
		labelSlots();
		if (net.role !== "guest") moonwalkTick();
		moonVisuals();
		watchFlashbangs();
		if (net.role === "host") hostSend();
		if (net.role === "guest") guestAfterLogic();
	}

	function install() {
		rt = window.cr_getC2Runtime && window.cr_getC2Runtime();
		if (!rt || !rt.running_layout || !window.c2_callFunction || !rt.all_global_vars.length) return setTimeout(install, 200);
		var call = window.c2_callFunction;
		window.c2_callFunction = function (name, params) {
			if (name === "Input" && params && moonInput(params[0], params[1])) return 0;
			return call(name, params);
		};
		var logic = rt.logic;
		rt.logic = function () {
			try { beforeLogic(); } catch (e) { console.error("tag bot:", e); }
			logic.apply(this, arguments);
			try { afterLogic(); } catch (e) { console.error("tag online:", e); }
		};
		["drawGL", "draw"].forEach(function (name) {
			var draw = rt[name];
			rt[name] = function () {
				draw.apply(this, arguments);
				try { drawTags(); drawMoonBars(); } catch (e) {}
			};
		});
		setInterval(updatePanel, 200);
		if (!net.test) setTimeout(deviceTest, 1500);
		setupFlashbang();
		setupPalette();
		buildTouch();
		setupDunk();
		setupMJ();
		applyPrefs();
	}

	// ---------- flashbangs ----------
	// The transition clip was a green-screen video: a flashbang flies in, pops to white,
	// and the white melts away from the middle. It's stored pre-keyed: the grenade as
	// small cut-out frames, the white as plain white, and the melt redrawn as a soft
	// ellipse measured off the clip frame by frame. The song plays while the grenade
	// flies and the bang lands on the white.

	var FB = {
		FPS: 29.97,
		HAZE: 39,         // the frame before the pop, a faint white haze
		WHITE: 40,        // solid white from here...
		MELT: 68,         // ...until the hole starts to open
		END: 106,
		SONG: 1.28,       // the song's length, so it ends right on the pop
		BANG_AT: 0.05     // the bang is 50ms into its file
	};
	// every flashbang that's going off right now; they can overlap
	var fb = { frames: [], canvas: null, ctx: null, audio: null, song: null, bang: null, list: [], ready: false };

	function base64Bytes(b64) {
		var bin = atob(b64), bytes = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return bytes;
	}

	function setupFlashbang() {
		var media = window.TAG_MEDIA;
		if (!media || !media.transition) return;
		try {
			fb.audio = new (window.AudioContext || window.webkitAudioContext)();
			fb.master = fb.audio.createGain();
			fb.master.connect(fb.audio.destination);
			fb.audio.decodeAudioData(base64Bytes(media.jarona).buffer, function (b) { fb.song = b; }, function () {});
			fb.audio.decodeAudioData(base64Bytes(media.flashbang).buffer, function (b) { fb.bang = b; }, function () {});
			if (media.heehee) fb.audio.decodeAudioData(base64Bytes(media.heehee).buffer, function (b) { fb.heehee = b; }, function () {});
		} catch (e) { fb.audio = null; }
		// sound only works after a key press or click, so wake it on the first one
		["keydown", "mousedown", "touchstart"].forEach(function (t) {
			window.addEventListener(t, function () { if (fb.audio && fb.audio.state !== "running") fb.audio.resume(); }, true);
		});

		var left = media.transition.grenade.length;
		media.transition.grenade.forEach(function (g) {
			var img = new Image();
			img.onload = function () { if (!--left) fb.ready = true; };
			img.src = g[5];
			fb.frames[g[0]] = { x: g[1], y: g[2], w: g[3], h: g[4], img: img };
		});

		fb.canvas = document.createElement("canvas");
		fb.canvas.width = 1280;   // the clip's own size
		fb.canvas.height = 720;
		fb.canvas.style.cssText = "position:fixed;z-index:50;pointer-events:none;display:none";
		document.body.appendChild(fb.canvas);
		fb.ctx = fb.canvas.getContext("2d");
	}

	function playSound(buffer, at) {
		if (!fb.audio || !buffer) return;
		var src = fb.audio.createBufferSource();
		src.buffer = buffer;
		src.connect(fb.master || fb.audio.destination);
		src.start(Math.max(fb.audio.currentTime, at));
	}

	function flashbang(why) {
		if (!fb.ready || fb.list.length >= 8) return;
		fb.count = (fb.count || 0) + 1;
		fb.why = why;
		// extra grenades come from alternating sides at different heights, so a pile-up
		// of triggers reads as several flashbangs rather than one
		var k = fb.list.length;
		fb.list.push({ start: performance.now(), flip: k % 2 === 1, lift: k ? (Math.random() - 0.5) * 300 : 0 });
		var toWhite = FB.WHITE / FB.FPS, now = fb.audio ? fb.audio.currentTime : 0;
		playSound(fb.song, now + toWhite - FB.SONG);
		playSound(fb.bang, now + toWhite - FB.BANG_AT);
		fb.canvas.style.display = "block";
		if (fb.list.length === 1) requestAnimationFrame(drawFlashbang);
	}

	// The melt, as measured off the clip (in its 640-wide frames): the green first
	// fades into the middle of the white, then the hole grows with a soft edge.
	function drawMelt(c, f) {
		var centre = f < 75 ? Math.max(0, 1 - (f - 67) / 8) : 0;
		var r05 = 106 + (f - 75) * 11.2;
		var r50 = Math.max(r05 + 6, 161 + (f - 75) * 9.2);
		var r95 = Math.max(r50 + 6, f < 70 ? 83 + (f - 68) * 42 : 167 + (f - 70) * 7.2);
		var R = r95 * 1.25, g;
		c.save();
		c.translate(640, 360);
		c.scale(2, 2 / 1.5);   // 640 -> 1280 wide, and the ellipse is 1.5x wider than tall
		g = c.createRadialGradient(0, 0, 0, 0, 0, R);
		if (f < 75) {
			g.addColorStop(0, "rgba(255,255,255," + centre + ")");
		} else {
			g.addColorStop(0, "rgba(255,255,255,0)");
			g.addColorStop(Math.max(0, r05) / R, "rgba(255,255,255,0.05)");
			g.addColorStop(r50 / R, "rgba(255,255,255,0.5)");
		}
		g.addColorStop(r95 / R, "rgba(255,255,255,0.95)");
		g.addColorStop(1, "#fff");
		c.fillStyle = g;
		c.fillRect(-400, -500, 800, 1000);
		c.restore();
	}

	function drawFlashbang() {
		var now = performance.now();
		fb.list = fb.list.filter(function (b) { return (now - b.start) / 1000 * FB.FPS < FB.END; });
		if (!fb.list.length) {
			fb.canvas.style.display = "none";
			return;
		}
		var r = rt.canvas.getBoundingClientRect(), s = Math.min(r.width / 1024, r.height / 576);
		fb.canvas.style.left = r.left + (r.width - 1024 * s) / 2 + "px";
		fb.canvas.style.top = r.top + (r.height - 576 * s) / 2 + "px";
		fb.canvas.style.width = 1024 * s + "px";
		fb.canvas.style.height = 576 * s + "px";

		var c = fb.ctx;
		c.clearRect(0, 0, 1280, 720);
		// each one draws its own stage on top; white over white is still white
		fb.list.forEach(function (b) {
			var f = (now - b.start) / 1000 * FB.FPS, n = Math.floor(f), g = fb.frames[Math.min(n, FB.HAZE - 1)];
			if (n < FB.WHITE) {
				if (g) {
					c.save();
					if (b.flip) { c.translate(1280, 0); c.scale(-1, 1); }
					c.drawImage(g.img, g.x, g.y + b.lift, g.w, g.h);
					c.restore();
				}
				if (n >= FB.HAZE) { c.fillStyle = "rgba(255,255,255,0.2)"; c.fillRect(0, 0, 1280, 720); }
			} else if (n < FB.MELT) {
				c.fillStyle = "#fff";
				c.fillRect(0, 0, 1280, 720);
			} else {
				drawMelt(c, f);
			}
		});
		requestAnimationFrame(drawFlashbang);
	}

	// ---- what sets one off ----
	// Level 1: you get tagged.  Level 2: also, as the tagger, getting juked (someone
	// jumps over you or slips past you and isn't caught) or camping one platform for 4s.
	// Level 3: all of that for anyone, plus any double jump.

	var watch = null;
	function resetWatch() {
		watch = { tagger: null, lastTag: -1e9, near: {}, floor: null, floorSince: clock, prev: {} };
	}

	function flashLevel() { return net.role === "guest" ? net.shared.flash || 0 : settings.flash || 0; }

	// Players controlled on this device (keyboards and gamepads, or your own seat online).
	function isLocal(input) { return net.role === "guest" ? input === net.myHuman : input >= 1 && input <= 8 || input === TOUCH_ID; }

	function watchFlashbangs() {
		var level = flashLevel();
		if (gvar("gameState") !== "Game") return;
		if (!watch || watch.layout !== rt.running_layout) { resetWatch(); watch.layout = rt.running_layout; }

		var players = instances(T_PLAYER).map(function (i) {
			var plat = i.behavior_insts[0];
			return { slot: i.instance_vars[2], input: i.instance_vars[4], base: i.instance_vars[5], x: i.x, y: i.y,
				dx: plat.dx, dy: plat.dy, floor: plat.dy === 0 ? plat.lastFloorObject : null };
		});
		function bySlot(n) { return players.filter(function (p) { return p.slot === n; })[0]; }
		function counts(p) { return level >= 3 || isLocal(p.input); }

		var tg = gvar("taggerID"), tagger = bySlot(tg), last = watch.last || {};
		if (watch.tagger !== null && tg !== watch.tagger) {
			var caught = bySlot(tg);
			if (level && caught && counts(caught)) flashbang("tag");
			// where the two of them were just before the catch
			dunkTag(last[watch.tagger], last[tg]);
			watch.lastTag = clock; watch.near = {}; watch.floor = null; watch.floorSince = clock;
		}
		watch.tagger = tg;
		watchDunk(players, tagger);
		watch.last = {};
		players.forEach(function (p) { watch.last[p.slot] = p; });
		if (!level) return;

		if (level >= 2 && tagger) {
			// juked: someone got past the tagger, over the top or slipping by, and wasn't caught
			if (clock - watch.lastTag > 3.8) players.forEach(function (p) {
				if (p === tagger) return;
				var side = Math.sign(p.x - tagger.x) || 1;
				var close = Math.abs(p.x - tagger.x) < 90 && Math.abs(p.y - tagger.y) < 140;
				var w = watch.near[p.slot];
				if (!w) {
					if (close) watch.near[p.slot] = { side: side, since: clock, over: false, passed: 0 };
					return;
				}
				if (p.y < tagger.y - 25) w.over = true;
				if (!w.passed && side !== w.side) {
					// on the other side now: a juke if they went over, or if they did the moving
					var slipped = Math.sign(p.dx) === side && Math.abs(p.dx) > 100 && Math.abs(p.dx) > Math.abs(tagger.dx);
					if (w.over || slipped) w.passed = clock;
					else { w.side = side; w.over = false; }   // the tagger ran past them instead
				}
				if (w.passed && clock - w.passed > 0.4) {
					// a tag would have cleared this, so they really got away
					delete watch.near[p.slot];
					if (counts(tagger)) flashbang(w.over ? "juke: jumped over" : "juke: slipped past");
				} else if (!w.passed && (!close || clock - w.since > 2)) {
					delete watch.near[p.slot];
				}
			});
			// camping: the tagger hasn't left one platform for 4 seconds
			if (tagger.floor && tagger.floor !== watch.floor) { watch.floor = tagger.floor; watch.floorSince = clock; }
			else if (tagger.floor && clock - watch.floorSince > 4) {
				watch.floorSince = clock;
				if (counts(tagger)) flashbang("camping");
			}
		}

		if (level >= 3) players.forEach(function (p) {
			// a sudden upward kick while already in the air is a double jump
			var prev = watch.prev[p.slot];
			if (prev && prev.air && !p.floor && prev.dy > -300 && p.dy < -600) flashbang("double jump");
			watch.prev[p.slot] = { dy: p.dy, air: !p.floor };
		});
	}

	// ---------- 16-colour palette ----------
	// The game itself only has red, blue, yellow and purple, and its own logic needs
	// everyone to be one of those. So that stays as it is under the hood, and each
	// player also has a palette colour that their character and slot box are drawn in,
	// using pre-recoloured copies of the red frames and the red slot box.

	var T_VISUAL = 16, T_SLOTFILL = 11, T_PLAYER_ID = 18;
	var PALETTE_BASE = { Red: 0, Blue: 7, Yellow: 2, Purple: 10 };   // the game's colours' places in the palette
	var BASE_NAMES = ["", "Red", "Blue", "Yellow", "Purple"];         // slot colour numbers 1-4
	var FULL_UV = { left: 0, top: 0, right: 1, bottom: 1 };
	var paints = {};          // input id -> palette index
	var palette = null, lastDir = {}, redAnims = null;

	function setupPalette() {
		var p = window.TAG_MEDIA && window.TAG_MEDIA.palette;
		if (!p) return;
		palette = { names: p.names, sheets: [], boxes: [], tex: {} };
		p.sheets.forEach(function (src, i) { var im = new Image(); im.src = src; palette.sheets[i] = im; });
		p.boxes.forEach(function (src, i) { var im = new Image(); im.src = src; palette.boxes[i] = im; });
	}

	// Everyone in the lobby, with the base colour the game gave them.
	function seatedPlayers() {
		var list = instances(T_SLOT).filter(function (s) { return s.instance_vars[1]; }).map(function (s) {
			return { id: s.instance_vars[1], base: BASE_NAMES[s.instance_vars[2]] };
		});
		return list.concat(extras.map(function (e) { return { id: e.id, base: e.color }; }));
	}

	function takenPaints(exceptId) {
		return Object.keys(paints).filter(function (id) { return +id !== exceptId; }).map(function (id) { return paints[id]; });
	}

	// A player's palette colour; new players start on their game colour (or the next free one).
	function paintOf(id, base) {
		if (paints[id] === undefined) {
			var start = PALETTE_BASE[base] !== undefined ? PALETTE_BASE[base] : 0;
			paints[id] = nextFreeColour(start, 1, id, true);
		}
		return paints[id];
	}

	function nextFreeColour(from, step, id, includeFrom) {
		var taken = takenPaints(id);
		for (var k = includeFrom ? 0 : 1; k <= 16; k++) {
			var c = ((from + step * k) % 16 + 16) % 16;
			if (taken.indexOf(c) < 0) return c;
		}
		return from;
	}

	// In the player-select screen, a seated player's left/right picks their colour
	// and down leaves (instead of the game's own cycle-through-four-then-leave).
	function pickColour(id, dir) {
		var slot = slotOf(id);
		if (!slot) return;
		if (dir === "down") { leaveSlot(slot); delete paints[id]; return; }
		var base = BASE_NAMES[slot.instance_vars[2]];
		paints[id] = nextFreeColour(paintOf(id, base), dir === "left" ? -1 : 1, id);
		window.c2_callFunction("PlayerColor_Spring", [slot.instance_vars[0]]);
	}

	// Keyboard and gamepad players go through the game's own Function calls, so catch
	// "join" there. Has to be swapped in before the game starts and binds its events.
	(function () {
		var acts = cr.plugins_.Function.prototype.acts, call = acts.CallFunction;
		acts.CallFunction = function (name, params) {
			if (rt && params && String(name).toLowerCase() === "input" && (moonInput(params[0], params[1]) || colourPress(params[0], params[1]))) return;
			return call.apply(this, arguments);
		};
	})();

	function colourPress(id, what) {
		if (gvar("gameState") !== "Menu" || gvar("currMenu") !== "Players") return false;
		if (what === "left" || what === "right" || what === "up" || what === "down") { lastDir[id] = what; return false; }
		if (what !== "join" || !slotOf(id)) return false;
		pickColour(id, lastDir[id]);
		return true;
	}

	function paletteTexture(kind, i) {
		var key = kind + i, img = (kind === "s" ? palette.sheets : palette.boxes)[i];
		if (!palette.tex[key] && img && img.complete && img.naturalWidth && rt.glwrap)
			palette.tex[key] = rt.glwrap.loadTexture(img, false, rt.linearSampling, 0);
		return palette.tex[key];
	}

	// A character's palette texture and frame, or null to draw it as the game would.
	function paletteLook(inst) {
		if (!palette) return null;
		var owner = (inst.siblings || []).filter(function (s) { return s.type === rt.types_by_index[T_PLAYER_ID]; })[0];
		if (!owner) return null;
		var base = owner.instance_vars[5], idx = paintOf(owner.instance_vars[4], base);
		if (idx === PALETTE_BASE[base]) return null;
		if (!redAnims) {
			redAnims = {};
			inst.type.animations.forEach(function (a) { if (a.name.indexOf("Red_") === 0) redAnims[a.name.slice(4)] = a; });
		}
		var name = inst.cur_animation.name, red = redAnims[name.slice(name.indexOf("_") + 1)];
		var tex = red && paletteTexture("s", idx);
		return tex ? { tex: tex, uv: red.frames[inst.cur_frame % red.frames.length].sheetTex } : null;
	}

	// Draw a slot box in its palette colour; false means draw it normally.
	function paintedDraw(inst, glw) {
		var tex, frame;
		{
			var slot = instances(T_SLOT).filter(function (s) { return s.instance_vars[0] === inst.instance_vars[0]; })[0];
			if (!slot || !slot.instance_vars[1]) return false;
			var b = BASE_NAMES[slot.instance_vars[2]], j = paintOf(slot.instance_vars[1], b);
			if (j === PALETTE_BASE[b]) return false;
			frame = FULL_UV;
			tex = paletteTexture("b", j);
		}
		if (!tex) return false;
		var q = inst.bquad;
		glw.setTexture(tex);
		glw.setOpacity(inst.opacity);
		glw.quadTex(q.tlx, q.tly, q.trx, q.try_, q.brx, q.bry, q.blx, q.bly, frame);
		return true;
	}

	(function () {
		var proto = cr.plugins_.Sprite.prototype.Instance.prototype, drawGL = proto.drawGL;
		proto.drawGL = function (glw) {
			if (rt && this.type === rt.types_by_index[T_VISUAL]) {
				var look = null;
				try {
					look = paletteLook(this);
					drawTrail(this, glw, look ? look.tex : this.curWebGLTexture, look ? look.uv : this.curFrame.sheetTex);
				} catch (e) {}
				if (!look) return drawGL.call(this, glw);
				var q = this.bquad;
				glw.setTexture(look.tex);
				glw.setOpacity(this.opacity);
				glw.quadTex(q.tlx, q.tly, q.trx, q.try_, q.brx, q.bry, q.blx, q.bly, look.uv);
				return;
			}
			if (palette && rt && this.type === rt.types_by_index[T_SLOTFILL]) {
				try { if (paintedDraw(this, glw)) return; } catch (e) {}
			}
			drawGL.call(this, glw);
		};
	})();

	// ---------- moonwalk ----------
	// Running along the ground, double-tap backwards: you glide backwards, still facing
	// forward, and can't be tagged for half a second. Runners only, 4s cooldown.
	// A tag is the tagger's sprite overlapping yours, so the immunity is simply your
	// sprite's collisions being off for the moonwalk.

	var MW = { LEN: 0.5, COOLDOWN: 4, TAP_GAP: 0.35, SPEED: 0.7 };
	var mw = {
		held: {}, prevHeld: {},   // left/right input per player this tick and last
		before: {},               // id -> facing and speed at the start of the tick, before keys turn them
		taps: {},                 // a first backwards tap waiting for its second
		active: {},               // id -> { start, dir, slot }   (host)
		ready: {},                // id -> time it can be used again (host)
		view: {},                 // slot -> { start, cool }  what's shown, on every device
		trails: {}, plats: new Map()
	};
	var MOON_BITS = { left: 16, right: 32 };   // a friend's bot asking for one

	// Every movement call goes through here (keyboard, gamepad, touch, friends, bots).
	// Returns true to swallow left/right while that player is moonwalking.
	function moonInput(id, what) {
		if (what !== "left" && what !== "right") return false;
		(mw.held[id] || (mw.held[id] = {}))[what] = true;
		return !!mw.active[id];
	}

	function playerById(id) { return instances(T_PLAYER).filter(function (p) { return p.instance_vars[4] === id; })[0]; }
	function spriteOf(p) { return (p.siblings || []).filter(function (s) { return s.type === rt.types_by_index[T_VISUAL]; })[0]; }
	function onGround(p) { var pl = p.behavior_insts[0]; return pl.dy === 0 && !!pl.lastFloorObject; }
	function isBot(id) { return BOT_IDS.indexOf(id) >= 0 || net.guests.some(function (g) { return g.bots.indexOf(id) >= 0; }); }

	// facing: the way they keep looking; they slide the other way.
	function tryMoonwalk(p, facing, forBot) {
		var id = p.instance_vars[4], plat = p.behavior_insts[0];
		if (mw.active[id] || (mw.ready[id] || 0) > clock) return;
		if (p.instance_vars[2] === gvar("taggerID") || !onGround(p)) return;
		if (!forBot && Math.abs(plat.dx) < 60) return;
		p.instance_vars[3] = facing;
		mw.active[id] = { start: clock, dir: -facing, slot: p.instance_vars[2] };
		mw.ready[id] = clock + MW.LEN + MW.COOLDOWN;
		var sprite = spriteOf(p);
		if (sprite) sprite.collisionsEnabled = false;
		// the glide itself: set the speed just before the game moves them
		if (!mw.plats.has(plat)) {
			var posttick = plat.posttick;
			mw.plats.set(plat, true);
			plat.posttick = function () {
				var a = mw.active[this.inst.instance_vars[4]];
				if (a) {
					var k = Math.min(1, (clock - a.start) / MW.LEN);
					this.dx = a.dir * this.maxspeed * MW.SPEED * (1 - 0.4 * k);
					this.simleft = this.simright = false;
				}
				posttick.call(this);
			};
		}
	}

	function endMoonwalk(id) {
		delete mw.active[id];
		var p = playerById(id), sprite = p && spriteOf(p);
		if (sprite) sprite.collisionsEnabled = true;
	}

	// A bot (here, or a friend's) wanting to slide away in direction dir.
	function requestMoonwalk(id, dir) {
		if (net.role === "guest") { botKeys[id] = (botKeys[id] || 0) | (dir < 0 ? MOON_BITS.left : MOON_BITS.right); return; }
		var p = playerById(id);
		if (p) tryMoonwalk(p, -dir, true);
	}

	// Pressing the other way turns a player round as the game handles it, so note which
	// way everyone faced (and how fast they were going) before this tick's keys.
	function moonwalkBefore() {
		mw.before = {};
		if (gvar("gameState") !== "Game") return;
		instances(T_PLAYER).forEach(function (p) {
			mw.before[p.instance_vars[4]] = { facing: p.instance_vars[3], dx: p.behavior_insts[0].dx };
		});
	}

	// Host: spot double-taps, end moonwalks, and keep the view in step. Once per tick.
	function moonwalkTick() {
		if (gvar("gameState") !== "Game") { mw.held = {}; mw.prevHeld = {}; return; }
		instances(T_PLAYER).forEach(function (p) {
			var id = p.instance_vars[4], now = mw.held[id] || {}, before = mw.prevHeld[id] || {};
			if (mw.active[id] && clock - mw.active[id].start >= MW.LEN) endMoonwalk(id);
			if (mw.active[id] || isBot(id)) return;
			["left", "right"].forEach(function (d) {
				if (!now[d] || before[d]) return;   // only fresh presses
				var t = mw.taps[id], was = mw.before[id] || { facing: p.instance_vars[3], dx: p.behavior_insts[0].dx }, facing = was.facing;
				if (t && t.dir === d && clock - t.time < MW.TAP_GAP) {
					delete mw.taps[id];
					tryMoonwalk(p, t.facing, false);
				} else if (d === (facing === 1 ? "left" : "right") && onGround(p) && Math.sign(was.dx) === facing && Math.abs(was.dx) > 150) {
					// running forward and tapped back once; the tap itself turns them, so remember which way they faced
					mw.taps[id] = { dir: d, time: clock, facing: facing };
				}
			});
		});
		mw.prevHeld = mw.held;
		mw.held = {};
		var view = {};
		instances(T_PLAYER).forEach(function (p) {
			var id = p.instance_vars[4], a = mw.active[id], cool = Math.max(0, (mw.ready[id] || 0) - clock);
			if (a || cool > 0) view[p.instance_vars[2]] = { start: a ? a.start : null, cool: cool };
		});
		setMoonView(view);
	}

	// What gets shown: flicker, afterimages, the sound when one starts, the cooldown bar.
	function setMoonView(view) {
		Object.keys(view).forEach(function (slot) {
			var was = mw.view[slot];
			if (view[slot].start !== null && !(was && was.start !== null)) {
				view[slot].shownAt = clock;
				if (fb.audio && fb.heehee) playSound(fb.heehee, fb.audio.currentTime);
				// Michael, for everyone
				var p = instances(T_PLAYER).filter(function (i) { return i.instance_vars[2] === +slot; })[0];
				if (p) showMJ(p.instance_vars[3]);
			} else if (was && view[slot].start !== null) {
				view[slot].shownAt = was.shownAt;
			}
		});
		mw.view = view;
	}

	function moonVisuals() {
		instances(T_PLAYER).forEach(function (p) {
			var v = mw.view[p.instance_vars[2]], sprite = spriteOf(p);
			if (!sprite) return;
			var moving = v && v.start !== null;
			sprite.opacity = moving && Math.floor(clock / 0.06) % 2 ? 0.35 : 1;   // flicker while untouchable
			if (!moving) delete mw.trails[p.instance_vars[2]];
		});
	}

	// Afterimages: where the sprite was over the last quarter second, drawn faded behind it.
	function drawTrail(inst, glw, tex, uv) {
		var owner = (inst.siblings || []).filter(function (s) { return s.type === rt.types_by_index[T_PLAYER_ID]; })[0];
		if (!owner) return;
		var slot = owner.instance_vars[2], v = mw.view[slot];
		if (!v || v.start === null) return;
		var trail = mw.trails[slot] || (mw.trails[slot] = []), now = performance.now() / 1000, q = inst.bquad;
		if (!trail.length || now - trail[trail.length - 1].t > 0.045)
			trail.push({ t: now, q: [q.tlx, q.tly, q.trx, q.try_, q.brx, q.bry, q.blx, q.bly], tex: tex, uv: uv });
		while (trail.length && now - trail[0].t > 0.25) trail.shift();
		trail.forEach(function (e) {
			if (now - e.t < 0.03) return;
			glw.setTexture(e.tex);
			glw.setOpacity(0.35 * (1 - (now - e.t) / 0.25));
			glw.quadTex(e.q[0], e.q[1], e.q[2], e.q[3], e.q[4], e.q[5], e.q[6], e.q[7], e.uv);
		});
	}

	// Cooldown bars under players whose moonwalk is recharging.
	var barEls = [];
	function drawMoonBars() {
		var bars = [], layer = rt.getLayerByName("Players");
		if (layer && rt.running_layout.name !== "Menu") instances(T_PLAYER).forEach(function (p) {
			var v = mw.view[p.instance_vars[2]];
			if (!v || !v.cool) return;
			bars.push({ fill: 1 - Math.min(1, v.cool / (MW.COOLDOWN + MW.LEN)),
				x: layer.layerToCanvas(p.x, p.y + 26, true), y: layer.layerToCanvas(p.x, p.y + 26, false) });
		});
		var rect = rt.canvas.getBoundingClientRect();
		while (barEls.length < bars.length) {
			var el = document.createElement("div");
			el.className = "mwBar";
			el.innerHTML = "<i></i>";
			document.body.appendChild(el);
			barEls.push(el);
		}
		barEls.forEach(function (el, i) {
			var b = bars[i];
			el.style.display = b ? "block" : "none";
			if (!b) return;
			el.style.left = rect.left + b.x + "px";
			el.style.top = rect.top + b.y + "px";
			el.firstChild.style.width = Math.round(b.fill * 100) + "%";
		});
	}

	// ---------- the MJ pop-up ----------
	// When anyone moonwalks, Michael himself shows up in your face for a second, on
	// every flash level (the dunk and MJ setting turns him off). He's mirrored to face
	// the same way as the player.

	var mj = { clip: null, frames: [], canvas: null, ctx: null, show: null };

	function setupMJ() {
		var d = window.TAG_MEDIA && window.TAG_MEDIA.mj;
		if (!d) return;
		mj.clip = d;
		d.frames.forEach(function (src, i) { var im = new Image(); im.src = src; mj.frames[i] = im; });
		mj.canvas = document.createElement("canvas");
		mj.canvas.width = d.w;
		mj.canvas.height = d.h;
		mj.canvas.style.cssText = "position:fixed;z-index:54;pointer-events:none;display:none;border-radius:14px;" +
			"border:6px solid #fff;box-shadow:0 0 0 3px #000,inset 0 0 0 3px #000,0 8px 0 3px #000";
		document.body.appendChild(mj.canvas);
		mj.ctx = mj.canvas.getContext("2d");
	}

	function showMJ(facing) {
		if (!mj.clip || !prefs.popups) return;
		var already = !!mj.show;
		mj.show = { start: performance.now() / 1000, flip: facing === -1 };
		mj.canvas.style.display = "block";
		if (!already) requestAnimationFrame(drawMJ);
	}

	function drawMJ() {
		var s = mj.show, c = mj.clip;
		if (!s) return;
		var t = performance.now() / 1000 - s.start;
		if (t > 1.25) {
			mj.show = null;
			mj.canvas.style.display = "none";
			return;
		}
		// in fast, a second of moonwalking, out quick
		var a = t < 0.12 ? t / 0.12 : t > 1 ? 1 - (t - 1) / 0.25 : 1;
		var img = mj.frames[Math.floor(t * c.fps) % mj.frames.length];
		if (img.complete) {
			mj.ctx.save();
			if (s.flip) { mj.ctx.translate(c.w, 0); mj.ctx.scale(-1, 1); }
			mj.ctx.drawImage(img, 0, 0, c.w, c.h);
			mj.ctx.restore();
		}
		var r = rt.canvas.getBoundingClientRect(), sc = Math.min(r.width / 1024, r.height / 576);
		var h = 576 * sc * 0.72, w = h * c.w / c.h;
		mj.canvas.style.width = w + "px";
		mj.canvas.style.height = h + "px";
		mj.canvas.style.left = r.left + r.width / 2 - w / 2 + "px";
		mj.canvas.style.top = r.top + r.height / 2 - h / 2 + "px";
		mj.canvas.style.transform = "scale(" + (1 + 0.1 * Math.max(0, 1 - t / 0.2)) + ")";
		mj.canvas.style.opacity = a;
		requestAnimationFrame(drawMJ);
	}

	// ---------- the orange dunk ----------
	// When the orange player drops on someone from above, the dunk clip fades in as
	// they come down, timed so the dunk lands as the tag does, then gets out of the way
	// fast. If the catch doesn't happen it just fades off. Shown to everyone, on every
	// flash level (the dunk and MJ setting turns it off). It sits on top of any flashbang.

	var ORANGE = 1;           // palette index
	var dunk = { clip: null, frames: [], canvas: null, ctx: null, state: null };

	function setupDunk() {
		var d = window.TAG_MEDIA && window.TAG_MEDIA.dunk;
		if (!d) return;
		dunk.clip = d;
		d.frames.forEach(function (src, i) { var im = new Image(); im.src = src; dunk.frames[i] = im; });
		dunk.canvas = document.createElement("canvas");
		dunk.canvas.width = d.w;
		dunk.canvas.height = d.h;
		dunk.canvas.style.cssText = "position:fixed;z-index:55;pointer-events:none;display:none;border-radius:14px;" +
			"border:6px solid #fff;box-shadow:0 0 0 3px #000,inset 0 0 0 3px #000,0 8px 0 3px #000";
		document.body.appendChild(dunk.canvas);
		dunk.ctx = dunk.canvas.getContext("2d");
	}

	// The clip runs at 30 source frames a second; frame 54 is the dunk.
	function startDunk(victimSlot, eta) {
		if (!prefs.popups) return;
		var c = dunk.clip;
		dunk.state = { victim: victimSlot, start: clock, eta: clock + eta, phase: "coming",
			at0: Math.max(c.first, c.dunk - eta * 30), t0: clock, alpha: 0, leaving: 0 };
		dunk.canvas.style.display = "block";
		requestAnimationFrame(drawDunk);
	}

	function landDunk() {
		var s = dunk.state;
		if (!s) return;   // pop-ups are off
		s.phase = "landed";
		s.landed = clock;
		// jump to the dunk if the drop was quicker than expected
		s.at0 = Math.max(clipFrame(s, clock), dunk.clip.dunk);
		s.t0 = clock;
	}

	function dropDunk() {
		var s = dunk.state;
		if (s && s.phase !== "leaving") { s.phase = "leaving"; s.leaving = clock; s.from = s.alpha; }
	}

	// Each tick: is the orange tagger coming down on someone?
	function watchDunk(players, tagger) {
		if (!dunk.clip) return;
		var s = dunk.state;
		var orange = tagger && paintOf(tagger.input, tagger.base) === ORANGE;

		if (!s && orange && !tagger.floor && clock - watch.lastTag > 3.8) {
			var prey = players.filter(function (p) {
				return p !== tagger && p.y - tagger.y > 30 && p.y - tagger.y < 260 && Math.abs(p.x - tagger.x) < 110;
			}).sort(function (a, b) { return Math.abs(a.x - tagger.x) - Math.abs(b.x - tagger.x); })[0];
			if (prey) {
				// time until they meet, from how fast the tagger's falling (game gravity 2000)
				var gap = Math.max(0, prey.y - tagger.y - 33), v = tagger.dy;
				var eta = (-v + Math.sqrt(v * v + 4000 * gap)) / 2000;
				if (eta < 0.9) startDunk(prey.slot, eta);
			}
		} else if (s && s.phase === "coming") {
			var p = players.filter(function (x) { return x.slot === s.victim; })[0];
			// whiffed: landed, drifted off, someone else is "it", or it's taking too long
			if (!p || !tagger || !orange || tagger.floor || Math.abs(p.x - tagger.x) > 160 || clock > s.eta + 0.35) dropDunk();
		}
	}

	// On a tag: a dunk if orange came down on them from above.
	function dunkTag(was, prey) {
		if (!dunk.clip || !was || !prey) return;
		var fromAbove = paintOf(was.input, was.base) === ORANGE && !was.floor && was.y < prey.y - 10;
		var s = dunk.state;
		if (fromAbove) {
			if (!s || s.phase === "leaving") startDunk(prey.slot, 0);
			landDunk();
		} else if (s && s.phase === "coming") {
			dropDunk();
		}
	}

	function clipFrame(s, now) { return s.at0 + (now - s.t0) * 30; }

	function drawDunk() {
		var s = dunk.state, c = dunk.clip;
		if (!s) return;
		var now = performance.now() / 1000, a;
		if (s.phase === "coming") {
			// fade in slowly over the drop
			a = Math.min(0.92, (now - s.start) / Math.max(0.3, s.eta - s.start) * 0.92);
		} else if (s.phase === "landed") {
			a = 1;
			if (now - s.landed > 0.5) { s.phase = "leaving"; s.leaving = now; s.from = 1; }
		} else {
			a = s.from * Math.max(0, 1 - (now - s.leaving) / 0.22);   // and out fast
			if (a <= 0) {
				dunk.state = null;
				dunk.canvas.style.display = "none";
				return;
			}
		}
		s.alpha = a;
		var i = Math.max(0, Math.min(dunk.frames.length - 1, Math.floor((clipFrame(s, now) - c.first) / c.step)));
		var img = dunk.frames[i];
		if (img.complete) dunk.ctx.drawImage(img, 0, 0, c.w, c.h);

		var r = rt.canvas.getBoundingClientRect(), sc = Math.min(r.width / 1024, r.height / 576);
		var h = 576 * sc * 0.82, w = h * c.w / c.h;
		// a punch when the dunk lands
		var kick = s.phase === "landed" ? 1 + 0.12 * Math.max(0, 1 - (now - s.landed) / 0.25) : 1;
		var shake = s.phase === "landed" && prefs.shake ? (Math.random() - 0.5) * 16 * Math.max(0, 1 - (now - s.landed) / 0.4) : 0;
		dunk.canvas.style.width = w + "px";
		dunk.canvas.style.height = h + "px";
		dunk.canvas.style.left = r.left + r.width / 2 - w / 2 + shake + "px";
		dunk.canvas.style.top = r.top + r.height / 2 - h / 2 + shake + "px";
		dunk.canvas.style.transform = "scale(" + kick + ")";
		dunk.canvas.style.opacity = a;
		requestAnimationFrame(drawDunk);
	}

	// ---------- touch controls ----------
	// A joystick and two buttons, shown when the screen gets touched (or straight away
	// on touch-only devices) and hidden again when a keyboard or gamepad gets used.
	// Touch is its own player on this device; online as a friend it acts as your keys.

	var TOUCH_ID = 18;
	var touch = { held: {}, presses: [], el: null, shown: false };

	function virtualKey(k, down) {
		if (net.role === "guest") {
			if (net.conn && net.conn.open && !!touch.held[k] !== down) net.conn.send({ t: "key", k: k, down: down });
		} else if (down && !touch.held[k]) {
			touch.presses.push(k);
		}
		touch.held[k] = down;
	}

	function touchInputs() {
		var pending = touch.presses;
		touch.presses = [];
		pending.forEach(function (k) { applyPress(TOUCH_ID, k, true); });
		if (gvar("gameState") === "Game")
			["left", "right", "down"].forEach(function (k) { if (touch.held[k]) window.c2_callFunction("Input", [TOUCH_ID, k]); });
	}

	function showTouch(on, fromSettings) {
		if (!fromSettings && prefs.touch !== "auto") return;
		if (!touch.el || touch.shown === on) return;
		touch.shown = on;
		touch.el.style.display = on ? "block" : "none";
		if (!on) ["left", "right", "up", "down", "action"].forEach(function (k) { if (touch.held[k]) virtualKey(k, false); });
	}

	function buildTouch() {
		var el = touch.el = document.createElement("div");
		el.id = "touchPad";
		el.innerHTML = '<div class="tp-stick"><div class="tp-knob"></div></div>' +
			'<div class="tp-buttons"><button class="tp-ok">' + px("OK") + '</button><button class="tp-jump">' + px("JUMP") + "</button></div>";
		document.body.appendChild(el);

		var stick = el.querySelector(".tp-stick"), knob = el.querySelector(".tp-knob"), dirs = {};
		function setDirs(x, y, r) {
			var now = { left: x < -0.35 * r, right: x > 0.35 * r, down: y > 0.5 * r, up: y < -0.55 * r };
			Object.keys(now).forEach(function (k) { if (!!dirs[k] !== now[k]) { dirs[k] = now[k]; virtualKey(k, now[k]); } });
		}
		function move(ev) {
			var b = stick.getBoundingClientRect(), r = b.width * 0.38;
			var x = ev.clientX - (b.left + b.width / 2), y = ev.clientY - (b.top + b.height / 2), d = Math.hypot(x, y);
			if (d > r) { x *= r / d; y *= r / d; }
			knob.style.transform = "translate(" + x + "px," + y + "px)";
			setDirs(x, y, r);
		}
		stick.addEventListener("pointerdown", function (ev) { stick.setPointerCapture(ev.pointerId); move(ev); ev.preventDefault(); });
		stick.addEventListener("pointermove", function (ev) { if (stick.hasPointerCapture(ev.pointerId)) move(ev); });
		["pointerup", "pointercancel"].forEach(function (t) {
			stick.addEventListener(t, function () { knob.style.transform = ""; setDirs(0, 0, 1); });
		});
		[[".tp-jump", "up"], [".tp-ok", "action"]].forEach(function (b) {
			var btn = el.querySelector(b[0]);
			btn.addEventListener("pointerdown", function (ev) { btn.setPointerCapture(ev.pointerId); btn.classList.add("down"); virtualKey(b[1], true); ev.preventDefault(); });
			["pointerup", "pointercancel"].forEach(function (t) {
				btn.addEventListener(t, function () { btn.classList.remove("down"); virtualKey(b[1], false); });
			});
		});
		// keep the game's own mouse/touch handling out of it
		["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "touchmove"].forEach(function (t) {
			el.addEventListener(t, function (ev) { ev.stopPropagation(); });
		});

		// does this device need it?
		if (window.matchMedia && matchMedia("(any-pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches) showTouch(true);
		window.addEventListener("touchstart", function () { showTouch(true); }, { capture: true, passive: true });
		window.addEventListener("keydown", function (ev) { if (ev.isTrusted) showTouch(false); }, true);
		window.addEventListener("gamepadconnected", function () { showTouch(false); });
	}

	// ---------- online play ----------
	// The host's game is the real one. Friends run their own copy that only draws:
	// the host sends positions, the tagger and the timer every frame, and friends
	// send back their key presses (and their bots' presses) as small messages.

	var REMOTE_POOL = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
	var CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
	var KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up",
		ArrowDown: "down", KeyS: "down", Space: "action", Enter: "action" };
	var BITS = { left: 1, right: 2, down: 4, up: 8 };

	var net = { role: null, peer: null, code: "", guests: [], conn: null, status: "", test: null, testing: false,
		boosts: {}, pings: {}, labels: [], myHuman: 0, myBots: [], ping: 0,
		shared: {} };   // a friend's copy of the host's settings
	try { net.test = JSON.parse(localStorage.getItem("tagDeviceTest")); } catch (e) {}

	function guestOf(id) {
		return net.guests.filter(function (g) { return g.human === id || g.bots.indexOf(id) >= 0; })[0] || null;
	}

	function loadPeerJS() {
		if (window.Peer) return Promise.resolve();
		return new Promise(function (resolve, reject) {
			var s = document.createElement("script");
			s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
			s.onload = resolve;
			s.onerror = function () { reject(new Error("Couldn't load the online library.")); };
			document.head.appendChild(s);
		});
	}

	function setStatus(text) {
		net.status = text;
		renderOnline();
	}

	// ---- device test ----
	// Times the work the host does per player (path finding and physics steps) and
	// checks the frame rate, then suggests how many players this device can run.

	function deviceTest() {
		if (net.testing) return;
		net.testing = true;
		renderOnline();
		var frames = 0, start = performance.now();
		(function count() {
			frames++;
			if (performance.now() - start < 1500) return requestAnimationFrame(count);
			var fps = frames / ((performance.now() - start) / 1000);
			var ms = benchWork();
			var suggest = fps < 30 ? 2 : fps < 45 || ms > 40 ? 3 : ms > 20 ? 4 : ms > 10 ? 5 : 6;
			net.test = { suggest: suggest, fps: Math.round(fps), ms: Math.round(ms * 10) / 10 };
			try { localStorage.setItem("tagDeviceTest", JSON.stringify(net.test)); } catch (e) {}
			// the test only picks the limit until you pick one yourself
			if (!settings.limitPicked && net.role !== "guest") { settings.limit = suggest; saveSettings(); refreshButtons(); }
			net.testing = false;
			renderOnline();
		})();
	}

	// One bot's worth of planning on a made-up level, timed.
	function benchWork() {
		var rects = [];
		for (var i = 0; i < 18; i++) {
			var x = (i * 389) % 1900, y = 200 + (i * 173) % 800;
			rects.push({ l: x, r: x + 280, t: y, b: y + 32, rot: false, thru: false });
		}
		rects.push({ l: 0, r: 2176, t: 1120, b: 1152, rot: false, thru: false });
		var w = { box: { l: -16.5, r: 16.5, t: -15.5, b: 16.5 }, solids: rects, thrus: [], bottom: 1400, byRect: new Map() };
		rects.forEach(function (r) { w.byRect.set(r, { l: r.l, r: r.r }); });
		var start = performance.now();
		for (var n = 0; n < 400; n++)
			simulate(w, { x: 100 + n * 5 % 2000, y: 600, dx: n % 2 ? 400 : -400, dy: -900, hold: n % 3 - 1, vmax: 400, jump: 900 });
		return performance.now() - start;
	}

	// ---- host ----

	function startHosting() {
		setStatus("Starting...");
		loadPeerJS().then(openRoom).catch(function (e) { setStatus(e.message); });
	}

	function openRoom() {
		var code = "";
		for (var i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
		var peer = new Peer("c2tag-" + code);
		net.role = "host"; net.peer = peer; net.code = code;
		peer.on("open", function () { setStatus(""); });
		peer.on("error", function (e) {
			if (e.type === "unavailable-id") { peer.destroy(); return openRoom(); }
			setStatus("Online error: " + e.type);
		});
		peer.on("connection", function (conn) {
			conn.on("open", function () {
				if (seatCount() >= settings.limit && gvar("currMenu") === "Players") {
					conn.send({ t: "full", max: settings.limit });
					return setTimeout(function () { conn.close(); }, 500);
				}
				var g = { conn: conn, human: takeId(), bots: [], held: {}, presses: [], ping: 0 };
				net.guests.push(g);
				conn.send({ t: "seats", human: g.human, bots: g.bots });
				if (net.plats) conn.send(net.plats);
				conn.on("data", function (m) { hostMessage(g, m); });
				conn.on("close", function () { dropGuest(g); });
				renderOnline();
			});
		});
		renderOnline();
	}

	function takeId() {
		var used = [];
		net.guests.forEach(function (g) { used = used.concat(g.human, g.bots); });
		return REMOTE_POOL.filter(function (x) { return used.indexOf(x) < 0; })[0];
	}

	function hostMessage(g, m) {
		if (m.t === "key" && (BITS[m.k] || m.k === "action")) {
			if (m.down && !g.held[m.k]) g.presses.push([g.human, m.k]);
			g.held[m.k] = m.down;
		} else if (m.t === "want") {
			var n = settings.sons ? Math.max(0, Math.min(BOT_IDS.length, m.bots | 0)) : 0;
			while (g.bots.length > n) { var gone = g.bots.pop(); unseat(gone); delete net.boosts[gone]; }
			while (g.bots.length < n) { var id = takeId(); if (!id) break; g.bots.push(id); }
			var level = LEVELS[m.level] || LEVELS.medium;
			g.bots.forEach(function (id) { net.boosts[id] = level.boost || 1; });
			g.conn.send({ t: "seats", human: g.human, bots: g.bots });
			renderOnline();
		} else if (m.t === "set") {
			// a friend changing a shared setting, if thy sons may
			var sel = SELECTORS[m.k];
			if (settings.sons && sel && sel.shared && sel.values.indexOf(m.v) >= 0) {
				settings[m.k] = m.v;
				if (m.k === "limit") settings.limitPicked = true;
				saveSettings();
				refreshButtons();
				renderOnline();
			}
		} else if (m.t === "bots") {
			g.botKeys = g.botKeys || {};
			m.b.forEach(function (b) {
				g.botKeys[b[0]] = b[1];
				if (b[1] & (MOON_BITS.left | MOON_BITS.right)) requestMoonwalk(b[0], b[1] & MOON_BITS.left ? -1 : 1);
				if (b[1] & BITS.up) g.presses.push([b[0], "up"]);
			});
		} else if (m.t === "pong") {
			g.ping = Math.round(performance.now() - m.ts);
		}
	}

	function dropGuest(g) {
		var i = net.guests.indexOf(g);
		if (i < 0) return;
		net.guests.splice(i, 1);
		g.bots.forEach(function (id) { delete net.boosts[id]; });
		renderOnline();
	}

	// A key press from a friend or the touch controls, played the way the game's own
	// input sheet would. trusted: this device's own player, not bound by thy-sons.
	function applyPress(id, k, trusted) {
		var inGame = gvar("gameState") === "Game", lobby = gvar("gameState") === "Menu" && gvar("currMenu") === "Players";
		if (inGame) { if (k === "up") window.c2_callFunction("Input", [id, "up"]); return; }
		// unless thy sons may change settings, friends can only join and pick a colour
		if (!trusted && !settings.sons && (!lobby || k === "action")) return;
		if (k === "action") return window.c2_callFunction("Input", [id, "action"]);
		if (lobby && slotOf(id)) return pickColour(id, k);
		if (lobby && !seated(id)) {
			if (seatCount() >= settings.limit) return;
			if (!freeSlot()) return addExtra(id);
		}
		if (lobby && extras.some(function (e) { return e.id === id; })) return;
		window.c2_callFunction("Input", [id, k]);
		window.c2_callFunction("Input", [id, "join"]);
	}

	function guestInputs() {
		var inGame = gvar("gameState") === "Game";
		net.guests.forEach(function (g) {
			g.presses.forEach(function (p) { applyPress(p[0], p[1], false); });
			g.presses.length = 0;
			if (!inGame) return;
			["left", "right", "down"].forEach(function (k) { if (g.held[k]) window.c2_callFunction("Input", [g.human, k]); });
			g.bots.forEach(function (id) {
				var f = (g.botKeys || {})[id] || 0;
				if (f & BITS.left) window.c2_callFunction("Input", [id, "left"]);
				if (f & BITS.right) window.c2_callFunction("Input", [id, "right"]);
				if (f & BITS.down) window.c2_callFunction("Input", [id, "down"]);
			});
		});
	}

	setInterval(function () {
		var pings = {};
		net.guests.forEach(function (g) { [g.human].concat(g.bots).forEach(function (id) { pings[id] = g.ping; }); });
		net.pings = pings;
		net.guests.forEach(function (g) {
			if (g.conn.open) g.conn.send({ t: "ping", ts: performance.now(), you: g.ping, pings: pings });
		});
	}, 1000);

	var typeIndex = new Map();
	function floorKey(f) {
		if (!f) return "";
		if (!typeIndex.size) rt.types_by_index.forEach(function (t, i) { typeIndex.set(t, i); });
		return typeIndex.get(f.type) + ":" + Math.round(f.x) + ":" + Math.round(f.y);
	}

	function round1(v) { return Math.round(v * 10) / 10; }

	function sharedSettings() {
		return { count: settings.count, level: settings.level, limit: settings.limit, flash: settings.flash, sons: settings.sons };
	}

	var lastLobby = 0;
	function hostSend() {
		if (!net.guests.length) return;
		var L = rt.running_layout.name, gs = gvar("gameState"), msg;
		if (L === "Menu") {
			if (clock - lastLobby < 0.2) return;
			lastLobby = clock;
			var arr = rt.types_by_index[17].instances[0].arr;
			msg = { t: "lobby", L: L, gs: gs, menu: gvar("currMenu"), shared: sharedSettings(), paints: paints,
				slots: instances(T_SLOT).map(function (s) { return [s.instance_vars[1], s.instance_vars[2]]; }),
				labels: instances(T_SLOT).map(function (s) { return slotLabel(s.instance_vars[1]); }),
				arr: arr.map(function (row) { return [row[0][0], row[1][0]]; }),
				extras: extras,
				vars: { mapName: gvar("mapName"), timer: gvar("timer"), doubleJump: gvar("doubleJump"),
					playerCollision: gvar("playerCollision"), randomPlatforms: gvar("randomPlatforms") },
				items: menuItems() };
		} else {
			if (net.platsFor !== rt.running_layout) {
				net.platsFor = rt.running_layout;
				net.plats = { t: "plats", L: L, list: randomPlatforms() };
				net.guests.forEach(function (g) { g.conn.send(net.plats); });
			}
			var t29 = instances(29)[0];
			msg = { t: "s", L: L, gs: gs, tg: gvar("taggerID"), tm: t29 ? t29.instance_vars[0] : 0, shared: sharedSettings(), paints: paints,
				mw: Object.keys(mw.view).map(function (slot) { var v = mw.view[slot]; return [+slot, v.start !== null ? 1 : 0, Math.round(v.cool * 10) / 10]; }),
				p: instances(T_PLAYER).map(function (i) {
					var plat = i.behavior_insts[0];
					return [i.instance_vars[2], i.instance_vars[4], i.instance_vars[5], round1(i.x), round1(i.y),
						Math.round(plat.dx), Math.round(plat.dy), plat.dy === 0 ? floorKey(plat.lastFloorObject) : "", i.instance_vars[3]];
				}) };
			if (gs !== "Game") msg.items = menuItems();
		}
		net.guests.forEach(function (g) { if (g.conn.open) g.conn.send(msg); });
	}

	// Platforms made by the "random platforms" option, so friends get the same level.
	function randomPlatforms() {
		var list = [];
		[21, 22, 23, 36].forEach(function (ti) {
			instances(ti).forEach(function (i) {
				if (i.instance_vars[0]) list.push([ti, i.x, i.y, i.width, i.height, i.angle]);
			});
		});
		return list;
	}

	function stopOnline() {
		var wasGuest = net.role === "guest";
		net.guests.slice().forEach(function (g) { g.conn.close(); dropGuest(g); });
		if (net.peer) net.peer.destroy();
		net.role = null; net.peer = null; net.conn = null; net.code = ""; net.ping = 0; net.plats = null; net.platsFor = null;
		net.myHuman = 0; net.myBots = []; net.pings = {}; net.labels = []; net.host = null; net.platsMsg = null; net.shared = {};
		extras = [];
		if (wasGuest && rt) {
			// back to this device's own menu
			if (rt.running_layout.name !== "Menu") rt.changelayout = rt.layouts.Menu;
			window.c2_callFunction("Set_GameState", ["Menu"]);
		}
		setStatus("");
	}

	// ---- guest ----

	function joinRoom(code) {
		code = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
		if (code.length !== 5) return setStatus("Codes are 5 letters/numbers.");
		setStatus("Connecting...");
		loadPeerJS().then(function () {
			var peer = new Peer();
			net.role = "guest"; net.peer = peer;
			peer.on("error", function (e) {
				var msg = e.type === "peer-unavailable" ? "No game with that code." : "Online error: " + e.type;
				if (net.role === "guest") stopOnline();
				setStatus(msg);
			});
			peer.on("open", function () {
				var conn = net.conn = peer.connect("c2tag-" + code, { reliable: true, serialization: "json" });
				conn.on("open", function () { setStatus("Connected"); sendWant(); });
				conn.on("data", guestMessage);
				conn.on("close", function () { if (net.role === "guest") { stopOnline(); setStatus("The host left."); } });
			});
		}).catch(function (e) { setStatus(e.message); });
	}

	function sendWant() {
		if (net.conn && net.conn.open)
			net.conn.send({ t: "want", bots: net.shared.sons ? settings.count : 0, level: net.shared.level || settings.level });
	}

	function guestMessage(m) {
		if (m.t === "full") { stopOnline(); setStatus("That game is full (" + m.max + " players max)."); }
		else if (m.t === "seats") { net.myHuman = m.human; net.myBots = m.bots; renderOnline(); }
		else if (m.t === "ping") { net.conn.send({ t: "pong", ts: m.ts }); net.ping = m.you; net.pings = m.pings; renderOnline(); }
		else if (m.t === "lobby" || m.t === "s") {
			var wasAllowed = net.shared.sons;
			net.host = m;
			net.shared = m.shared || {};
			if (m.paints) paints = m.paints;
			if (m.mw) {
				var view = {};
				m.mw.forEach(function (v) { view[v[0]] = { start: v[1] ? 0 : null, cool: v[2] }; });
				setMoonView(view);
			}
			if (wasAllowed !== net.shared.sons) sendWant();
		}
		else if (m.t === "plats") net.platsMsg = m;
	}

	function setVar(name, value) {
		gvar(name);
		if (vars[name]) vars[name].data = value;
	}

	function followLayout(name) {
		if (rt.running_layout.name === name) return true;
		if (!rt.changelayout && !rt.isloading && rt.layouts[name]) rt.changelayout = rt.layouts[name];
		return false;
	}

	var floors = null, lastSeen = new Map();
	function guestBeforeLogic() {
		var host = net.host;
		if (!host || !followLayout(host.L)) return;

		if (host.t === "lobby") {
			net.labels = host.labels;
			extras = host.extras;
			Object.keys(host.vars).forEach(function (k) { setVar(k, host.vars[k]); });
			setVar("currMenu", host.menu);
			if (gvar("gameState") !== host.gs) window.c2_callFunction("Set_GameState", [host.gs]);
			instances(T_SLOT).forEach(function (s, i) {
				if (host.slots[i]) { s.instance_vars[1] = host.slots[i][0]; s.instance_vars[2] = host.slots[i][1]; }
			});
			var arr = rt.types_by_index[17].instances[0].arr;
			host.arr.forEach(function (row, i) { if (arr[i]) { arr[i][0][0] = row[0]; arr[i][1][0] = row[1]; } });
			applyItems(host.items);
			return;
		}

		// in a level: mirror the host
		setVar("timeOut", 1);            // never tag locally; the host decides
		if (net.platsMsg && net.platsMsg.L === host.L && net.platsFor !== rt.running_layout) {
			net.platsFor = rt.running_layout;
			applyPlatforms(net.platsMsg.list);
		}
		if (!floors || floors.layout !== rt.running_layout) floors = buildFloors();
		if (gvar("gameState") !== host.gs) window.c2_callFunction("Set_GameState", [host.gs]);
		if (gvar("taggerID") !== host.tg && host.gs === "Game") window.c2_callFunction("Tag", [host.tg]);
		var t29 = instances(29)[0];
		if (t29) t29.instance_vars[0] = host.tm + 1;
		if (host.items) applyItems(host.items);
		// players the host doesn't have (only happens if we joined mid-round)
		instances(T_PLAYER).forEach(function (i) {
			if (!host.p.some(function (p) { return p[0] === i.instance_vars[2]; })) rt.DestroyInstance(i);
		});

		var mine = instances(T_PLAYER);
		host.p.forEach(function (p) {
			var inst = mine.filter(function (i) { return i.instance_vars[2] === p[0]; })[0];
			if (!inst) inst = spawnPlayer(p[0], p[1], p[2], p[3], p[4]);
			if (!inst) return;
			var plat = inst.behavior_insts[0], prev = lastSeen.get(inst) || { dy: 0, floor: true };
			plat.enabled = false;
			inst.x = p[3]; inst.y = p[4];
			inst.set_bbox_changed();
			plat.dx = p[5]; plat.dy = p[6];
			plat.lastFloorObject = floors.map.get(p[7]) || null;
			inst.instance_vars[3] = p[8];
			// the jump/land animations and sounds hang off these triggers
			if (prev.dy >= 0 && p[6] < -200) rt.trigger(cr.behaviors.Platform.prototype.cnds.OnJump, inst);
			if (!prev.floor && p[7]) rt.trigger(cr.behaviors.Platform.prototype.cnds.OnLand, inst);
			lastSeen.set(inst, { dy: p[6], floor: !!p[7] });
		});

		if (host.gs !== "Game" || !net.myBots.length) return;
		var cfg = LEVELS[net.shared.level] || LEVELS.medium;
		ensureWorld(cfg);
		if (!world) return;
		botKeys = {};
		var all = snapshot();
		all.forEach(function (me) {
			if (net.myBots.indexOf(me.input) < 0) return;
			var bot = bots[me.input] || (bots[me.input] = new Bot(me.input));
			bot.tick(me, all, cfg);
		});
		net.conn.send({ t: "bots", b: net.myBots.map(function (id) { return [id, botKeys[id] || 0]; }) });
	}

	function guestAfterLogic() {
		var host = net.host;
		if (host && host.t === "s" && host.L === rt.running_layout.name) setText(instances(29)[0], String(host.tm));
	}

	// Menu entries: which one is highlighted, and the text of left/right options.
	function menuItems() {
		return instances(7).map(function (i) { return [i.instance_vars[2], i.instance_vars[5], i.text]; });
	}

	function applyItems(items) {
		instances(7).forEach(function (inst, i) {
			var it = items[i];
			if (!it) return;
			inst.instance_vars[2] = it[0]; inst.instance_vars[5] = it[1];
			setText(inst, it[2]);
		});
	}

	var botKeys = {};
	function guestBotInput(id, what) {
		if (BITS[what]) botKeys[id] = (botKeys[id] || 0) | BITS[what];
	}

	function buildFloors() {
		var map = new Map();
		rt.types_by_index.forEach(function (type) {
			if (type.is_family) return;
			type.instances.forEach(function (i) {
				if (i.extra && (i.extra.solidEnabled || i.extra.jumpthruEnabled) && !i.extra.isPlatformBehavior) map.set(floorKey(i), i);
			});
		});
		return { layout: rt.running_layout, map: map };
	}

	function applyPlatforms(list) {
		[21, 22, 23, 36].forEach(function (ti) {
			instances(ti).slice().forEach(function (i) { if (i.instance_vars[0]) rt.DestroyInstance(i); });
		});
		var layer = rt.getLayerByName("Map");
		list.forEach(function (p) {
			var i = rt.createInstance(rt.types_by_index[p[0]], layer, p[1], p[2]);
			if (!i) return;
			i.width = p[3]; i.height = p[4]; i.angle = p[5];
			i.instance_vars[0] = 1;
			i.set_bbox_changed();
		});
		floors = null;
		world = null;
	}

	// While online as a friend, keys go to the host instead of this device's game.
	["keydown", "keyup"].forEach(function (type) {
		window.addEventListener(type, function (ev) {
			if (net.role !== "guest" || !net.conn || ev.target.tagName === "INPUT") return;
			ev.stopPropagation();
			var k = KEYMAP[ev.code];
			if (!k) return;
			ev.preventDefault();
			if (!ev.repeat && net.conn.open) net.conn.send({ t: "key", k: k, down: type === "keydown" });
		}, true);
	});

	// ---- the game's look: its menu pixel font and slot-box frames ----

	// The menu font sheet: 12x15 cells, 13 to a row (lowercase rows look the same as capitals).
	var FONT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:?!-_~#\"'&()[]|`\\/@\u00b0+=*$\u00a3\u20ac<>";

	function esc(t) {
		return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
	}

	// Text in that font, at a whole-pixel scale; words wrap like normal text.
	function px(str, scale) {
		scale = scale || 1;
		return String(str).split(" ").map(function (word) {
			var out = "";
			for (var i = 0; i < word.length; i++) {
				var k = FONT_CHARS.indexOf(word[i]);
				if (k < 0) continue;
				out += '<i style="background-position:' + (-(k % 13) * 12 * scale) + "px " + (-Math.floor(k / 13) * 15 * scale) + 'px">' + esc(word[i]) + "</i>";
			}
			return '<span class="px s' + scale + '">' + out + "</span>";
		}).join(" ");
	}

	// ---- name and ping tags over players ----

	function pingLevel(ms) { return ms < 80 ? "good" : ms < 160 ? "ok" : "bad"; }

	var tagEls = [];
	function drawTags() {
		var tags = [];
		var layer = rt.getLayerByName("Players");
		if (layer && rt.running_layout.name !== "Menu" && prefs.tags) {
			instances(T_PLAYER).forEach(function (p) {
				var slot = p.instance_vars[2], ping = net.pings[p.instance_vars[4]];
				var text = (slot >= 4 ? "P" + (slot + 1) : "") + (ping !== undefined ? (slot >= 4 ? " - " : "") + (ping ? ping + "ms" : "...") : "");
				if (!text) return;
				tags.push({ html: px(text, 1) + (ping ? '<b class="sig ' + pingLevel(ping) + '"><i></i><i></i><i></i></b>' : ""),
					x: layer.layerToCanvas(p.x, p.y - 44, true), y: layer.layerToCanvas(p.x, p.y - 44, false) });
			});
		}
		var rect = rt.canvas.getBoundingClientRect();
		while (tagEls.length < tags.length) {
			var el = document.createElement("div");
			el.className = "pingTag";
			document.body.appendChild(el);
			tagEls.push(el);
		}
		tagEls.forEach(function (el, i) {
			var t = tags[i];
			el.style.display = t ? "flex" : "none";
			if (!t) return;
			if (el.__html !== t.html) { el.innerHTML = t.html; el.__html = t.html; }
			el.style.left = rect.left + t.x + "px";
			el.style.top = rect.top + t.y + "px";
		});
	}

	// ---------- panel ----------
	// Two boxes docked into the player-select screen, either side of the menu text
	// and under the player slots. They're laid out in the game's own 1024x576
	// coordinates and scaled with the canvas, so they move and resize with the game.

	// shared: a friend's copy shows (and, if allowed, changes) the host's value
	var SELECTORS = {
		count: { label: "BOTS", values: [0, 1, 2, 3, 4, 5] },
		level: { label: "LEVEL", values: ["easy", "medium", "hard", "impossible"], shared: true },
		limit: { label: "MAX", values: [2, 3, 4, 5, 6], shared: true },
		flash: { label: "FLASH", values: [0, 1, 2, 3], shared: true, show: function (v) { return v ? "LEVEL " + v : "OFF"; } },
		sons: { label: "", values: [0, 1], show: function (v) { return v ? "YES" : "NO"; } }
	};

	// What a picker shows: your own settings, or the host's while you're their friend.
	function shownValue(k) {
		if (net.role !== "guest") return settings[k];
		if (k === "count") return net.shared.sons ? settings.count : 0;   // your own bots, if you're allowed any
		return net.shared[k];
	}

	// "< VALUE >" pickers, like the game's own "MAP: < A >" menu rows.
	function selector(key) {
		return '<div class="bp-sel" data-k="' + key + '"><span class="bp-lab">' + px(SELECTORS[key].label) + "</span>" +
			'<button data-step="-1">' + px("<") + '</button><span class="bp-val"></span><button data-step="1">' + px(">") + "</button></div>";
	}

	var panel = document.createElement("div");
	panel.id = "botPanel";
	panel.innerHTML =
		'<div class="bp-box bp-left">' +
		'<div class="bp-title">' + px("CPU PLAYERS", 2) + "</div>" +
		selector("count") + selector("level") + selector("limit") + selector("flash") +
		'<div class="bp-note bp-test"></div>' +
		'<div class="bp-extras"></div>' +
		"</div>" +
		'<div class="bp-box bp-right">' +
		'<div class="bp-title">' + px("ONLINE", 2) + "</div>" +
		'<div class="bp-online"></div>' +
		'<div class="bp-note">' + px("THY SONS CHANGE SETTINGS?") + "</div>" + selector("sons") +
		"</div>";

	// Frames copied from the game's player-slot boxes: black outline, thick white
	// border, black inner line, see-through black (or player-colour) fill.
	var FRAME = "border:4px solid #fff;box-shadow:0 0 0 2px #000,inset 0 0 0 2px #000";
	var style = document.createElement("style");
	style.textContent =
		"#botPanel{position:fixed;left:0;top:0;width:1024px;height:576px;transform-origin:0 0;z-index:10;display:none;" +
		"pointer-events:none;color:#fff;user-select:none;font:14px/1 monospace}" +
		// the free columns either side of the menu text, below the slots and above the notification line
		"#botPanel .bp-box{position:absolute;top:282px;width:268px;box-sizing:border-box;padding:10px 12px 8px;pointer-events:auto;" +
		"background:rgba(0,0,0,.59);border-radius:12px;" + FRAME + ",0 5px 0 2px #000}" +
		"#botPanel .bp-left{left:10px}#botPanel .bp-right{left:746px}" +
		"#botPanel .bp-title{margin-bottom:8px}" +
		"#botPanel .bp-sel{display:flex;align-items:center;gap:6px;margin:3px 0}" +
		"#botPanel .bp-lab{width:56px;flex:none}" +
		"#botPanel .bp-val{flex:1;text-align:center}" +
		"#botPanel .bp-row{display:flex;align-items:center;gap:6px;margin:6px 0;flex-wrap:wrap}" +
		"#botPanel button{background:rgba(0,0,0,.45);border-radius:8px;padding:5px 7px 3px;cursor:pointer;" + FRAME.replace("4px", "3px") +
		",0 4px 0 2px #000;margin-bottom:4px;line-height:0}" +
		"#botPanel .bp-sel button{padding:3px 5px 1px}" +
		"#botPanel button:hover{background:rgba(255,255,255,.2)}" +
		"#botPanel button:active{transform:translateY(3px);box-shadow:0 0 0 2px #000,inset 0 0 0 2px #000}" +
		"#botPanel button.go{background:#0c81ed}" +                  // the blue player's fill
		"#botPanel button:disabled{opacity:.35;cursor:default}" +
		"#botPanel .bp-code{display:inline-block;margin:4px 0;padding:7px 10px 5px;border-radius:10px;background:#e4453a;" + FRAME + ",0 5px 0 2px #000}" +
		"#botPanel .bp-codebox{position:relative;display:inline-block;margin-bottom:4px}" +
		"#botPanel .bp-codebox input{width:92px;height:31px;box-sizing:border-box;padding:0 8px;border-radius:8px;background:rgba(0,0,0,.45);" +
		"color:transparent;caret-color:#fff;font:16px monospace;letter-spacing:4px;outline:none;" + FRAME.replace("4px", "3px") + ",0 4px 0 2px #000}" +
		"#botPanel .bp-codebox .bp-typed{position:absolute;left:10px;top:8px;pointer-events:none}" +
		"#botPanel .bp-codebox .bp-typed.dim{opacity:.45}" +
		"#botPanel .bp-note{margin:6px 0;line-height:18px;opacity:.85}" +
		"#botPanel .bp-note button{vertical-align:middle;margin:0 0 3px 4px;padding:3px 5px 1px}" +
		// touch controls, in the slot-box look
		"#touchPad{position:fixed;inset:0;z-index:60;display:none;pointer-events:none}" +
		"#touchPad .tp-stick{position:absolute;left:calc(22px + env(safe-area-inset-left));bottom:calc(22px + env(safe-area-inset-bottom));" +
		"width:150px;height:150px;border-radius:24px;background:rgba(0,0,0,.4);pointer-events:auto;touch-action:none;opacity:.85;" + FRAME + ",0 5px 0 2px #000}" +
		"#touchPad .tp-knob{position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px 0 0 -31px;border-radius:14px;background:#fff;" +
		"box-shadow:0 0 0 3px #000,0 4px 0 3px #000;pointer-events:none}" +
		"#touchPad .tp-buttons{position:absolute;right:calc(22px + env(safe-area-inset-right));bottom:calc(22px + env(safe-area-inset-bottom));" +
		"display:flex;align-items:flex-end;gap:16px;pointer-events:auto;touch-action:none}" +
		"#touchPad button{border-radius:20px;cursor:pointer;opacity:.9;touch-action:none;" + FRAME + ",0 5px 0 2px #000}" +
		"#touchPad .tp-jump{width:108px;height:108px;background:#0c81ed}" +
		"#touchPad .tp-ok{width:76px;height:60px;background:rgba(0,0,0,.45)}" +
		"#touchPad button.down{transform:translateY(4px);box-shadow:0 0 0 2px #000,inset 0 0 0 2px #000}" +
		// moonwalk cooldown bar under a player
		".mwBar{position:fixed;z-index:5;width:30px;height:5px;transform:translate(-50%,0);pointer-events:none;" +
		"background:rgba(0,0,0,.55);box-shadow:0 0 0 1px #000;border-radius:2px;overflow:hidden}" +
		".mwBar i{display:block;height:100%;background:#fff}" +
		// the pixel font itself
		".px{display:inline-flex;white-space:nowrap;vertical-align:middle}" +
		".px i{display:block;font-style:normal;font-size:0;color:transparent;background:url(menutext.png) no-repeat;image-rendering:pixelated}" +
		".px.s1 i{width:12px;height:15px;margin-right:-1px;background-size:156px 120px}" +
		".px.s2 i{width:24px;height:30px;margin-right:-2px;background-size:312px 240px}" +
		".px.s3 i{width:36px;height:45px;margin-right:-3px;background-size:468px 360px}" +
		// if the font sheet can't load, plain text instead of nothing
		".nopx .px i{width:auto!important;height:auto;margin:0;background:none;font:700 13px monospace;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000}" +
		".nopx .px.s2 i{font-size:20px}.nopx .px.s3 i{font-size:28px}" +
		".pingTag{position:fixed;z-index:5;transform:translate(-50%,-100%);pointer-events:none;display:flex;align-items:flex-end;gap:4px}" +
		".pingTag .sig{display:flex;align-items:flex-end;gap:1px;padding-bottom:2px}" +
		".pingTag .sig i{width:3px;background:currentColor;box-shadow:0 0 0 1px #000}" +
		".pingTag .sig i:nth-child(1){height:4px}.pingTag .sig i:nth-child(2){height:7px}.pingTag .sig i:nth-child(3){height:10px}" +
		".pingTag .sig.good{color:#7cfc9a}.pingTag .sig.ok{color:#f4b923}.pingTag .sig.ok i:nth-child(3){opacity:.25}" +
		".pingTag .sig.bad{color:#e4453a}.pingTag .sig.bad i:nth-child(n+2){opacity:.25}";

	(function () {
		var sheet = new Image();
		sheet.onerror = function () { document.documentElement.classList.add("nopx"); };
		sheet.src = "menutext.png";
	})();

	function refreshButtons() {
		panel.querySelectorAll(".bp-sel").forEach(function (sel) {
			var k = sel.getAttribute("data-k"), def = SELECTORS[k], raw = shownValue(k);
			var v = raw === undefined ? "..." : String(def.show ? def.show(raw) : raw).toUpperCase();
			var val = sel.querySelector(".bp-val");
			if (val.__v !== v) { val.innerHTML = px(v); val.__v = v; }
			// in someone else's game everything is theirs to allow; the toggle itself is only theirs
			var locked = net.role === "guest" && (k === "sons" || !net.shared.sons);
			sel.querySelectorAll("button").forEach(function (b) { b.disabled = locked; });
		});
	}

	function setHtml(el, html) {
		// only rebuild when something changed, so the code box keeps focus while typing
		if (el.__last === html) return;
		var input = el.querySelector("input"), typed = input && input.value, focused = input && document.activeElement === input;
		el.innerHTML = html;
		el.__last = html;
		var fresh = el.querySelector("input");
		if (fresh && typed) { fresh.value = typed; showTyped(fresh); }
		if (fresh && focused) fresh.focus();
	}

	// The code box shows what you type in the pixel font.
	function showTyped(input) {
		var out = input.parentNode.querySelector(".bp-typed");
		out.innerHTML = px(input.value.toUpperCase() || "CODE");
		out.classList.toggle("dim", !input.value);
	}

	function note(text) { return '<div class="bp-note">' + px(text) + "</div>"; }

	function renderOnline() {
		var t = net.test;
		setHtml(panel.querySelector(".bp-test"), net.role === "guest" ? px(net.shared.sons ? "THE HOST LETS YOU CHANGE THESE" : "SETTINGS ARE THE HOST'S") :
			net.testing ? px("TESTING THIS DEVICE...") :
			t ? px("SUGGESTED: " + t.suggest) + ' <button data-a="retest">' + px("RE-TEST") + "</button>" : "");

		setHtml(panel.querySelector(".bp-extras"), extras.length ? note(extras.map(function (e, i) {
			return "P" + (i + 5) + ": " + e.color + " " + (slotLabel(e.id) || (net.role === "guest" && net.pings[e.id] !== undefined ? net.pings[e.id] + "MS" : "CPU"));
		}).join("  ")) : "");

		var html;
		if (net.role === "host") {
			html = '<div class="bp-row">' + px("CODE") + '<div class="bp-code">' + px(net.peer && net.peer.open ? net.code : "...", 2) + "</div></div>" +
				note("FRIENDS: " + (net.guests.length ? net.guests.map(function (g) {
					return (g.ping ? g.ping + "MS" : "JOINING") + (g.bots.length ? " & " + g.bots.length + " BOT" + (g.bots.length > 1 ? "S" : "") : "");
				}).join(", ") : "NONE YET")) + '<button data-a="stop">' + px("STOP HOSTING") + "</button>";
		} else if (net.role === "guest") {
			html = note((net.status || "Connected") + (net.ping ? " - " + net.ping + "MS" : "") +
				(net.myBots.length ? " - YOUR BOTS RUN HERE" : "")) + '<button data-a="stop">' + px("LEAVE") + "</button>";
		} else {
			html = '<div class="bp-row"><button data-a="host">' + px("HOST GAME") + "</button></div>" +
				'<div class="bp-row"><span class="bp-codebox"><input maxlength="5" aria-label="Room code"><span class="bp-typed dim">' + px("CODE") + "</span></span>" +
				'<button class="go" data-a="join">' + px("JOIN") + "</button></div>";
		}
		if (net.status && net.role !== "guest") html += note(net.status);
		setHtml(panel.querySelector(".bp-online"), html);
	}

	panel.addEventListener("input", function (ev) {
		if (ev.target.tagName === "INPUT") showTyped(ev.target);
	});

	panel.addEventListener("click", function (ev) {
		var a = ev.target.closest("[data-a]");
		if (a) {
			ev.preventDefault();
			var act = a.getAttribute("data-a");
			if (act === "host") startHosting();
			else if (act === "join") joinRoom(panel.querySelector(".bp-online input").value);
			else if (act === "stop") stopOnline();
			else if (act === "retest") deviceTest();
			a.blur();
			return;
		}
		var b = ev.target.closest("button[data-step]");
		if (!b) return;
		var k = b.parentNode.getAttribute("data-k"), list = SELECTORS[k].values;
		var next = list[(list.indexOf(shownValue(k)) + +b.getAttribute("data-step") + list.length) % list.length];
		b.blur();
		if (net.role === "guest" && SELECTORS[k].shared) {
			// the host applies it (if they allow it) and it comes back in their next update
			if (net.conn && net.conn.open) net.conn.send({ t: "set", k: k, v: next });
			return;
		}
		settings[k] = next;
		if (k === "limit") settings.limitPicked = true;
		if (k === "sons" && !next) net.guests.forEach(function (g) {
			// sons lost the privilege: their bots go home
			g.bots.forEach(function (id) { unseat(id); delete net.boosts[id]; });
			g.bots = [];
			g.conn.send({ t: "seats", human: g.human, bots: [] });
		});
		saveSettings();
		refreshButtons();
		renderOnline();
		if (net.role === "guest") sendWant();
	});
	["mousedown", "mouseup", "touchstart", "touchend", "pointerdown"].forEach(function (t) {
		panel.addEventListener(t, function (ev) { ev.stopPropagation(); });
	});
	// typing a room code shouldn't press WASD in the game
	["keydown", "keyup", "keypress"].forEach(function (t) {
		panel.addEventListener(t, function (ev) {
			ev.stopPropagation();
			if (t === "keydown" && ev.key === "Enter" && ev.target.tagName === "INPUT") joinRoom(ev.target.value);
		});
	});

	// Pin the panel's 1024x576 space onto wherever the game canvas is drawn.
	function placePanel() {
		if (!rt || !rt.canvas) return;
		var r = rt.canvas.getBoundingClientRect(), s = Math.min(r.width / 1024, r.height / 576);
		var x = r.left + (r.width - 1024 * s) / 2, y = r.top + (r.height - 576 * s) / 2;
		panel.style.transform = "translate(" + x + "px," + y + "px) scale(" + s + ")";
	}
	window.addEventListener("resize", placePanel);

	function updatePanel() {
		var show = rt && gvar("gameState") === "Menu" && gvar("currMenu") === "Players";
		if (net.role === "guest" && net.status !== "Connected") show = true;
		panel.style.display = show ? "block" : "none";
		if (show) placePanel();
		refreshButtons();
		renderOnline();
		updateCorner();
	}

	// ---------- settings and the guide ----------
	// Two buttons by the game's fullscreen/sound buttons: "?" opens a paged guide to
	// everything (with keyboard and touch versions of the controls), the gear opens
	// settings for this device. The guide opens by itself the first time.

	var PREFS = {
		intro:   { label: "INTRO", values: [1, 0], show: function (v) { return v ? "ON" : "SKIP"; } },
		volume:  { label: "EFFECTS VOLUME", values: [0, 25, 50, 75, 100], show: function (v) { return v ? String(v) : "OFF"; } },
		gentle:  { label: "FLASHING", values: [0, 1], show: function (v) { return v ? "GENTLE" : "FULL"; } },
		shake:   { label: "SCREEN SHAKE", values: [1, 0], show: function (v) { return v ? "ON" : "OFF"; } },
		popups:  { label: "DUNK AND MJ", values: [1, 0], show: function (v) { return v ? "ON" : "OFF"; } },
		tags:    { label: "PING TAGS", values: [1, 0], show: function (v) { return v ? "ON" : "OFF"; } },
		tap:     { label: "DOUBLE-TAP", values: [0.25, 0.35, 0.5], show: function (v) { return v === 0.25 ? "FAST" : v === 0.35 ? "NORMAL" : "SLOW"; } },
		touch:   { label: "TOUCH PAD", values: ["auto", "on", "off"], show: function (v) { return v.toUpperCase(); } },
		padSize: { label: "PAD SIZE", values: [0.8, 1, 1.25], show: function (v) { return v < 1 ? "SMALL" : v > 1 ? "BIG" : "NORMAL"; } },
		padSide: { label: "STICK SIDE", values: [0, 1], show: function (v) { return v ? "RIGHT" : "LEFT"; } }
	};
	var prefs = {};
	var PREF_DEFAULTS = { volume: 100, tap: 0.35, padSize: 1 };   // the rest default to their first value
	function defaultPrefs() {
		Object.keys(PREFS).forEach(function (k) { prefs[k] = k in PREF_DEFAULTS ? PREF_DEFAULTS[k] : PREFS[k].values[0]; });
	}
	defaultPrefs();
	try {
		var savedPrefs = JSON.parse(localStorage.getItem("tagPrefs")) || {};
		Object.keys(PREFS).forEach(function (k) { if (PREFS[k].values.indexOf(savedPrefs[k]) >= 0) prefs[k] = savedPrefs[k]; });
	} catch (e) {}

	function applyPrefs() {
		try { localStorage.setItem("tagPrefs", JSON.stringify(prefs)); } catch (e) {}
		MW.TAP_GAP = prefs.tap;
		if (fb.master) fb.master.gain.value = prefs.volume / 100;
		if (fb.canvas) fb.canvas.style.opacity = prefs.gentle ? 0.55 : 1;
		if (touch.el) {
			touch.el.style.setProperty("--pad", prefs.padSize);
			touch.el.classList.toggle("lefty", !!prefs.padSide);
			if (prefs.touch === "on") showTouch(true, true);
			if (prefs.touch === "off") showTouch(false, true);
		}
	}

	// ---- the guide ----
	// [X] in a line becomes a key cap. A line can be {keys, touch} for the two control styles.
	var GUIDE = [
		{ title: "THE GAME", lines: [
			"ONE PLAYER IS IT: THE ONE WITH THE ARROW OVER THEM.",
			"IT TOUCHES SOMEONE TO PASS IT ON. AFTER A TAG THERE'S A 3-2-1 BEFORE THE NEW TAGGER CAN TAG.",
			"DON'T BE IT WHEN THE TIMER RUNS OUT.",
			"ORANGE JELLY MAKES YOU FAST, BLUE JELLY BOUNCES YOU HIGH, AND YOU CAN JUMP UP THROUGH PINK JELLY."] },
		{ title: "MOVING", lines: [
			{ keys: "PLAYER 1: [W] [A] [S] [D]    PLAYER 2: THE ARROW KEYS", touch: "THE STICK MOVES YOU." },
			{ keys: "PLAYER 3: [T] [F] [G] [H]    PLAYER 4: [I] [J] [K] [L]", touch: "[JUMP] OR PUSHING THE STICK UP JUMPS." },
			{ keys: "UP JUMPS. DOWN DROPS YOU THROUGH PINK JELLY.", touch: "PUSH THE STICK DOWN TO DROP THROUGH PINK JELLY." },
			{ keys: "GAMEPADS WORK TOO: STICK TO MOVE, [A] JUMPS, [X] DROPS.", touch: "THE PAD SHOWS UP WHEN YOU TOUCH THE SCREEN, AND HIDES WHEN YOU USE A KEYBOARD." }] },
		{ title: "JOINING", lines: [
			{ keys: "ON THE PLAYER SCREEN, PRESS ANY OF YOUR KEYS TO JOIN.", touch: "ON THE PLAYER SCREEN, PUSH THE STICK TO JOIN." },
			"THEN LEFT AND RIGHT PICK YOUR COLOUR. THERE ARE 16. DOWN LEAVES.",
			{ keys: "[SPACE] OR [ENTER] STARTS ONCE 2 OR MORE ARE IN.", touch: "[OK] STARTS ONCE 2 OR MORE ARE IN." },
			"IN THE MENU, UP AND DOWN PICK, LEFT AND RIGHT CHANGE MAP, TIMER AND OPTIONS."] },
		{ title: "CPU PLAYERS", lines: [
			"THE CPU PLAYERS BOX ON THE PLAYER SCREEN ADDS UP TO 5 BOTS.",
			"LEVELS: EASY, MEDIUM, HARD AND IMPOSSIBLE. IMPOSSIBLE BOTS ARE FASTER THAN THE RULES ALLOW.",
			"MAX IS HOW MANY CAN PLAY, UP TO 6. PLAYERS 5 AND 6 GET A LABEL OVER THEM.",
			"THE DEVICE TEST SUGGESTS A MAX THAT WON'T LAG. RE-TEST TO RUN IT AGAIN."] },
		{ title: "MOONWALK", lines: [
			{ keys: "WHILE RUNNING, DOUBLE-TAP BACKWARDS. RUNNING RIGHT: HOLD [D], TAP [A] [A].", touch: "WHILE RUNNING, FLICK THE STICK BACKWARDS TWICE." },
			"YOU GLIDE BACKWARDS, STILL FACING FORWARDS, AND CAN'T BE TAGGED FOR HALF A SECOND.",
			"THEN IT RECHARGES FOR 4 SECONDS: WATCH THE BAR UNDER YOU.",
			"ONLY RUNNERS CAN DO IT, NOT WHOEVER IS IT. HARD BOTS KNOW HOW TOO."] },
		{ title: "FLASHBANGS", lines: [
			"SET FLASH IN THE CPU PLAYERS BOX.",
			"LEVEL 1: YOU GET FLASHBANGED WHEN YOU GET TAGGED.",
			"LEVEL 2: ALSO WHEN YOU'RE IT AND GET JUKED, OR WHEN YOU CAMP ONE PLATFORM FOR 4 SECONDS.",
			"LEVEL 3: ALL OF THAT FOR EVERYONE, PLUS EVERY DOUBLE JUMP. TOO MUCH? TRY GENTLE FLASHING IN SETTINGS."] },
		{ title: "ONLINE", lines: [
			"HOST GAME GIVES YOU A 5 LETTER CODE. FRIENDS TYPE IT IN AND PRESS JOIN.",
			"EVERYONE'S PING SHOWS OVER THEIR PLAYER.",
			"THY SONS CHANGE SETTINGS? YES LETS FRIENDS CHANGE SETTINGS, BRING THEIR OWN BOTS AND USE THE MENUS.",
			{ keys: "FRIENDS JOIN A SLOT WITH THEIR OWN KEYS, LIKE AT HOME.", touch: "FRIENDS ON PHONES JOIN WITH THE STICK, LIKE AT HOME." }] },
		{ title: "SETTINGS", lines: [
			"THE GEAR BUTTON HAS SOUND, FLASHING, SHAKE, POP-UPS, PING TAGS, THE INTRO, DOUBLE-TAP SPEED AND THE TOUCH PAD.",
			"SETTINGS ARE KEPT ON THIS DEVICE.",
			"[?] OPENS THIS GUIDE AGAIN."] }
	];

	var modal = { el: null, kind: null, page: 0, mode: "keys" };

	// Pixel text where [X] becomes a little key cap.
	function guideText(line) {
		return line.split(/(\[[^\]]+\])/).map(function (part) {
			if (/^\[.+\]$/.test(part)) return '<span class="tm-key">' + px(part.slice(1, -1)) + "</span>";
			return px(part.trim());
		}).join(" ");
	}

	function renderModal() {
		var box = modal.el.querySelector(".tm-box"), html;
		if (modal.kind === "guide") {
			var page = GUIDE[modal.page];
			html = '<div class="tm-head">' + px(page.title, 2) +
				'<span class="tm-tabs"><button data-mode="keys" class="' + (modal.mode === "keys" ? "on" : "") + '">' + px("KEYS") + "</button>" +
				'<button data-mode="touch" class="' + (modal.mode === "touch" ? "on" : "") + '">' + px("TOUCH") + "</button></span>" +
				'<button data-m="close">' + px("X") + "</button></div>" +
				'<div class="tm-body">' + page.lines.map(function (l) {
					return '<div class="tm-line">' + guideText(typeof l === "string" ? l : l[modal.mode]) + "</div>";
				}).join("") + "</div>" +
				'<div class="tm-foot"><button data-m="prev">' + px("<") + "</button>" +
				px((modal.page + 1) + " / " + GUIDE.length) + '<button data-m="next">' + px(">") + "</button></div>";
		} else {
			html = '<div class="tm-head">' + px("SETTINGS", 2) + '<button data-m="close">' + px("X") + "</button></div>" +
				'<div class="tm-body tm-prefs">' + Object.keys(PREFS).map(function (k) {
					return '<div class="tm-pref" data-p="' + k + '"><span class="tm-lab">' + px(PREFS[k].label) + "</span>" +
						'<button data-step="-1">' + px("<") + '</button><span class="tm-val">' + px(PREFS[k].show(prefs[k])) + "</span>" +
						'<button data-step="1">' + px(">") + "</button></div>";
				}).join("") + "</div>" +
				'<div class="tm-foot"><button data-m="reset">' + px("RESET") + '</button><button data-m="close" class="go">' + px("DONE") + "</button></div>";
		}
		box.innerHTML = html;
	}

	function openModal(kind) {
		modal.kind = kind;
		if (kind === "guide") modal.mode = touch.shown ? "touch" : "keys";
		renderModal();
		modal.el.style.display = "block";
		placeOver(modal.el);
	}

	function closeModal() { modal.el.style.display = "none"; modal.kind = null; }

	function flipPage(step) {
		modal.page = (modal.page + step + GUIDE.length) % GUIDE.length;
		renderModal();
	}

	// Lay a 1024x576 layer over wherever the game is drawn.
	function placeOver(el) {
		if (!rt || !rt.canvas) return;
		var r = rt.canvas.getBoundingClientRect(), s = Math.min(r.width / 1024, r.height / 576);
		el.style.transform = "translate(" + (r.left + (r.width - 1024 * s) / 2) + "px," + (r.top + (r.height - 576 * s) / 2) + "px) scale(" + s + ")";
	}

	var cornerButtons = document.createElement("div");
	cornerButtons.id = "tagCorner";
	cornerButtons.innerHTML = '<button data-open="settings" aria-label="Settings">' +
		'<svg viewBox="0 0 16 16" width="34" height="34" shape-rendering="crispEdges"><path fill="#fff" stroke="#000" stroke-width="1" d="M7 1h2v2h1l1-1 2 2-1 1v1h2v2h-2v1l1 1-2 2-1-1h-1v2H7v-2H6l-1 1-2-2 1-1V9H2V7h2V6L3 5l2-2 1 1h1z"/><rect x="6" y="6" width="4" height="4" fill="#000"/></svg></button>' +
		'<button data-open="guide" aria-label="How to play">' + px("?", 3) + "</button>";

	modal.el = document.createElement("div");
	modal.el.id = "tagModal";
	modal.el.innerHTML = '<div class="tm-box"></div>';

	var modalStyle = document.createElement("style");
	modalStyle.textContent =
		"#tagCorner,#tagModal{position:fixed;left:0;top:0;width:1024px;height:576px;transform-origin:0 0;pointer-events:none;color:#fff;user-select:none;font:14px/1 monospace}" +
		"#tagCorner{z-index:11;display:none}#tagModal{z-index:70;display:none}" +
		// beside the game's own fullscreen and sound buttons, in their style
		"#tagCorner button{position:absolute;top:8px;width:64px;height:64px;pointer-events:auto;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;" +
		"background:rgba(255,255,255,.18);border-radius:12px;opacity:.6;" + FRAME + ",0 4px 0 2px #000}" +
		"#tagCorner button:hover{opacity:1}" +
		"#tagCorner button[data-open=guide]{left:830px}#tagCorner button[data-open=settings]{left:760px}" +
		"#tagModal .tm-box{position:absolute;left:112px;top:46px;width:800px;height:484px;box-sizing:border-box;padding:16px 20px;pointer-events:auto;" +
		"display:flex;flex-direction:column;background:rgba(0,0,0,.82);border-radius:16px;" + FRAME + ",0 6px 0 2px #000}" +
		"#tagModal .tm-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}" +
		"#tagModal .tm-head>button:last-child{margin-left:auto}" +
		"#tagModal .tm-tabs{display:flex;gap:6px;margin-left:auto}" +
		"#tagModal .tm-body{flex:1;overflow:auto}" +
		"#tagModal .tm-line{margin:0 0 16px;line-height:22px}" +
		"#tagModal .tm-key{display:inline-block;padding:3px 5px 1px;margin:0 1px;border-radius:5px;background:rgba(255,255,255,.18);box-shadow:0 0 0 2px #fff,0 0 0 4px #000}" +
		"#tagModal .tm-prefs{display:grid;grid-template-columns:1fr 1fr;gap:6px 26px;align-content:start}" +
		"#tagModal .tm-pref{display:flex;align-items:center;gap:6px}" +
		"#tagModal .tm-lab{width:150px;flex:none}#tagModal .tm-val{flex:1;text-align:center}" +
		"#tagModal .tm-foot{display:flex;align-items:center;justify-content:center;gap:16px;margin-top:10px}" +
		"#tagModal button{background:rgba(0,0,0,.45);border-radius:8px;padding:5px 7px 3px;cursor:pointer;line-height:0;" + FRAME.replace("4px", "3px") + ",0 4px 0 2px #000}" +
		"#tagModal button:hover{background:rgba(255,255,255,.2)}" +
		"#tagModal button.on{background:#f4b923}#tagModal button.go{background:#0c81ed}" +
		// touch pad size and side
		"#touchPad .tp-stick{transform:scale(var(--pad,1));transform-origin:0 100%}" +
		"#touchPad .tp-buttons{transform:scale(var(--pad,1));transform-origin:100% 100%}" +
		"#touchPad.lefty .tp-stick{left:auto;right:calc(22px + env(safe-area-inset-right));transform-origin:100% 100%}" +
		"#touchPad.lefty .tp-buttons{right:auto;left:calc(22px + env(safe-area-inset-left));flex-direction:row-reverse;transform-origin:0 100%}";

	cornerButtons.addEventListener("click", function (ev) {
		var b = ev.target.closest("[data-open]");
		if (b) { openModal(b.getAttribute("data-open")); b.blur(); }
	});
	modal.el.addEventListener("click", function (ev) {
		var b = ev.target.closest("button");
		if (!b) return;
		b.blur();
		if (b.hasAttribute("data-mode")) { modal.mode = b.getAttribute("data-mode"); return renderModal(); }
		var m = b.getAttribute("data-m");
		if (m === "close") return closeModal();
		if (m === "prev" || m === "next") return flipPage(m === "prev" ? -1 : 1);
		if (m === "reset") { defaultPrefs(); applyPrefs(); return renderModal(); }
		var row = b.closest("[data-p]");
		if (row) {
			var k = row.getAttribute("data-p"), list = PREFS[k].values;
			prefs[k] = list[(list.indexOf(prefs[k]) + +b.getAttribute("data-step") + list.length) % list.length];
			applyPrefs();
			renderModal();
		}
	});
	[cornerButtons, modal.el].forEach(function (el) {
		["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"].forEach(function (t) {
			el.addEventListener(t, function (ev) { ev.stopPropagation(); });
		});
	});
	// while it's open, keys work the guide instead of the game
	window.addEventListener("keydown", function (ev) {
		if (!modal.kind) return;
		ev.stopPropagation();
		ev.preventDefault();
		if (ev.key === "Escape" || ev.key === "Enter" || ev.key === " ") closeModal();
		else if (modal.kind === "guide" && (ev.key === "ArrowRight" || ev.key === "d" || ev.key === "D")) flipPage(1);
		else if (modal.kind === "guide" && (ev.key === "ArrowLeft" || ev.key === "a" || ev.key === "A")) flipPage(-1);
	}, true);
	window.addEventListener("keyup", function (ev) { if (modal.kind) ev.stopPropagation(); }, true);
	window.addEventListener("resize", function () { placeOver(cornerButtons); if (modal.kind) placeOver(modal.el); });

	function updateCorner() {
		var inMenus = rt && gvar("gameState") !== "Game" && !document.getElementById("splash");
		cornerButtons.style.display = inMenus ? "block" : "none";
		if (inMenus) placeOver(cornerButtons);
		if (modal.kind) placeOver(modal.el);
		// first time here: open the guide
		var seen = true;
		try { seen = !!localStorage.getItem("tagGuideSeen"); } catch (e) {}
		if (inMenus && !seen && !modal.kind && gvar("currMenu") === "Players") {
			try { localStorage.setItem("tagGuideSeen", "1"); } catch (e) {}
			openModal("guide");
		}
	}

	document.head.appendChild(style);
	document.head.appendChild(modalStyle);
	document.body.appendChild(panel);
	document.body.appendChild(cornerButtons);
	document.body.appendChild(modal.el);
	refreshButtons();
	renderOnline();
	/*TEST_EXPORTS*/
	install();
})();
