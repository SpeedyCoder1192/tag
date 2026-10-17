// Loads a build like a visitor would and checks the main pieces come up.
import { open, sleep } from "./cdp.mjs";
const url = process.argv[2] || "http://127.0.0.1:8770/index.html";
const p = await open(url, "SMOKE", { noWait: true });
for (let i = 0; i < 60; i++) { await sleep(300); if (await p.ev(`!!(window.cr_getC2Runtime&&cr_getC2Runtime()&&cr_getC2Runtime().running_layout)`).catch(() => false)) break; }
await sleep(2500);
const r = JSON.parse(await p.ev(`JSON.stringify({title:document.title, layout:cr_getC2Runtime().running_layout.name, splash:!!document.getElementById('splash'),
	panel:!!document.getElementById('botPanel'), media:Object.keys(window.TAG_MEDIA||{}), referrerSpoofed: document.referrer==="https://sites.google.com"})`));
console.log(JSON.stringify(r));
await p.send("Input.dispatchKeyEvent", { type: "keyDown", code: "Space", windowsVirtualKeyCode: 32 });
await p.send("Input.dispatchKeyEvent", { type: "keyUp", code: "Space", windowsVirtualKeyCode: 32 });
for (let i = 0; i < 60; i++) { await sleep(250); if (!(await p.ev(`!!document.getElementById('splash')`))) break; }
await p.ev(`c2_callFunction("Input",[1,"join"]); c2_callFunction("Input",[1,"action"]); 1`); await sleep(400);
await p.ev(`c2_callFunction("MenuItem_Action",[4,0]); 1`); await sleep(3000);
console.log("in game:", await p.ev(`cr_getC2Runtime().running_layout.name`), "players", await p.ev(`cr_getC2Runtime().types_by_index[18].instances.length`));
p.close(); process.exit(0);
