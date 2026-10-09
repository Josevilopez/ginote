import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9223;

const proc = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  "--window-size=414,896",
  "about:blank",
], { stdio: "ignore" });

await wait(2500);

const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
const wsUrl = list[0].webSocketDebuggerUrl;

const sock = new WebSocket(wsUrl);
let id = 1;
const pending = new Map();
sock.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
function send(method, params) {
  return new Promise((resolve) => {
    const myId = id++;
    pending.set(myId, resolve);
    sock.send(JSON.stringify({ id: myId, method, params }));
  });
}
await new Promise((r) => sock.once("open", r));
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 414, height: 896, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: "http://localhost:5173/" });
await wait(4000);

let click = await send("Runtime.evaluate", {
  expression: `(function(){
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent && b.textContent.includes('Crear mesa'));
    if (btn) { btn.click(); return 'clicked'; }
    return 'not found';
  })();`,
});
console.log("click:", click.result?.result?.value);

await wait(8000);

const screen = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("C:\\Users\\josev\\AppData\\Local\\Temp\\guinote-game.png", Buffer.from(screen.result.data, "base64"));
console.log("screenshot saved");

// Inspect what's rendered
const inspect = await send("Runtime.evaluate", {
  expression: `JSON.stringify({
    rootHTML: document.querySelector('.app')?.outerHTML?.slice(0, 400),
    boardRect: document.querySelector('.board')?.getBoundingClientRect()?.toJSON?.() ?? (() => {const r=document.querySelector('.board')?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,w:r.width,h:r.height}:null;})(),
    seatsCount: document.querySelectorAll('.seat').length,
    handsCount: document.querySelectorAll('.hand .card-slot').length,
    handRect: (() => {const r=document.querySelector('.hand')?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,w:r.width,h:r.height}:null;})(),
    seatsAreaRect: (() => {const r=document.querySelector('.seats-area')?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,w:r.width,h:r.height}:null;})(),
  }, null, 2)`,
});
console.log("inspect:", inspect.result?.result?.value);

sock.close();
proc.kill();
process.exit(0);