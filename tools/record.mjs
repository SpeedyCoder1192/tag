// Records bot-vs-bot gameplay straight from the game objects: node record.mjs MAP SECONDS LEVEL
import { open, sleep } from "./cdp.mjs";
import { writeFileSync } from "node:fs";
const [map = "C", secs = "100", level = "hard"] = process.argv.slice(2);
const p = await open("http://127.0.0.1:8765/tag.html", "R");
await sleep(1000);
// get the splash out of the way, then four bots and no humans
await p.ev(`(function(){var s=document.getElementById('splash');if(s)s.remove();return 1})()`);
await sleep(2500);
for (const sel of ['[data-k=limit] [data-v="4"]', '[data-k=count] [data-v="4"]', `[data-k=level] [data-v="${level}"]`])
	await p.ev(`document.querySelector('#botPanel ${sel}').click(); 1`);
await sleep(1500);
await p.ev(`c2_callFunction("Input",[1,"action"]); 1`); await sleep(500);
await p.ev(`cr_getC2Runtime().all_global_vars.find(v=>v.name==="mapName").data="${map}"; c2_callFunction("MenuItem_Action",[4,0]); 1`);
await sleep(1500);
console.log("layout", await p.ev(`cr_getC2Runtime().running_layout.name`), "players", await p.ev(`cr_getC2Runtime().types_by_index[18].instances.length`));
await p.ev(`(function(){
	var rt=cr_getC2Runtime(),T=rt.types_by_index,L=rt.running_layout,t0=performance.now(),n=0;
	var r1=v=>Math.round(v*10)/10, r3=v=>Math.round(v*1000)/1000;
	window.__rec={layout:[L.width,L.height],plats:[],frames:[]};
	[21,22,23,36].forEach(function(ti){T[ti].instances.forEach(function(i){window.__rec.plats.push([ti,r1(i.x),r1(i.y),r1(i.width),r1(i.height),r3(i.angle)])})});
	var draw=rt.drawGL;
	var g0=rt.kahanTime.sum;
	rt.drawGL=function(){draw.apply(this,arguments);try{
		// stamped with the game's own clock so headless hiccups don't change the speed
		window.__rec.frames.push({t:Math.round((rt.kahanTime.sum-g0)*1000),cam:[r1(L.scrollX),r1(L.scrollY),r3(L.getScale?L.getScale():L.scale)],
			tg:rt.all_global_vars.find(v=>v.name==="taggerID").data,
			p:T[16].instances.map(i=>[i.instance_vars[0],r1(i.x),r1(i.y),r1(i.width),r1(i.height),r3(i.angle),i.cur_animation.name,i.cur_frame,i.visible?1:0]),
			ind:T[25].instances.map(i=>[r1(i.x),r1(i.y),r1(i.width),r1(i.height),i.cur_animation.name,i.cur_frame,i.visible?1:0]),
			st:T[30].instances.map(i=>[r1(i.x),r1(i.y),r1(i.width),r1(i.height),r3(i.angle),i.cur_animation.name,i.cur_frame])});
	}catch(e){window.__recErr=String(e)}};
	return 1})()`);
await sleep(Number(secs) * 1000);
const rec = await p.ev(`JSON.stringify(window.__rec)`);
console.log("error:", await p.ev(`window.__recErr||"none"`));
writeFileSync(`rec/${map}-${level}.json`, rec);
const o = JSON.parse(rec);
console.log("frames", o.frames.length, "plats", o.plats.length, "size KB", Math.round(rec.length / 1024));
p.close(); process.exit(0);
