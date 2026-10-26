'use strict';
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../extension');
const tick = () => new Promise(resolve => setImmediate(resolve));
function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, listeners, emit(...args) { return Promise.all(listeners.map(fn => fn(...args))); } }; }
async function background(settings = {}, backgroundSource) {
  const ports = [], windows = [], spoken = []; const local = { settings }; let now = Date.now();
  const chrome = { runtime: { id: 'test', getURL: file => 'chrome-extension://test/' + file,
    onMessage: event(), onConnect: event(), onStartup: event(), onInstalled: event(), connectNative() {
      const p = { onMessage: event(), onDisconnect: event(), sent: [], postMessage(m) { this.sent.push(m); }, disconnect() { this.onDisconnect.emit(); } }; ports.push(p); return p;
    } },
    storage: { local: { async get() { return local; }, async set(v) { Object.assign(local, v); } }, session: { async get() { return {}; }, async set() {}, async remove() {} }, onChanged: event() },
    tts: { getVoices(done) { done([{voiceName:'Test local',lang:'en-US',remote:false}]); },
      speak(text, options, done) { spoken.push(text); options.onEvent({type:'start'}); done(); } },
    contextMenus: { onClicked: event(), async removeAll() {}, create() {} }, commands: { onCommand: event() },
    tabs: { onActivated: event(), onUpdated: event(), onRemoved: event(), async query() { return [{ id: 7 }]; }, async sendMessage() { throw Error('Protected PDF has no content script'); }, async create() {} },
    windows: { onFocusChanged: event(), async create(value) { windows.push(value); } } };
  const context = vm.createContext({ chrome, TextEncoder, TextDecoder, Response, DecompressionStream, AbortController, setTimeout, clearTimeout, URL, Date: class extends Date { static now() { return now; } }, crypto: require('node:crypto').webcrypto,
    fetch: async url => new Response(fs.readFileSync(path.join(root, url.replace('chrome-extension://test/', '')))) });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  vm.runInContext(backgroundSource ?? fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  await tick();
  function dispatch(message, sender) { return new Promise(resolve => { const keep = chrome.runtime.onMessage.listeners[0](message, sender, resolve); if (!keep) resolve(undefined); }); }
  return { chrome, ports, windows, dispatch, spoken, advance(ms) { now += ms; } };
}
module.exports = { background, tick };
