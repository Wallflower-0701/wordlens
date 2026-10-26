'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../extension/core.js');
const { HOST, createBridge } = require('../extension/native-bridge.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const id = digit => digit.repeat(32);
function event() { const callbacks = []; return { addListener(fn) { callbacks.push(fn); }, emit(value) { callbacks.forEach(fn => fn(value)); } }; }
function harness(options = {}) {
  const ports = [], queries = [], spoken = [];
  const api = { runtime: { connectNative(name) {
    assert.equal(name, HOST);
    const p = { onMessage: event(), onDisconnect: event(), sent: [], disconnected: false,
      postMessage(value) { if (this.disconnected) throw Error('closed'); this.sent.push(value); },
      disconnect() { this.disconnected = true; this.onDisconnect.emit(); } };
    ports.push(p); return p;
  } } };
  const bridge = createBridge({ api, core,
    lookup: async text => { queries.push(text); return options.lookup ? options.lookup(text) : { status: 'ok', word: text, phonetic: "'test", definitions: ['测试'], kind: 'word' }; },
    speak: async text => { spoken.push(text); return { status: 'ok' }; },
    recent: options.recent, timeout: options.timeout ?? 1000, retryDelay: options.retryDelay ?? 500 });
  return { bridge, api, ports, queries, spoken, connect() { bridge.configure({ nativeEnabled: true, lookupMode: 'auto' }); const p = ports.at(-1); p.onMessage.emit({ type: 'ready', version: '1.3.9', automatic: true }); return p; } };
}
test('Modes are sanitized, default to ordinary auto lookup and require opt-in for the native helper', () => {
  assert.equal(core.sanitizeSettings().lookupMode, 'auto'); assert.equal(core.sanitizeSettings().nativeEnabled, false);
  assert.equal(core.sanitizeSettings({ lookupMode: '<bad>', nativeEnabled: 1 }).lookupMode, 'auto');
  for (const mode of ['auto', 'shortcut', 'context', 'copy']) assert.equal(core.sanitizeSettings({ lookupMode: mode }).lookupMode, mode);
  const h = harness(); h.bridge.configure({}); assert.equal(h.ports.length, 0); assert.equal(h.bridge.capture(), false);
});
test('Native connection handshakes, carries configuration and returns phonetics and Chinese definitions', async t => {
  const h = harness(); t.after(() => h.bridge.stop()); const p = h.connect();
  assert.equal(h.bridge.status().status, 'ready'); assert.deepEqual(p.sent[0], { type: 'configure', mode: 'auto', trigger: 'selection' });
  p.onMessage.emit({ type: 'selection', requestId: id('a'), text: 'Basic' }); await tick();
  assert.deepEqual(h.queries, ['Basic']); const result = p.sent.at(-1); assert.equal(result.requestId, id('a'));
  assert.equal(result.result.displayPhonetic, '/ˈtest/'); assert.deepEqual(result.result.definitions, ['测试']);
  assert.equal(h.bridge.capture(), true); assert.deepEqual(p.sent.at(-1), { type: 'capture' });
});
test('Invalid or oversized selections never reach the lookup or translation service', async t => {
  const h = harness(); t.after(() => h.bridge.stop()); const p = h.connect();
  for (const text of ['中文', '<script>', 'a '.repeat(2001)]) { p.onMessage.emit({ type: 'selection', requestId: id('b'), text }); await tick(); }
  p.onMessage.emit({ type: 'selection', requestId: '../bad', text: 'Basic' }); await tick();
  assert.equal(h.queries.length, 0); assert.equal(p.sent.filter(x => x.type === 'dismiss').length, 4);
});
test('A page that already displayed the same selection does not also show a native card', async t => {
  const h = harness({ recent: async () => true }); t.after(() => h.bridge.stop()); const p = h.connect();
  p.onMessage.emit({ type: 'selection', requestId: id('c'), text: 'Basic' }); await tick();
  assert.equal(h.queries.length, 0); assert.equal(p.sent.at(-1).type, 'dismiss');
});

test('A web card appearing during native lookup wins, and its dismissed native request cannot speak', async t => {
  let visible=false, release;
  const h=harness({recent:async()=>visible,lookup:()=>new Promise(resolve=>{release=resolve;})});
  t.after(()=>h.bridge.stop());const p=h.connect();
  p.onMessage.emit({type:'selection',requestId:id('b'),text:'Basic'});await tick();
  assert.equal(h.queries.length,1);visible=true;
  release({status:'ok',word:'Basic',definitions:['基本']});await tick();
  assert.equal(p.sent.at(-1).type,'dismiss');assert.equal(p.sent.filter(x=>x.type==='result').length,0);
  p.onMessage.emit({type:'speak',requestId:id('b')});await tick();assert.equal(h.spoken.length,0);
});

test('A web card claim cancels native lookup even if its pending owner check reports an old state', async t => {
  let release;
  const h = harness({ recent: () => new Promise(resolve => { release = resolve; }) });
  t.after(() => h.bridge.stop()); const p = h.connect();
  p.onMessage.emit({ type: 'selection', requestId: id('a'), text: 'Basic' }); await tick();
  h.bridge.dismiss(); release(false); await tick();
  assert.equal(p.sent.at(-1).type, 'dismiss'); assert.equal(h.queries.length, 0);
});

test('An empty-capture owner check cannot overwrite a newer native selection', async t => {
  let release;
  const h = harness({ recent: text => text ? Promise.resolve(false) : new Promise(resolve => { release = resolve; }) });
  t.after(() => h.bridge.stop()); const p = h.connect();
  p.onMessage.emit({ type: 'capture-empty', requestId: id('a') }); await tick();
  p.onMessage.emit({ type: 'selection', requestId: id('b'), text: 'Basic' }); await tick();
  release(true); await tick();
  assert.equal(p.sent.at(-1).type, 'result'); assert.equal(p.sent.at(-1).requestId, id('b'));
});

test('Disabling native lookup during its final web-card check discards the pending result', async t => {
  let calls=0, release;
  const h=harness({recent:()=>++calls===1?Promise.resolve(false):new Promise(resolve=>{release=resolve;})});
  t.after(()=>h.bridge.stop());const p=h.connect();
  p.onMessage.emit({type:'selection',requestId:id('b'),text:'Basic'});await tick();
  h.bridge.configure({nativeEnabled:false});release(false);await tick();
  assert.equal(p.sent.filter(x=>x.type==='result').length,0);
});
test('Rapid reselection and disabling the helper discard stale lookup results', async t => {
  let release;
  const h = harness({ lookup: text => text === 'first' ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ status: 'ok', word: text, definitions: ['第二条'] }) });
  t.after(() => h.bridge.stop()); const p = h.connect();
  p.onMessage.emit({ type: 'selection', requestId: id('d'), text: 'first' }); await tick();
  p.onMessage.emit({ type: 'selection', requestId: id('e'), text: 'second' }); await tick();
  release({ status: 'ok', word: 'first', definitions: ['旧结果'] }); await tick();
  assert.deepEqual(p.sent.filter(x => x.type === 'result').map(x => x.requestId), [id('e')]);
  h.bridge.configure({ nativeEnabled: false }); assert.equal(p.disconnected, true); assert.equal(h.bridge.status().status, 'disabled');
  p.onMessage.emit({ type: 'selection', requestId: id('f'), text: 'ignored' }); await tick(); assert.equal(h.queries.length, 2);
});
test('Context mode disconnects native monitoring; reconnect does not revive an old port', async t => {
  const h = harness(); t.after(() => h.bridge.stop()); const old = h.connect();
  h.bridge.configure({ nativeEnabled: true, lookupMode: 'context' }); assert.equal(old.disconnected, true);
  assert.equal(h.bridge.status().status, 'disabled'); assert.equal(h.bridge.capture(), false);
  const next = h.connect(); old.onMessage.emit({ type: 'ready', version: '1.3.9' });
  next.onMessage.emit({ type: 'selection', requestId: id('1'), text: 'Basic' }); await tick();
  assert.equal(old.sent.filter(x => x.type === 'result').length, 0); assert.equal(next.sent.at(-1).type, 'result');
});
test('Closing a native card cancels an outstanding result and disables its speech request', async t => {
  let release; const h = harness({ lookup: () => new Promise(resolve => { release = resolve; }) });
  t.after(() => h.bridge.stop()); const p = h.connect();
  p.onMessage.emit({ type: 'selection', requestId: id('5'), text: 'Basic' }); await tick();
  p.onMessage.emit({ type: 'dismissed' });
  release({ status: 'ok', word: 'Basic', definitions: ['不应显示'] }); await tick();
  p.onMessage.emit({ type: 'speak', requestId: id('5') }); await tick();
  assert.equal(p.sent.filter(x => x.type === 'result').length, 0); assert.equal(h.spoken.length, 0);
});
test('Speech is tied to the displayed selection; an unreadable selection shows a useful error without lookup', async t => {
  const h = harness(); t.after(() => h.bridge.stop()); const p = h.connect();
  p.onMessage.emit({ type: 'selection', requestId: id('2'), text: 'Basic' }); await tick();
  p.onMessage.emit({ type: 'speak', requestId: id('3') }); await tick(); assert.equal(h.spoken.length, 0);
  p.onMessage.emit({ type: 'speak', requestId: id('2') }); await tick(); assert.deepEqual(h.spoken, ['Basic']);
  p.onMessage.emit({ type: 'capture-empty', requestId: id('4') }); await tick(); assert.match(p.sent.at(-1).result.message, /没有读到/); assert.equal(h.queries.length, 1);
});

test('Native automatic speech reads the selected word once, while phrases and failed lookups stay silent', async t => {
  const h=harness({lookup:async text=>text==='missing'?{status:'not-found'}:text==='failed'?{status:'error',message:'failed'}:{status:'ok',word:'study',query:text,definitions:['释义'],kind:core.normalizeText(text).kind}});
  t.after(()=>h.bridge.stop());const p=h.connect();
  h.bridge.configure({nativeEnabled:true,autoSpeak:true});
  p.onMessage.emit({type:'selection',requestId:id('a'),text:'studies'});await tick();
  assert.deepEqual(h.spoken,['studies']);assert.equal(p.sent.filter(x=>x.type==='speech-status').length,1);
  for(const [digit,text] of [['b','take care of'],['c','This is a sentence.'],['d','missing'],['e','failed']]) {
    p.onMessage.emit({type:'selection',requestId:id(digit),text});await tick();
  }
  assert.deepEqual(h.spoken,['studies']);
});

test('Turning off automatic speech cancels pending automatic lookup speech and leaves manual speech available', async t => {
  let release;
  const h=harness({lookup:()=>new Promise(resolve=>{release=resolve;})});
  t.after(()=>h.bridge.stop());const p=h.connect();
  h.bridge.configure({nativeEnabled:true,autoSpeak:true});
  p.onMessage.emit({type:'selection',requestId:id('a'),text:'Basic'});await tick();
  h.bridge.configure({nativeEnabled:true,autoSpeak:false});
  release({status:'ok',word:'Basic',definitions:['基本']});await tick();assert.equal(h.spoken.length,0);
  p.onMessage.emit({type:'selection',requestId:id('b'),text:'Basic'});await tick();
  release({status:'ok',word:'Basic',definitions:['基本']});await tick();assert.equal(h.spoken.length,0);
  p.onMessage.emit({type:'speak',requestId:id('b')});await tick();assert.deepEqual(h.spoken,['Basic']);
});

test('Native automatic speech does not duplicate the web card owner', async t => {
  const h=harness({recent:async()=>true});t.after(()=>h.bridge.stop());const p=h.connect();
  h.bridge.configure({nativeEnabled:true,autoSpeak:true});
  p.onMessage.emit({type:'selection',requestId:id('a'),text:'Basic'});await tick();
  assert.equal(h.queries.length,0);assert.equal(h.spoken.length,0);assert.equal(p.sent.at(-1).type,'dismiss');
});
test('A missing, incompatible or unresponsive host is not reported connected', async t => {
  const h = harness({ timeout: 15 }); t.after(() => h.bridge.stop());
  h.bridge.configure({ nativeEnabled: true }); h.api.runtime.lastError = { message: 'host not found' }; h.ports[0].onDisconnect.emit();
  assert.equal(h.bridge.status().status, 'missing'); delete h.api.runtime.lastError;
  h.bridge.configure({ nativeEnabled: true }, true); h.ports[1].onMessage.emit({ type: 'ready', version: '1.2.0' }); assert.equal(h.bridge.status().status, 'missing');
  h.bridge.configure({ nativeEnabled: true }, true); await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(h.bridge.status().status, 'missing'); assert.equal(h.ports[2].disconnected, true);
});

test('The old mouse-hook helper is rejected so the new click gate cannot silently remain inactive', t => {
  const h = harness(); t.after(() => h.bridge.stop());
  h.bridge.configure({ nativeEnabled: true }); const p = h.ports[0];
  p.onMessage.emit({ type: 'ready', version: '1.3.4' });
  assert.equal(h.bridge.status().status, 'missing'); assert.equal(p.disconnected, true);
  assert.match(h.bridge.status().message, /1\.3\.9/);
});

test('Web ownership disables native capture at the host and rejects all late selection paths until released', async t => {
  const h=harness(); t.after(()=>h.bridge.stop()); const p=h.connect();
  h.bridge.setWebOwned(true);
  assert.deepEqual(p.sent.at(-1),{type:'configure',mode:'context',trigger:'selection'});
  for(const message of [{type:'selection',requestId:id('a'),text:'Basic'},
    {type:'capture-empty',requestId:id('b')},{type:'speak',requestId:id('a')}])p.onMessage.emit(message);
  await tick();assert.equal(h.queries.length,0);assert.equal(h.spoken.length,0);assert.equal(h.bridge.capture(),false);
  h.bridge.configure({nativeEnabled:true,lookupMode:'copy'});
  assert.equal(p.sent.at(-1).mode,'context');
  h.bridge.setWebOwned(false);assert.equal(p.sent.at(-1).mode,'copy');
  p.onMessage.emit({type:'selection',requestId:id('c'),text:'Basic'});await tick();
  assert.deepEqual(h.queries,['Basic']);assert.equal(p.sent.at(-1).type,'result');
});

test('Native reconnect keeps an active web selection suppressed from the first configuration', t => {
  const h=harness();t.after(()=>h.bridge.stop());h.bridge.setWebOwned(true);const p=h.connect();
  assert.equal(p.sent[0].mode,'context');assert.equal(h.bridge.status().status,'ready');
  h.bridge.setWebOwned(false);assert.equal(p.sent.at(-1).mode,'auto');
});
test('A broken native port stops reporting connected even before its disconnect callback arrives', t => {
  const h = harness(); t.after(() => h.bridge.stop()); const p = h.connect();
  p.disconnected = true;
  assert.equal(h.bridge.capture(), false);
  assert.equal(h.bridge.status().status, 'missing');
});

test('Native launch, registration, access and protocol errors retain the browser reason for diagnosis', t => {
  const h = harness(); t.after(() => h.bridge.stop());
  for (const [reason, expected] of [
    ['Specified native messaging host not found.', /未找到.*登记/],
    ['Access to the specified native messaging host is forbidden.', /拒绝访问/],
    ['Failed to start native messaging host.', /无法启动/],
    ['Native host has exited.', /启动后退出/],
    ['Error when communicating with the native messaging host.', /通信格式异常/]
  ]) {
    h.bridge.configure({ nativeEnabled: true }, true);
    h.api.runtime.lastError = { message: reason }; h.ports.at(-1).onDisconnect.emit();
    assert.equal(h.bridge.status().status, 'missing'); assert.match(h.bridge.status().message, expected);
    assert.ok(h.bridge.status().message.includes(reason));
  }
});

test('Native capture failures are distinguishable from connection failures without exposing document content', t => {
  const h = harness(); t.after(() => h.bridge.stop()); const p = h.connect();
  p.onMessage.emit({ type: 'capture-status', state: 'no-selection', reason: 'no-provider', text: 'private text' });
  assert.equal(h.bridge.status().status, 'ready'); assert.match(h.bridge.status().message, /文字层/);
  assert.doesNotMatch(JSON.stringify(h.bridge.status()), /private text/);
  p.onMessage.emit({ type: 'capture-status', state: 'no-selection', reason: '<script>private</script>' });
  assert.doesNotMatch(JSON.stringify(h.bridge.status()), /private/);
  p.onMessage.emit({ type: 'capture-status', state: 'shown' }); assert.match(h.bridge.status().message, /已显示/);
});

test('A mismatched dictionary response is rejected while an inflected query can use its base form', async t => {
  const h = harness({ lookup: async text => ({status:'ok', query:text === 'studies' ? 'studies' : text === '“Basic,”' ? 'basic' : 'unrelated', word:'study', isBaseForm:true, definitions:['学习']}) });
  t.after(() => h.bridge.stop()); const p = h.connect();
  p.onMessage.emit({type:'selection',requestId:id('a'),text:'studies'}); await tick();
  assert.equal(p.sent.at(-1).result.status,'ok');
  p.onMessage.emit({type:'selection',requestId:id('c'),text:'“Basic,”'}); await tick();
  assert.equal(p.sent.at(-1).result.status,'ok');
  p.onMessage.emit({type:'selection',requestId:id('b'),text:'Basic'}); await tick();
  assert.equal(p.sent.at(-1).result.status,'error'); assert.match(p.sent.at(-1).result.message,/不一致/);
});

test('A stuck provider restarts with a new port and discards the previous lookup', async t => {
  let release;
  const h = harness({retryDelay:0, lookup:() => new Promise(resolve => {release=resolve;})});
  t.after(() => h.bridge.stop()); const old = h.connect();
  old.onMessage.emit({type:'selection',requestId:id('a'),text:'Basic'}); await tick();
  old.onMessage.emit({type:'capture-status',state:'no-selection',reason:'provider-timeout'});
  assert.equal(old.disconnected,true); assert.equal(h.bridge.status().status,'connecting');
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(h.ports.length,2); const next=h.ports[1];
  next.onMessage.emit({type:'ready',version:'1.3.9'});
  release({status:'ok',word:'Basic',definitions:['旧结果']}); await tick();
  assert.equal(h.bridge.status().status,'ready'); assert.equal(old.sent.filter(x=>x.type==='result').length,0);
  assert.equal(next.sent.filter(x=>x.type==='result').length,0);
});

test('Provider restart is bounded and switching off cancels a scheduled restart', async t => {
  const h=harness({retryDelay:0}); t.after(()=>h.bridge.stop()); h.connect();
  for (let i=0;i<3;i++) {
    h.ports.at(-1).onMessage.emit({type:'capture-status',state:'no-selection',reason:'provider-timeout'});
    await new Promise(resolve=>setTimeout(resolve,10));
    if (i<2) h.ports.at(-1).onMessage.emit({type:'ready',version:'1.3.9'});
  }
  assert.equal(h.ports.length,3); assert.equal(h.bridge.status().status,'missing');
  h.bridge.configure({nativeEnabled:true},true); h.ports.at(-1).onMessage.emit({type:'ready',version:'1.3.9'});
  h.ports.at(-1).onMessage.emit({type:'capture-status',state:'no-selection',reason:'provider-timeout'});
  h.bridge.configure({nativeEnabled:false}); await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(h.ports.length,4); assert.equal(h.bridge.status().status,'disabled');
});

test('A selection mismatch has a specific message and never performs a lookup', t => {
  const h=harness(); t.after(()=>h.bridge.stop()); const p=h.connect();
  p.onMessage.emit({type:'capture-status',state:'no-selection',reason:'selection-mismatch'});
  assert.match(h.bridge.status().message,/当前位置不符/); assert.equal(h.queries.length,0);
});

test('Copy mode reports its trigger and refuses to claim ready when the copy listener failed', t => {
  const h=harness(); t.after(()=>h.bridge.stop());
  h.bridge.configure({nativeEnabled:true,lookupMode:'copy'}); const p=h.ports[0];
  p.onMessage.emit({type:'ready',version:'1.3.9'});
  assert.match(h.bridge.status().message,/Ctrl\+C/); assert.equal(p.sent[0].mode,'copy');
  p.onMessage.emit({type:'configured',copyAvailable:false});
  assert.equal(h.bridge.status().status,'missing'); assert.equal(p.disconnected,true);
  assert.match(h.bridge.status().message,/监听未能启动/);
});

test('Packaged Windows helper passes its framing, origin, selected-range search and privacy self-tests', { skip: process.platform !== 'win32' }, () => {
  const exe = require('node:path').resolve(__dirname, '../extension/native/WordLens.Native.exe');
  const result = require('node:child_process').spawnSync(exe, ['--self-test'], { windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr?.toString()); const length = result.stdout.readUInt32LE();
  assert.equal(length, result.stdout.length - 4); const message = JSON.parse(result.stdout.subarray(4).toString());
  assert.equal(message.type, 'self-test'); assert.ok(message.passed >= 29); assert.equal(message.error, undefined);
  assert.ok(message.selectionChecks.includes('nested-pdf-text-provider'));
  assert.ok(message.selectionChecks.includes('editable-ancestor-never-read'));
  assert.ok(message.selectionChecks.includes('content-free-health-snapshot'));
  assert.ok(message.popupChecks.includes('close-keeps-popup-reusable'));
  assert.ok(message.popupChecks.includes('lookup-reopens-after-close'));
  assert.ok(message.popupChecks.includes('selected-heading-preserved-for-base-form'));
  assert.ok(message.selectionChecks.includes('stale-ancestor-selection-rejected'));
  assert.ok(message.selectionChecks.includes('point-range-must-match-selection'));
  assert.ok(message.copyChecks.includes('copy-requires-user-gesture-and-new-sequence'));
  assert.ok(message.copyChecks.includes('copy-requires-same-foreground-process'));
  assert.ok(message.copyChecks.includes('copy-is-once-bounded-and-cancellable'));
  assert.ok(message.selectionChecks.includes('wordlens-card-never-falls-back-to-document'));
  assert.ok(message.gestureChecks.includes('single-speech-and-close-clicks-never-capture'));
  assert.ok(message.gestureChecks.includes('drag-and-fresh-double-click-remain-available'));
  assert.ok(message.gestureChecks.includes('card-window-switch-and-scroll-cancel-gestures'));
  assert.ok(message.gestureChecks.includes('double-click-timestamp-rollover'));
});
