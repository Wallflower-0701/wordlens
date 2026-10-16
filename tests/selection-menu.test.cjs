const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../extension/core.js');
const { ID, createSelectionMenu } = require('../extension/selection-menu.js');
function harness() {
  let data = {}, opened = [], created = [], time = 10000, ids = 0;
  const api = {
    storage: { session: { async get(key) { return key ? { [key]: data[key] } : { ...data }; }, async set(value) { Object.assign(data, value); }, async remove(keys) { for (const key of [].concat(keys)) delete data[key]; } } },
    contextMenus: { async removeAll() { created = []; }, create(value) { created.push(value); } },
    runtime: { getURL: path => `chrome-extension://test/${path}` }, windows: { async create(value) { opened.push(value); } }
  };
  return { menu: createSelectionMenu(api, core, { now: () => time, uuid: () => `test-${++ids}` }), opened, get created() { return created; }, advance(ms) { time += ms; } };
}
test('Selection menu registers only selection context and transfers text once without putting it in the URL', async () => {
  const h = harness(); await h.menu.register(); assert.deepEqual(h.created[0].contexts, ['selection']);
  await h.menu.open({ menuItemId: ID, selectionText: 'a private sentence' });
  assert.equal(h.opened[0].url, 'chrome-extension://test/popup.html#lookup=test-1');
  assert.equal((await h.menu.consume('test-1')).text, 'a private sentence');
  assert.equal(await h.menu.consume('test-1'), null);
});
test('Pending queries expire and concurrent windows retain their own selection; oversized input is not silently truncated', async () => {
  const h = harness(); await h.menu.open({ menuItemId: ID, selectionText: 'Basic' });
  await h.menu.open({ menuItemId: ID, selectionText: 'Notions' });
  assert.equal((await h.menu.consume('test-1')).text, 'Basic');
  h.advance(120001); assert.equal(await h.menu.consume('test-2'), null);
  await h.menu.open({ menuItemId: ID, selectionText: 'a '.repeat(2000) }); assert.equal((await h.menu.consume('test-3')).text, '');
  assert.equal(await h.menu.consume('../bad'), null);
});
