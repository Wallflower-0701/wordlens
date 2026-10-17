'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../extension');
const tick = () => new Promise(resolve => setImmediate(resolve));
function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, listeners, emit(...args) { return Promise.all(listeners.map(fn => fn(...args))); } }; }
async function background(settings = {}) {
  const ports = [], windows = []; const local = { settings };
  const chrome = { runtime: { id: 'test', getURL: file => 'chrome-extension://test/' + file,
    onMessage: event(), onStartup: event(), onInstalled: event(), connectNative() {
      const p = { onMessage: event(), onDisconnect: event(), sent: [], postMessage(m) { this.sent.push(m); }, disconnect() { this.onDisconnect.emit(); } }; ports.push(p); return p;
    } },
    storage: { local: { async get() { return local; }, async set(v) { Object.assign(local, v); } }, session: { async get() { return {}; }, async set() {}, async remove() {} }, onChanged: event() },
    tts: {}, contextMenus: { onClicked: event(), async removeAll() {}, create() {} }, commands: { onCommand: event() },
    tabs: { async query() { return [{ id: 7 }]; }, async sendMessage() { throw Error('Protected PDF has no content script'); }, async create() {} },
    windows: { async create(value) { windows.push(value); } } };
  const context = vm.createContext({ chrome, TextEncoder, TextDecoder, Response, DecompressionStream, AbortController, setTimeout, clearTimeout, URL, crypto: require('node:crypto').webcrypto,
    fetch: async url => new Response(fs.readFileSync(path.join(root, url.replace('chrome-extension://test/', '')))) });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  await tick();
  function dispatch(message, sender) { return new Promise(resolve => { const keep = chrome.runtime.onMessage.listeners[0](message, sender, resolve); if (!keep) resolve(undefined); }); }
  return { chrome, ports, windows, dispatch };
}
test('The actual service worker does not permit a page content script to connect or inspect the native host', async () => {
  const h = await background();
  const result = await h.dispatch({ type: 'native-reconnect' }, { id: 'test', url: 'https://example.com/', tab: { id: 7 } });
  assert.equal(result, undefined); assert.equal(h.ports.length, 0);
  const status = await h.dispatch({ type: 'native-status' }, { id: 'test', url: 'chrome-extension://test/popup.html' });
  assert.equal(status.status, 'disabled'); assert.equal(h.ports.length, 0);
});
test('Alt+W on a protected original page requests native selection and never opens the text reader', async t => {
  const h = await background({ nativeEnabled: true, lookupMode: 'shortcut' });
  t.after(() => h.chrome.storage.onChanged.emit({ settings: { newValue: {} } }, 'local'));
  assert.equal(h.ports.length, 1); const p = h.ports[0];
  await p.onMessage.emit({ type: 'ready', version: '1.3.2', automatic: true }); await tick();
  await h.chrome.commands.onCommand.emit('lookup-selection');
  assert.equal(p.sent.at(-1).type, 'capture'); assert.equal(h.windows.length, 0);
});
test('The actual service worker returns real packaged phonetics and meanings for the original-page query', async () => {
  const h = await background();
  const result = await h.dispatch({ type: 'lookup', word: 'Basic' }, { id: 'test', url: 'chrome-extension://test/popup.html' });
  assert.equal(result.status, 'ok'); assert.ok(result.phonetic); assert.match(result.definitions.join(' '), /基本/);
});
