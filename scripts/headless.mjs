#!/usr/bin/env node
/**
 * Tiny Chrome DevTools Protocol driver for visual checks without a browser UI.
 *
 * 1. Start Chrome:  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
 *      --remote-debugging-port=9333 --user-data-dir=<tmp>/chrome-profile --enable-unsafe-swiftshader about:blank
 * 2. Drive it:      node scripts/headless.mjs <command> [...args]
 *
 * Commands: nav <url> [waitMs] · shot <file> · clip <file> x y w h [scale] · eval <js> · logs ·
 *           click x y · move x y · drag x1 y1 x2 y2 · wheel x y dy · key <key> · wait <ms> ·
 *           window <w> <h> · setup (installs console capture for `logs`)
 * Each call is its own CDP session, so per-session emulation does not persist; use `window` to resize.
 * In dev builds the game exposes `window.valley` ({ game, renderer, audio }) for `eval`.
 */
import { writeFileSync } from 'node:fs';

const PORT = Number(process.env.CDP_PORT ?? 9333);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse', ...extra });
const [cmd, ...args] = process.argv.slice(2);
const num = args.map(Number);

switch (cmd) {
  case 'setup':
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__logs=[];for(const k of ['log','warn','error']){const o=console[k].bind(console);console[k]=(...a)=>{window.__logs.push(k+': '+a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch{return String(x)}}).join(' '));o(...a)}};addEventListener('error',e=>window.__logs.push('uncaught: '+e.message));addEventListener('unhandledrejection',e=>window.__logs.push('rejection: '+(e.reason&&e.reason.stack||e.reason)));`,
    });
    break;
  case 'window': {
    const { windowId } = await send('Browser.getWindowForTarget');
    await send('Browser.setWindowBounds', { windowId, bounds: { width: num[0], height: num[1] } });
    await sleep(500);
    break;
  }
  case 'nav':
    await send('Page.navigate', { url: args[0] });
    await sleep(Number(args[1] ?? 4000));
    break;
  case 'shot': {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(args[0], Buffer.from(r.data, 'base64'));
    console.log('saved', args[0]);
    break;
  }
  case 'clip': {
    const [, x, y, w, h, scale] = num;
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: scale || 2 } });
    writeFileSync(args[0], Buffer.from(r.data, 'base64'));
    console.log('saved', args[0]);
    break;
  }
  case 'eval': {
    const r = await send('Runtime.evaluate', { expression: args.join(' '), returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(r.result.value ?? r.result.description ?? null, null, 1));
    if (r.exceptionDetails) console.log('EXCEPTION', JSON.stringify(r.exceptionDetails).slice(0, 800));
    break;
  }
  case 'logs': {
    const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__logs||[])', returnByValue: true });
    console.log(JSON.parse(r.result.value).join('\n'));
    break;
  }
  case 'click':
    await mouse('mouseMoved', num[0], num[1], { button: 'none' });
    await sleep(60);
    await mouse('mousePressed', num[0], num[1]);
    await sleep(60);
    await mouse('mouseReleased', num[0], num[1]);
    await sleep(num[2] || 300);
    break;
  case 'move':
    await mouse('mouseMoved', num[0], num[1], { button: 'none' });
    await sleep(300);
    break;
  case 'drag': {
    const [x1, y1, x2, y2] = num;
    await mouse('mouseMoved', x1, y1, { button: 'none' });
    await mouse('mousePressed', x1, y1);
    for (let i = 1; i <= 12; i++) {
      await mouse('mouseMoved', x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12, { buttons: 1 });
      await sleep(25);
    }
    await mouse('mouseReleased', x2, y2);
    await sleep(500);
    break;
  }
  case 'wheel':
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: num[0], y: num[1], deltaX: 0, deltaY: num[2] });
    await sleep(700);
    break;
  case 'key':
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: args[0], code: args[1] ?? args[0] });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: args[0], code: args[1] ?? args[0] });
    await sleep(200);
    break;
  case 'wait':
    await sleep(num[0]);
    break;
  default:
    console.log('unknown command', cmd);
}
ws.close();
process.exit(0);
