'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const core = require('../extension/core.js');

function events() {
  const handlers = new Map();
  return { addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
    emit(type, event = {}) { return Promise.all((handlers.get(type) || []).map(fn => fn(event))); } };
}
function element() {
  const children = new Map();
  return { ...events(), nodeType: 1, hidden: false, isConnected: true,
    style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
    append() {}, replaceChildren() {}, setAttribute() {}, closest() { return null; }, contains() { return false; },
    getBoundingClientRect() { return { left: 20, top: 20, bottom: 40, right: 100, width: 80, height: 20 }; },
    matches() { return false; }, showPopover() {}, hidePopover() {},
    querySelector(selector) { if (!children.has(selector)) children.set(selector, element()); return children.get(selector); },
    attachShadow() { return this.shadowRoot = element(); }
  };
}
async function page() {
  const ports = [], requests = [], nodes = [];
  let runtimeListener, storageListener;
  const selection = { isCollapsed: false, rangeCount: 1, toString: () => 'Basic', getRangeAt: () => element() };
  const document = { ...events(), documentElement: element(), activeElement: element(), hasFocus: () => true,
    createElement() { const node = element(); nodes.push(node); return node; }, createTextNode(text) { return text; } };
  const window = { ...events(), getSelection: () => selection, innerWidth: 1200, innerHeight: 900 };
  const chrome = { runtime: { id: 'test', getURL: name => 'chrome-extension://test/' + name,
    onMessage: { addListener(fn) { runtimeListener = fn; } },
    connect({ name }) {
      let listener;
      const port = { name, disconnected: false, onDisconnect: { addListener(fn) { listener = fn; } },
        disconnect() { this.disconnected = true; listener?.(); } };
      ports.push(port); return port;
    },
    async sendMessage(message) {
      requests.push(message);
      return message.type === 'speak' ? { status: 'ok' } : { status: 'ok', kind: 'word', word: 'basic', definitions: ['基本'] };
    } }, storage: { local: { async get() { return { settings: {} }; } }, onChanged: { addListener(fn) { storageListener = fn; } } } };
  const context = vm.createContext({ document, window, chrome, WordLensCore: core, location: { href: 'file:///C:/lesson.html' }, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const lookup = () => new Promise(resolve => runtimeListener({ type: 'lookup-selection' }, { id: 'test' }, resolve));
  return { ports, requests, document, window, selection, lookup, settings: () => storageListener({ settings: { newValue: {} } }, 'local'),
    card: () => nodes.find(node => node.id === 'wordlens-card-host') };
}

test('The actual HTML card retains one ownership port through repeated speech clicks and releases it on close', async () => {
  const h = await page(); await h.lookup();
  assert.equal(h.ports.length, 1); assert.equal(h.ports[0].name, 'wordlens-page-card');
  const card = h.card();
  await card.shadowRoot.querySelector('.speak').emit('click');
  await card.shadowRoot.querySelector('.speak').emit('click');
  assert.equal(h.ports.length, 1); assert.equal(h.ports[0].disconnected, false);
  assert.equal(h.requests.filter(x => x.type === 'lookup').length, 1);
  assert.equal(h.requests.filter(x => x.type === 'speak').length, 2); assert.equal(card.hidden, false);
  await card.shadowRoot.querySelector('.close').emit('click');
  assert.equal(card.hidden, true); assert.equal(h.ports[0].disconnected, true);
  await h.lookup(); assert.equal(h.ports.length, 2); assert.equal(card.hidden, false);
});

test('HTML ownership ends when the document leaves, settings change or the underlying selection disappears', async () => {
  for (const close of [h => h.window.emit('pagehide'), h => h.settings(), h => { h.selection.isCollapsed = true; return h.document.emit('selectionchange'); }]) {
    const h = await page(); await h.lookup(); await close(h);
    assert.equal(h.ports[0].disconnected, true); assert.equal(h.card().hidden, true);
  }
});

test('An interrupted page ownership connection is renewed before the next speech request', async () => {
  const h = await page(); await h.lookup(); h.ports[0].disconnect();
  await h.card().shadowRoot.querySelector('.speak').emit('click');
  assert.equal(h.ports.length, 2); assert.equal(h.ports[1].disconnected, false);
  assert.equal(h.requests.filter(x => x.type === 'speak').length, 1);
});
