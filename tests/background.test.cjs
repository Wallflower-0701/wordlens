'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { background, tick } = require('./background-harness.cjs');
function cardOwner(h, tabId = 7, frameId = 0, senderId = 'test') {
  const listeners = [];
  const port = { name: 'wordlens-page-card', sender: { id: senderId, tab: { id: tabId }, frameId },
    onDisconnect: { addListener(fn) { listeners.push(fn); } },
    disconnect() { listeners.forEach(fn => fn()); } };
  h.chrome.runtime.onConnect.emit(port);
  return port;
}

test('A live HTML card owns lookup across missing broadcast replies, focus changes and delayed speech clicks', async t => {
  for (const reply of [async () => undefined, async () => { throw Error('No response'); }]) {
    const h = await background({ nativeEnabled: true });
    t.after(() => h.chrome.storage.onChanged.emit({ settings: { newValue: {} } }, 'local'));
    h.chrome.tabs.sendMessage = reply;
    const p = h.ports[0]; await p.onMessage.emit({ type: 'ready', version: '1.3.9' });
    const owner = cardOwner(h, 7, 12); await tick();
    h.advance(60000);
    await h.dispatch({ type: 'speak', word: 'Basic' }, { id: 'test', tab: { id: 7 } });
    for (const message of [
      { type: 'selection', requestId: 'a'.repeat(32), text: 'unrelated' },
      { type: 'capture-empty', requestId: 'b'.repeat(32) }
    ]) { await p.onMessage.emit(message); await tick(); assert.equal(p.sent.at(-1).type, 'dismiss'); }
    assert.deepEqual(h.spoken, ['Basic']); assert.equal(p.sent.filter(x => x.type === 'result').length, 0);
    owner.disconnect();
    await p.onMessage.emit({ type: 'selection', requestId: 'c'.repeat(32), text: 'Basic' });
    for (let i = 0; i < 30 && !p.sent.some(x => x.type === 'result'); i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(p.sent.at(-1).result.query, 'basic');
  }
});

test('Opening a web card dismisses an already rendered native card and blocks its speech button', async t => {
  const h = await background({ nativeEnabled: true });
  t.after(() => h.chrome.storage.onChanged.emit({ settings: { newValue: {} } }, 'local'));
  const p = h.ports[0]; await p.onMessage.emit({ type: 'ready', version: '1.3.9' });
  await p.onMessage.emit({ type: 'selection', requestId: 'a'.repeat(32), text: 'Basic' });
  for (let i = 0; i < 30 && !p.sent.some(x => x.type === 'result'); i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(p.sent.at(-1).type, 'result');
  cardOwner(h); await tick(); assert.equal(p.sent.at(-1).type, 'dismiss');
  await p.onMessage.emit({ type: 'speak', requestId: 'a'.repeat(32) }); await tick();
  assert.deepEqual(h.spoken, []);
});

test('Only trusted active-tab card ports suppress native lookup; closing one frame preserves other owners', async t => {
  const h = await background({ nativeEnabled: true });
  t.after(() => h.chrome.storage.onChanged.emit({ settings: { newValue: {} } }, 'local'));
  const p = h.ports[0]; await p.onMessage.emit({ type: 'ready', version: '1.3.9' });
  cardOwner(h, 8); cardOwner(h, 7, 0, 'other-extension'); await tick();
  assert.equal(p.sent.filter(x => x.type === 'dismiss').length, 0);
  await p.onMessage.emit({ type: 'capture-empty', requestId: 'a'.repeat(32) }); await tick();
  assert.equal(p.sent.at(-1).type, 'result');
  const first = cardOwner(h, 7, 0), second = cardOwner(h, 7, 12); await tick();
  first.disconnect();
  await p.onMessage.emit({ type: 'capture-empty', requestId: 'b'.repeat(32) }); await tick();
  assert.equal(p.sent.at(-1).type, 'dismiss');
  second.disconnect();
  await p.onMessage.emit({ type: 'capture-empty', requestId: 'c'.repeat(32) }); await tick();
  assert.equal(p.sent.at(-1).type, 'result');
});

test('Closing a card before its active-tab check resolves cannot dismiss a later native card', async t => {
  const h = await background({ nativeEnabled: true });
  t.after(() => h.chrome.storage.onChanged.emit({ settings: { newValue: {} } }, 'local'));
  const p = h.ports[0]; await p.onMessage.emit({ type: 'ready', version: '1.3.9' });
  let release; h.chrome.tabs.query = () => new Promise(resolve => { release = resolve; });
  const owner = cardOwner(h); owner.disconnect(); release([{ id: 7 }]); await tick();
  assert.equal(p.sent.filter(x => x.type === 'dismiss').length, 0);
});
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
  await p.onMessage.emit({ type: 'ready', version: '1.3.9', automatic: true }); await tick();
  await h.chrome.commands.onCommand.emit('lookup-selection');
  assert.equal(p.sent.at(-1).type, 'capture'); assert.equal(h.windows.length, 0);
});
test('The actual service worker returns real packaged phonetics and meanings for the original-page query', async () => {
  const h = await background();
  const result = await h.dispatch({ type: 'lookup', word: 'Basic' }, { id: 'test', url: 'chrome-extension://test/popup.html' });
  assert.equal(result.status, 'ok'); assert.ok(result.phonetic); assert.match(result.definitions.join(' '), /基本/);
});

test('Copy mode configures the native helper and uses the exact copied word in the real dictionary', async t => {
  const h=await background({nativeEnabled:true,lookupMode:'copy'});
  t.after(()=>h.chrome.storage.onChanged.emit({settings:{newValue:{}}},'local'));
  const p=h.ports[0];
  await p.onMessage.emit({type:'ready',version:'1.3.9'}); await tick();
  assert.equal(p.sent[0].mode,'copy');
  await p.onMessage.emit({type:'selection',requestId:'a'.repeat(32),text:'Basic'});
  for (let i=0;i<20 && !p.sent.some(x=>x.type==='result');i++) await new Promise(resolve=>setTimeout(resolve,10));
  const result=p.sent.find(x=>x.type==='result');
  assert.equal(result.result.query,'basic'); assert.equal(result.result.word.toLowerCase(),'basic'); assert.match(result.result.definitions.join(' '),/基本/);
});

test('A native PDF selection containing a Unicode ligature reaches the real dictionary as the same word',async t=>{
  const h=await background({nativeEnabled:true,lookupMode:'auto'});
  t.after(()=>h.chrome.storage.onChanged.emit({settings:{newValue:{}}},'local'));
  const p=h.ports[0];await p.onMessage.emit({type:'ready',version:'1.3.9'});await tick();
  await p.onMessage.emit({type:'selection',requestId:'b'.repeat(32),text:'ﬁnd'});
  for(let i=0;i<20 && !p.sent.some(x=>x.type==='result');i++)await new Promise(resolve=>setTimeout(resolve,10));
  const result=p.sent.find(x=>x.type==='result');
  assert.equal(result.result.query,'find');assert.match(result.result.definitions.join(' '),/发现|找到/);assert.ok(result.result.phonetic);
});

test('The precise PDF reader suppresses unrelated native cards while it owns selection lookup',async t=>{
  const h=await background({nativeEnabled:true,lookupMode:'auto'});
  t.after(()=>h.chrome.storage.onChanged.emit({settings:{newValue:{}}},'local'));
  h.chrome.tabs.query=async()=>[{id:7,url:'chrome-extension://test/reader.html'}];
  const p=h.ports[0];await p.onMessage.emit({type:'ready',version:'1.3.9'});await tick();
  await p.onMessage.emit({type:'selection',requestId:'c'.repeat(32),text:'unrelated'});await tick();
  assert.equal(p.sent.at(-1).type,'dismiss');assert.equal(p.sent.filter(x=>x.type==='result').length,0);
});

test('Opt-in native word speech flows through the real dictionary and local voice API exactly once',async t=>{
  const h=await background({nativeEnabled:true,autoSpeak:true});
  t.after(()=>h.chrome.storage.onChanged.emit({settings:{newValue:{}}},'local'));
  const p=h.ports[0];await p.onMessage.emit({type:'ready',version:'1.3.9'});await tick();
  await p.onMessage.emit({type:'selection',requestId:'a'.repeat(32),text:'Basic'});
  for(let i=0;i<20 && !h.spoken.length;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(h.spoken,['Basic']);assert.equal(p.sent.filter(x=>x.type==='result').length,1);
  assert.equal(p.sent.filter(x=>x.type==='speech-status').length,1);
});

test('An HTML speaker click long after lookup keeps the web card and dismisses duplicate native capture',async t=>{
  for (const url of ['file:///C:/WordLens/example.html','https://example.com/lesson']) {
    const h=await background({nativeEnabled:true,lookupMode:'auto'});
    t.after(()=>h.chrome.storage.onChanged.emit({settings:{newValue:{}}},'local'));
    const sender={id:'test',url,tab:{id:7}};
    h.chrome.tabs.query=async()=>[{id:7,url}];
    let visible=true;
    h.chrome.tabs.sendMessage=async(tab,message)=>{
      assert.equal(tab,7);assert.equal(message.type,'page-card-state');
      return visible?{visible:true}:undefined;
    };
    const p=h.ports[0];await p.onMessage.emit({type:'ready',version:'1.3.9'});await tick();
    const entry=await h.dispatch({type:'lookup',word:'Basic'},sender);
    assert.equal(entry.status,'ok');h.advance(60000);
    const speech=await h.dispatch({type:'speak',word:'Basic'},sender);
    assert.equal(speech.status,'ok');assert.deepEqual(h.spoken,['Basic']);
    for (const [digit,text] of [['d','Basic'],['e','unrelated']]) {
      await p.onMessage.emit({type:'selection',requestId:digit.repeat(32),text});await tick();
      assert.equal(p.sent.at(-1).type,'dismiss');
    }
    assert.equal(p.sent.filter(x=>x.type==='result').length,0);
    // Closing the web card (or navigating to a protected viewer) restores native lookup.
    visible=false;
    await p.onMessage.emit({type:'selection',requestId:'f'.repeat(32),text:'Basic'});
    for(let i=0;i<20 && !p.sent.some(x=>x.type==='result');i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(p.sent.at(-1).type,'result');assert.equal(p.sent.at(-1).result.query,'basic');
  }
});
