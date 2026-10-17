// ---- splash screen ----
// Replays one of five recorded bot-vs-bot chases (picked at random) with the game's
// own art and camera. It slows to a crawl and pushes in hard on the catch, cuts to
// black-and-white anime-style impact frames, then the tag sets off a flashbang: the bang, two seconds
// of pure white, then a slow fade back to the logo and caption, and a checker wipe
// into the game. Any key or click skips it. If the browser
// won't play sound until you've pressed something, a "press any key" screen comes
// first so the bang always lands on the flash.
(function () {
	"use strict";

	// the player's settings (see the gear button): skip the intro, volume, flashing, shake
	var prefs = {};
	try { prefs = JSON.parse(localStorage.getItem("tagPrefs")) || {}; } catch (e) {}
	if (prefs.intro === 0) return;
	var VOLUME = prefs.volume === undefined ? 1 : prefs.volume / 100, GENTLE = !!prefs.gentle, SHAKE = prefs.shake !== 0;

	var W = 1024, H = 576;                        // the game's own resolution
	var REPLAYS = __REPLAYS__;                    // recorded at build time, see tools/record.mjs
	var REPLAY = REPLAYS[Math.floor(Math.random() * REPLAYS.length)];
	var FLASHBANG = (window.TAG_MEDIA || {}).flashbang || "";
	var CAPTION_FONT = "__CAPTION_FONT__";
	var CAPTION = "but it's a shit ton better";
	var TOUCH_ONLY = !!(window.matchMedia && matchMedia("(any-pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches);

	// timeline, in seconds of real time
	var TAG = REPLAY.tagAt;                       // when the tag happens in the clip
	var RAMP = 1.35;                              // real seconds of slow-mo into the tag (speed eases 1 -> 0.1)
	var LEAD = RAMP * 0.55;                       // clip seconds that covers
	var T_SLOW = TAG - LEAD, T_IMPACT = T_SLOW + RAMP;
	var IMPACT = ["ink", "negative", "ink", "negative"]; // impact frames, one after another
	var IMPACT_LEN = 0.06;
	var T_FLASH = T_IMPACT + IMPACT.length * IMPACT_LEN;
	var AFTER_SPEED = 0.5;                        // the reveal plays in slow motion
	var HOLD = 2.0, FADE = 1.8;
	var T_FADE = T_FLASH + HOLD, T_DONE = T_FADE + FADE + 1.3;
	var WIPE = 0.75, BANG_AT = 0.05;              // the bang is 50ms into the sound file

	var GREEN = "#7bc847", DIRT = "#382415";
	var ZOOM = 1.25;                              // a bit closer than the game's own camera
	var LOGO_Y = 30;

	var canvas = document.createElement("canvas");
	canvas.id = "splash";
	canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:100;background:" + GREEN;
	document.body.appendChild(canvas);
	var ctx = canvas.getContext("2d");
	var buf = document.createElement("canvas"), bctx = buf.getContext("2d");
	var raw = document.createElement("canvas"), rctx = raw.getContext("2d");   // the plain frame the impact frames are made from

	// ---- art (same files the game loads, through the page's <base>) ----

	var FILES = ["title-sheet0", "title-sheet1", "player-sheet0", "player-sheet1", "taggerind-sheet0", "taggerind-sheet1",
		"taggerind-sheet2", "expld-sheet0", "bg_bubbles", "menutext", "timertext", "orangejelly", "pinkjelly", "bluejelly"];
	var img = {}, loaded = 0, failed = false;
	FILES.forEach(function (name) {
		var i = new Image();
		i.onload = function () { loaded++; };
		i.onerror = function () { failed = true; };
		i.src = name + ".png";
		img[name] = i;
	});

	var LOGO = ["title-sheet1", 1, 1, 320, 192];

	// sprite frames as [sheet, x, y, w, h, hotspot x, hotspot y]
	function player(sheet, cells) {
		return cells.map(function (c) { return [sheet, c[0], c[1], 34, 34, 0.5, 0.97]; });
	}
	var CAUGHT = player("player-sheet0", [[37, 37]]);
	var FRAMES = {
		Red_Idle: player("player-sheet0", [[1, 1], [37, 1], [73, 1], [37, 1]]), Red_Move: player("player-sheet0", [[1, 37]]),
		Blue_Idle: player("player-sheet0", [[73, 37], [1, 73], [37, 73], [1, 73]]), Blue_Move: player("player-sheet0", [[73, 73]]),
		Yellow_Idle: player("player-sheet1", [[1, 1], [37, 1], [73, 1], [37, 1]]), Yellow_Move: player("player-sheet1", [[1, 37]]),
		Purple_Idle: player("player-sheet1", [[37, 37], [73, 37], [1, 73], [73, 37]]), Purple_Move: player("player-sheet1", [[37, 73]]),
		Red_Caught: CAUGHT, Blue_Caught: CAUGHT, Yellow_Caught: CAUGHT, Purple_Caught: CAUGHT,
		Default: [["taggerind-sheet0", 1, 47, 24, 14, 0.5, 2.857]],
		Anim: [["taggerind-sheet1", 1, 1, 24, 44, 0.5, 1.59], ["taggerind-sheet1", 27, 1, 24, 44, 0.5, 1.59],
			["taggerind-sheet2", 0, 0, 24, 44, 0.5, 1.59], ["taggerind-sheet0", 1, 1, 52, 44, 0.5, 1.59], ["taggerind-sheet0", 1, 47, 24, 14, 0.5, 2.857]],
		x32: [["expld-sheet0", 1, 51, 32, 32, 0.5, 0.5], ["expld-sheet0", 35, 51, 32, 32, 0.5, 0.5]],
		x48: [["expld-sheet0", 1, 1, 48, 48, 0.5, 0.5], ["expld-sheet0", 51, 1, 48, 48, 0.5, 0.5]]
	};

	function sprite(c, anim, frame, x, y, w, h, angle) {
		var set = FRAMES[REPLAY.anims[anim]];
		if (!set) return;
		var f = set[frame % set.length];
		c.save();
		c.translate(x, y);
		if (angle) c.rotate(angle);
		c.scale(w < 0 ? -1 : 1, 1);
		w = Math.abs(w);
		c.drawImage(img[f[0]], f[1], f[2], f[3], f[4], -w * f[5], -h * f[6], w, h);
		c.restore();
	}

	function blit(c, f, x, y, w, h) {
		c.drawImage(img[f[0]], f[1], f[2], f[3], f[4], x, y, w, h);
	}

	// The menu's sprite font: 12x15 cells, 13 to a row.
	var CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	function text(c, str, cx, cy, scale) {
		var w = 12 * scale, x = cx - str.length * w / 2;
		for (var i = 0; i < str.length; i++, x += w) {
			var k = CHARSET.indexOf(str[i]);
			if (k >= 0) c.drawImage(img.menutext, (k % 13) * 12, Math.floor(k / 13) * 15, 12, 15, x, cy - 7.5 * scale, w, 15 * scale);
		}
	}

	// The in-game timer's digits: 16x26 cells.
	function timer(c, n, cx, cy) {
		var s = String(n), w = 32, x = cx - s.length * w / 2;
		for (var i = 0; i < s.length; i++, x += w) c.drawImage(img.timertext, +s[i] * 16, 0, 16, 26, x, cy, w, 52);
	}

	// ---- the caption, in the logo's style: white, thick black outline, grey depth ----

	var captionReady = false;
	try {
		var face = new FontFace("TagCaption", "url(data:font/woff2;base64," + CAPTION_FONT + ")");
		document.fonts.add(face);
		face.load().then(function () { captionReady = true; }, function () { captionReady = true; });
	} catch (e) { captionReady = true; }

	// The logo and caption are simply there once the white lifts, swaying gently.
	function caption(c, t) {
		if (t < T_FLASH) return;
		c.save();
		c.translate(W / 2, LOGO_Y + 300 + Math.sin(t * 2.2 + 0.6) * 3);
		c.rotate(-0.035 + Math.sin(t * 1.7) * 0.01);
		c.font = "700 50px TagCaption, 'Arial Rounded MT Bold', sans-serif";
		c.textAlign = "center";
		c.textBaseline = "middle";
		c.lineJoin = "round";
		c.lineWidth = 15;
		c.strokeStyle = "#000";
		c.strokeText(CAPTION, 0, 7);
		c.strokeText(CAPTION, 0, 0);
		c.fillStyle = "#a6a6a6";
		c.fillText(CAPTION, 0, 7);
		c.fillStyle = "#fff";
		c.fillText(CAPTION, 0, 0);
		c.restore();
	}

	// ---- sound ----

	var audio = null, sound = null, voice = null, gain = null;
	try {
		audio = new (window.AudioContext || window.webkitAudioContext)();
		var bin = atob(FLASHBANG), bytes = new Uint8Array(bin.length);
		for (var b = 0; b < bin.length; b++) bytes[b] = bin.charCodeAt(b);
		audio.decodeAudioData(bytes.buffer, function (d) { sound = d; }, function () { audio = null; });
	} catch (e) { audio = null; }

	function scheduleBang() {
		if (!audio || !sound) return;
		voice = audio.createBufferSource();
		voice.buffer = sound;
		gain = audio.createGain();
		gain.gain.value = VOLUME;
		voice.connect(gain).connect(audio.destination);
		voice.start(audio.currentTime + Math.max(0, T_FLASH - BANG_AT));
	}

	function fadeSound(sec) {
		if (!gain) return;
		var now = audio.currentTime;
		gain.gain.cancelScheduledValues(now);
		gain.gain.setValueAtTime(gain.gain.value, now);
		gain.gain.linearRampToValueAtTime(0, now + sec);
		try { voice.stop(now + sec + 0.05); } catch (e) {}
		gain = null;
	}

	// ---- the replay ----

	// Real time to clip time: normal speed, then easing down to a crawl into the tag,
	// frozen on the impact frames, then the aftermath in slow motion.
	function clipTime(t) {
		if (t < T_SLOW) return t;
		if (t < T_IMPACT) { var u = t - T_SLOW; return T_SLOW + u - 0.45 * u * u / RAMP; }
		if (t < T_FLASH) return TAG;
		return TAG + (t - T_FLASH) * AFTER_SPEED;
	}

	// Who's doing the catching and who gets caught, read off the clip.
	var TAGGER = REPLAY.frames[0][2], CAUGHT_SLOT = REPLAY.frames[REPLAY.frames.length - 1][2];

	function lerp(a, b, k) { return a + (b - a) * k; }

	// Clip state at time ct: positions blend between recorded frames, everything else snaps.
	function sample(ct) {
		var F = REPLAY.frames, i = 0;
		while (i < F.length - 2 && F[i + 1][0] <= ct) i++;
		var a = F[i], b = F[i + 1] || a, k = b[0] > a[0] ? Math.max(0, Math.min(1, (ct - a[0]) / (b[0] - a[0]))) : 0;
		var players = a[3].map(function (p) {
			var q = b[3].filter(function (x) { return x[0] === p[0]; })[0] || p;
			return [p[0], lerp(p[1], q[1], k), lerp(p[2], q[2], k), lerp(p[3], q[3], k), lerp(p[4], q[4], k), p[5], p[6], p[7]];
		});
		var ind = a[4].map(function (p, n) {
			var q = b[4][n] || p;
			return [lerp(p[0], q[0], k), lerp(p[1], q[1], k), p[2], p[3], p[4], p[5]];
		});
		return { cam: [lerp(a[1][0], b[1][0], k), lerp(a[1][1], b[1][1], k), lerp(a[1][2], b[1][2], k)],
			tagger: a[2], players: players, ind: ind, stars: a[5] };
	}

	var patterns = {};
	function platFill(c, type) {
		var name = { 22: "orangejelly", 23: "pinkjelly", 36: "bluejelly" }[type];
		if (!name) return DIRT;
		if (!patterns[name]) patterns[name] = c.createPattern(img[name], "repeat");
		return patterns[name];
	}

	// Dust like the game's jump puffs and running trail, worked out from the movement.
	var dust = [], lastPos = {};
	function makeDust(players, dt) {
		if (dt <= 0) return;
		players.forEach(function (p) {
			var prev = lastPos[p[0]];
			lastPos[p[0]] = { x: p[1], y: p[2], vy: prev ? (p[2] - prev.y) / dt : 0 };
			if (!prev) return;
			var vx = (p[1] - prev.x) / dt, vy = lastPos[p[0]].vy;
			var burst = prev.vy > 250 && Math.abs(vy) < 40 || Math.abs(prev.vy) < 40 && vy < -300 ? 6 : 0;
			if (Math.abs(vx) > 150 && Math.abs(vy) < 40 && Math.random() < dt * 18) burst = 1;
			for (var n = 0; n < burst; n++)
				dust.push({ x: p[1] + (Math.random() - 0.5) * 24, y: p[2] - 2, vx: (Math.random() - 0.5) * 120 - vx * 0.08,
					vy: -Math.random() * 80, r: 2.5 + Math.random() * 3.5, life: 0.3 + Math.random() * 0.25, age: 0 });
		});
		dust.forEach(function (d) { d.age += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 260 * dt; });
		dust = dust.filter(function (d) { return d.age < d.life; });
	}

	function drawWorld(c, s, t, punch, bg, bare) {
		var cam = s.cam, z = cam[2] * punch.z * ZOOM;
		var cx = lerp(cam[0], punch.x, punch.k), cy = lerp(cam[1], punch.y, punch.k);
		c.save();
		c.translate(W / 2, H / 2);
		c.rotate(punch.rot);
		c.translate(-W / 2, -H / 2);
		if (bg !== false) drawBackground(c, cx, cy, z);
		drawForeground(c, s, cx, cy, z, bare);
		c.restore();
		// HUD timer, counting down like the real round (it makes way for the logo)
		if (bg !== false && t < T_SLOW) timer(c, Math.max(0, 152 - Math.floor(clipTime(t))), W / 2, 22);
		return { x: (punch.focusX - cx) * z, y: (punch.focusY - cy) * z };   // the catch, relative to screen centre
	}

	function drawBackground(c, cx, cy, z) {
		c.fillStyle = GREEN;
		c.fillRect(view.l, view.t, view.r - view.l, view.b - view.t);
		// the bubble layer: half parallax, half zoom, like the level's BG layer
		var bz = 1 + (z - 1) * 0.5;
		c.save();
		c.translate(W / 2, H / 2);
		c.scale(bz, bz);
		c.translate(-cx * 0.5, -cy * 0.5);
		var x0 = -64 + Math.floor((cx * 0.5 - (W / 2 - view.l) / bz + 64) / 1024) * 1024;
		var y0 = -64 + Math.floor((cy * 0.5 - (H / 2 - view.t) / bz + 64) / 1024) * 1024;
		for (var x = x0; x < cx * 0.5 + (view.r - W / 2) / bz; x += 1024)
			for (var y = y0; y < cy * 0.5 + (view.b - H / 2) / bz; y += 1024) c.drawImage(img.bg_bubbles, x, y);
		c.restore();
	}

	// bare: just platforms and players (for the impact frames' silhouettes)
	function drawForeground(c, s, cx, cy, z, bare) {
		c.save();
		c.translate(W / 2, H / 2);
		c.scale(z, z);
		c.translate(-cx, -cy);
		c.imageSmoothingEnabled = false;
		REPLAY.plats.forEach(function (p) {
			c.save();
			c.translate(p[1], p[2]);
			c.rotate(p[5]);
			c.fillStyle = platFill(c, p[0]);
			c.fillRect(0, 0, p[3], p[4]);
			c.restore();
		});
		if (!bare) dust.forEach(function (d) {
			c.globalAlpha = 1 - d.age / d.life;
			c.fillStyle = "#fff";
			c.beginPath(); c.arc(d.x, d.y, d.r, 0, 7); c.fill();
		});
		c.globalAlpha = 1;
		s.players.forEach(function (p) { sprite(c, p[6], p[7], p[1], p[2], p[3], p[4], p[5]); });
		if (!bare) {
			s.ind.forEach(function (i) { sprite(c, i[4], i[5], i[0], i[1], i[2], i[3], 0); });
			s.stars.forEach(function (st) { sprite(c, st[5], st[6], st[0], st[1], st[2], st[3], st[4]); });
		}
		c.restore();
	}

	// ---- the logo ----

	function drawLogo(c, t) {
		if (t < T_FLASH) return;
		var w = 470, h = 282;
		c.save();
		c.translate(W / 2, LOGO_Y + h / 2 + Math.sin(t * 2.2) * 5);
		c.rotate(Math.sin(t * 1.6) * 0.025);
		blit(c, LOGO, -w / 2, -h / 2, w, h);
		c.restore();
	}

	// ---- frame ----

	var view = { s: 1, x: 0, y: 0, l: 0, t: 0, r: W, b: H };
	function resize() {
		var dpr = window.devicePixelRatio || 1, cw = Math.round(innerWidth * dpr), ch = Math.round(innerHeight * dpr);
		if (canvas.width !== cw || canvas.height !== ch) { canvas.width = buf.width = cw; canvas.height = buf.height = ch; }
		view.s = Math.min(cw / W, ch / H);
		view.x = (cw - W * view.s) / 2;
		view.y = (ch - H * view.s) / 2;
		// the part of the game's space that's on screen, so the background reaches every edge
		view.l = -view.x / view.s - 30; view.t = -view.y / view.s - 30;
		view.r = (cw - view.x) / view.s + 30; view.b = (ch - view.y) / view.s + 30;
	}

	// The push-in: as the clip slows, the camera closes in on the two players and
	// tilts; it keeps creeping through the impact frames, then lets go under the white.
	function punchIn(t, s) {
		var k;
		if (t < T_SLOW - 0.3) k = 0;
		else if (t < T_IMPACT) { k = Math.min(1, (t - (T_SLOW - 0.3)) / (RAMP + 0.3)); k = k * k * (3 - 2 * k); }
		else if (t < T_FLASH) k = 1;
		else { k = Math.max(0, 1 - (t - T_FLASH) / (HOLD + 0.6)); k = k * k; }
		var a = s.players.filter(function (p) { return p[0] === TAGGER; })[0];
		var b = s.players.filter(function (p) { return p[0] === CAUGHT_SLOT; })[0];
		var fx = a && b ? (a[1] + b[1]) / 2 : s.cam[0], fy = a && b ? (a[2] + b[2]) / 2 - 20 : s.cam[1];
		return { z: 1 + 1.8 * k, k: Math.min(1, k) * 0.92, x: fx, y: fy, focusX: fx, focusY: fy, rot: 0.075 * Math.min(1, k) * (k > 1 ? 1.4 : 1), amount: k };
	}

	// Anime-style impact frames: the real frame crushed to stark black-and-white ink,
	// flipping to its negative, with rough speed streaks and cracks off the hit.
	function impactFrame(t, s, punch, sx, sy) {
		var n = Math.min(IMPACT.length - 1, Math.floor((t - T_IMPACT) / IMPACT_LEN)), kind = GENTLE ? "ink" : IMPACT[n];   // gentle: no flicker
		var kick = 1 + n * 0.04;   // each frame lurches a little closer

		raw.width = buf.width; raw.height = buf.height;
		var mx = buf.width / 2, my = buf.height / 2, ox = view.x + sx * view.s, oy = view.y + sy * view.s;
		rctx.fillStyle = GREEN;
		rctx.fillRect(0, 0, raw.width, raw.height);
		rctx.setTransform(view.s * kick, 0, 0, view.s * kick, mx + (ox - mx) * kick, my + (oy - my) * kick);
		// no star bursts or arrow here: they'd bury the two of them
		var focus = drawWorld(rctx, s, t, punch, true, true);
		rctx.setTransform(1, 0, 0, 1, 0, 0);

		bctx.setTransform(1, 0, 0, 1, 0, 0);
		bctx.clearRect(0, 0, buf.width, buf.height);
		var ink = "grayscale(1) contrast(9) brightness(1.08)";
		bctx.filter = kind === "negative" ? ink + " invert(1)" : ink;
		bctx.drawImage(raw, 0, 0);
		bctx.filter = "none";
		var dark = kind === "negative" ? "#fff" : "#000";

		// where the hit is on screen
		var px = mx + (ox + (W / 2 + focus.x) * view.s - mx) * kick, py = my + (oy + (H / 2 + focus.y) * view.s - my) * kick;
		var far = Math.hypot(buf.width, buf.height), u = view.s;
		bctx.fillStyle = dark;
		// thin, uneven speed streaks converging on the hit
		for (var i = 0; i < 140; i++) {
			var ang = Math.random() * Math.PI * 2, r0 = (150 + Math.random() * 260) * u, wdt = (0.4 + Math.pow(Math.random(), 3) * 5) * u;
			var ex = Math.cos(ang), ey = Math.sin(ang);
			bctx.beginPath();
			bctx.moveTo(px + ex * r0, py + ey * r0);
			bctx.lineTo(px + ex * far - ey * wdt, py + ey * far + ex * wdt);
			bctx.lineTo(px + ex * far + ey * wdt, py + ey * far - ex * wdt);
			bctx.fill();
		}
		// cracks: jagged ink strokes splitting out from the impact
		bctx.strokeStyle = dark;
		bctx.lineCap = "round";
		for (var c = 0; c < 9; c++) {
			var a = Math.random() * Math.PI * 2, len = (180 + Math.random() * 380) * u, x = px, y = py;
			bctx.lineWidth = (1.5 + Math.random() * 3.5) * u;
			bctx.beginPath();
			bctx.moveTo(x, y);
			for (var seg = 0, steps = 6 + Math.floor(Math.random() * 5); seg < steps; seg++) {
				a += (Math.random() - 0.5) * 0.9;
				x += Math.cos(a) * len / steps; y += Math.sin(a) * len / steps;
				bctx.lineTo(x, y);
			}
			bctx.stroke();
		}
	}

	// How much flashbang is left: pure white while held, then a slow ease out.
	function whiteness(t) {
		if (t < T_FLASH) return 0;
		if (t < T_FADE) return 1;
		var p = Math.min(1, (t - T_FADE) / FADE);
		return 1 - p * p * (3 - 2 * p);
	}

	var shake = 0;
	function render(t, dt) {
		resize();
		var ct = clipTime(t), s = sample(ct);
		makeDust(s.players, Math.max(0, ct - clipTime(t - dt)));
		if (t >= T_IMPACT && t - dt < T_IMPACT) shake = 26;
		shake *= Math.exp(-dt * (t < T_FLASH ? 3 : 7));
		if (!SHAKE) shake = 0;
		var sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
		var punch = punchIn(t, s);

		if (t >= T_IMPACT && t < T_FLASH) return impactFrame(t, s, punch, sx, sy);

		bctx.setTransform(1, 0, 0, 1, 0, 0);
		bctx.clearRect(0, 0, buf.width, buf.height);
		bctx.setTransform(view.s, 0, 0, view.s, view.x + sx * view.s, view.y + sy * view.s);
		drawWorld(bctx, s, t, punch);
		bctx.setTransform(1, 0, 0, 1, 0, 0);

		// the edges close in as it slows down
		var v = t < T_FLASH ? Math.min(1, punch.amount) : 0;
		if (v > 0) {
			var g = bctx.createRadialGradient(buf.width / 2, buf.height / 2, Math.min(buf.width, buf.height) * (0.55 - 0.25 * v),
				buf.width / 2, buf.height / 2, Math.hypot(buf.width, buf.height) / 2);
			g.addColorStop(0, "rgba(0,0,0,0)");
			g.addColorStop(1, "rgba(0,0,0," + 0.75 * v + ")");
			bctx.fillStyle = g;
			bctx.fillRect(0, 0, buf.width, buf.height);
		}

		bctx.setTransform(view.s, 0, 0, view.s, view.x + sx * view.s, view.y + sy * view.s);
		bctx.imageSmoothingEnabled = true;
		drawLogo(bctx, t);
		caption(bctx, t);
		bctx.setTransform(1, 0, 0, 1, 0, 0);

		var k = whiteness(t) * (GENTLE ? 0.6 : 1);
		if (k > 0) {
			bctx.globalAlpha = k;
			bctx.fillStyle = "#fff";
			bctx.fillRect(0, 0, buf.width, buf.height);
			bctx.globalAlpha = 1;
		}
	}

	// Waiting for a key so sound is allowed: the map with the bots standing ready.
	function drawPrompt(now) {
		resize();
		bctx.setTransform(1, 0, 0, 1, 0, 0);
		bctx.clearRect(0, 0, buf.width, buf.height);
		bctx.setTransform(view.s, 0, 0, view.s, view.x, view.y);
		drawWorld(bctx, sample(0), -1, { z: 1, k: 0, x: 0, y: 0, focusX: 0, focusY: 0, rot: 0 });
		bctx.imageSmoothingEnabled = false;
		if (Math.floor(now / 530) % 2 === 0) text(bctx, TOUCH_ONLY ? "TAP TO START" : "PRESS ANY KEY", W / 2, 300 + Math.sin(now / 300) * 4, 3);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(buf, 0, 0);
	}

	// ---- loop ----

	var start = 0, last = 0, exitAt = 0, waiting = false, skipped = false;

	function gameReady() {
		var r = window.cr_getC2Runtime && window.cr_getC2Runtime();
		return !!(r && r.running_layout);
	}

	function begin(now) {
		waiting = false;
		start = last = now;
		canvas.dataset.started = now;
		scheduleBang();
	}

	function frame(now) {
		if (!start) {
			// wait for the art, sound and font; if the art never comes there's nothing native to show
			if (failed || now > 5000 && loaded < FILES.length) return finish();
			var soundPending = audio && !sound, fontPending = !captionReady;
			if (loaded < FILES.length || (soundPending || fontPending) && now < 5000) return requestAnimationFrame(frame);
			if (audio && sound && audio.state !== "running") {
				waiting = true;
				drawPrompt(now);
				return requestAnimationFrame(frame);
			}
			begin(now);
		}
		var t = (now - start) / 1000, dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		/*TEST_HOOK*/
		render(t, dt);

		if (!exitAt && (t >= T_DONE || skipped) && gameReady()) exitAt = t;
		if (!exitAt && t > 30) exitAt = t;            // never block the game for long

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!exitAt) {
			ctx.drawImage(buf, 0, 0);
		} else {
			// checker wipe, diagonally, in the game's 64px checker size
			var p = (t - exitAt) / WIPE;
			if (p >= 1) return finish();
			canvas.style.background = "transparent";
			var cell = 64 * view.s, cols = Math.ceil(canvas.width / cell), rows = Math.ceil(canvas.height / cell);
			for (var i = 0; i < cols; i++) for (var j = 0; j < rows; j++) {
				var d = (i + j) / (cols + rows), q = Math.max(0, Math.min(1, (p * 1.5 - d * 0.5) * 1.6));
				var sz = cell * (1 - q * q);
				if (sz < 0.5) continue;
				var cx = i * cell + cell / 2, cy = j * cell + cell / 2;
				ctx.drawImage(buf, cx - sz / 2, cy - sz / 2, sz, sz, cx - sz / 2, cy - sz / 2, sz, sz);
			}
		}
		requestAnimationFrame(frame);
	}

	function skip(ev) {
		// keys pressed here shouldn't also join a player behind the splash
		ev.stopPropagation();
		if (ev.type === "keydown") ev.preventDefault();
		if (waiting) {
			// this press starts the show (and unlocks sound) rather than skipping it
			audio.resume().then(function () { if (waiting) begin(performance.now()); });
			return;
		}
		if (!skipped) fadeSound(0.6);
		skipped = true;
	}
	["keydown", "mousedown", "touchstart"].forEach(function (t) { window.addEventListener(t, skip, true); });

	function finish() {
		fadeSound(0.8);
		["keydown", "mousedown", "touchstart"].forEach(function (t) { window.removeEventListener(t, skip, true); });
		canvas.remove();
	}

	requestAnimationFrame(frame);
})();
