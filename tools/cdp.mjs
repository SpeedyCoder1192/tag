import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function open(url, tag, opts = {}) {
	const port = 9300 + Math.floor(Math.random() * 600);
	const prof = mkdtempSync(tmpdir() + "/tagprof-");
	const args = [opts.oldHeadless ? "--headless=old" : "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "--window-size=1280,720", "--mute-audio", "about:blank"];
	if (!opts.blockAudio) args.push("--autoplay-policy=no-user-gesture-required");
	const chrome = spawn("chromium", args, { stdio: "ignore" });
	let tabs;
	for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
	const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener("open", r));
	let id = 0; const pending = new Map();
	ws.addEventListener("message", (m) => {
		const d = JSON.parse(m.data);
		if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
		if (d.method === "Runtime.exceptionThrown") console.log(tag, "EXC", JSON.stringify(d.params.exceptionDetails).slice(0, 300));
		if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
			const t = d.params.args.map((a) => a.value ?? a.description).join(" ");
			if (!t.includes("service worker")) console.log(tag, "CONSOLE", t.slice(0, 400));
		}
	});
	const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
	const ev = async (expr) => {
		const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
		if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
		return r.result.result.value;
	};
	await send("Runtime.enable"); await send("Page.enable");
	await send("Page.navigate", { url });
	if (!opts.noWait) for (let i = 0; i < 100; i++) {
		await sleep(300);
		try { if (await ev(`!!(window.cr_getC2Runtime && cr_getC2Runtime() && cr_getC2Runtime().running_layout && cr_getC2Runtime().all_global_vars.length)`)) break; } catch {}
	}
	return { ev, send, close: () => { ws.close(); chrome.kill(); } };
}
