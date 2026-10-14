const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const core = require('../extension/core.js');
const root = path.resolve(__dirname, '../extension');
const dictionary = core.createDictionary(async prefix => JSON.parse(gunzipSync(await fs.readFile(path.join(root, 'data', prefix + '.json.gz')))));

test('accepts words and typographic punctuation, rejects sentences and unsafe input', () => {
  assert.equal(core.normalizeWord(' “Beautiful!” '), 'beautiful');
  assert.equal(core.normalizeWord('don’t'), "don't");
  assert.equal(core.normalizeWord('state‑of‑the‑art'), 'state-of-the-art');
  for (const input of ['', 'two words', '中文', '<script>alert(1)</script>', '__proto__', '123', 'a'.repeat(65), null, {}]) assert.equal(core.normalizeWord(input), null);
});

test('real packaged data contains phonetics and Chinese meanings', async () => {
  for (const word of ['hello', 'curiosity', 'beautiful', 'adventure', 'dictionary', 'apple', 'running', 'went', 'children', "don't", 'serendipity']) {
    const result = await dictionary.lookup(word);
    assert.equal(result.status, 'ok', word);
    assert.ok(result.definitions.some(line => /[\u3400-\u9fff]/.test(line)), word);
    if (['hello', 'beautiful', 'dictionary', 'apple'].includes(word)) assert.ok(result.phonetic, word);
  }
  assert.equal((await dictionary.lookup('zzzzunrecordedword')).status, 'not-found');
  assert.equal((await dictionary.lookup('two words')).status, 'not-found');
});

test('aliases resolve across shards and concurrent lookups share reads', async () => {
  let reads = 0;
  const instance = core.createDictionary(async prefix => {
    reads++;
    return prefix === 'wa' ? { walked: 'walk' } : { walk: ['walk', 'wɔːk', 'v. 行走'] };
  });
  // Both an alias and its target can share a prefix.
  const aliased = core.createDictionary(async () => ({ walked: 'walk', walk: ['walk', 'wɔːk', 'v. 行走'] }));
  assert.equal((await aliased.lookup('walked')).isBaseForm, true);
  const cross = core.createDictionary(async prefix => prefix === 'we' ? { went: 'go' } : { go: ['go', 'ɡəʊ', 'v. 去'] });
  assert.equal((await cross.lookup('went')).word, 'go');
  await Promise.all([instance.lookup('wander'), instance.lookup('water')]);
  assert.equal(reads, 1);
});

test('failed reads can retry, cyclic aliases terminate and inherited keys never count', async () => {
  let calls = 0;
  const instance = core.createDictionary(async () => { if (++calls === 1) throw new Error('transient'); return { hello: ['hello', 'həˈləʊ', '你好'] }; });
  await assert.rejects(instance.lookup('hello'));
  assert.equal((await instance.lookup('hello')).status, 'ok');
  const cycle = core.createDictionary(async () => ({ aa: 'ab', ab: 'aa' }));
  assert.equal((await cycle.lookup('aa')).status, 'not-found');
  const inherited = core.createDictionary(async () => ({}));
  assert.equal((await inherited.lookup('constructor')).status, 'not-found');
});

test('manifest uses local code and permits only the fixed translation API', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'tts']);
  assert.deepEqual(manifest.host_permissions, ['https://api.mymemory.translated.net/*']);
  assert.ok(manifest.content_scripts[0].matches.includes('file:///*'));
  const files = [manifest.background.service_worker, manifest.action.default_popup,
    ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(script => script.js)];
  for (const file of files) await fs.access(path.join(root, file));
  const names = await fs.readdir(path.join(root, 'data'));
  let count = 0;
  for (const name of names.filter(name => name.endsWith('.json.gz'))) {
    const shard = JSON.parse(gunzipSync(await fs.readFile(path.join(root, 'data', name))));
    for (const [key, value] of Object.entries(shard)) {
      assert.equal(core.shardKey(key) + '.json.gz', name);
      if (Array.isArray(value)) { assert.equal(value.length, 3); count++; }
    }
  }
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'data/metadata.json')));
  assert.equal(count, metadata.entries);
});

test('real offline dictionary includes common phrases', async () => {
  for (const phrase of ['take care of', 'in front of', 'as well as', 'look forward to', 'good morning']) {
    const result = await dictionary.lookup(phrase);
    assert.equal(result.status, 'ok', phrase);
    assert.equal(result.kind, 'phrase', phrase);
    assert.ok(result.definitions.length);
  }
});

test('text input supports phrases and sentences, preserves case and rejects oversized or markup input', () => {
  assert.deepEqual(core.normalizeText('  Good\n morning  '), { text: 'Good morning', kind: 'phrase' });
  assert.equal(core.normalizeText('Reading opens the door to new ideas.').kind, 'sentence');
  assert.equal(core.dictionaryKey('“Take care of!”'), 'take care of');
  assert.equal(core.normalizeText('中文'), null);
  assert.equal(core.normalizeText('<script>bad</script>'), null);
  assert.equal(core.normalizeText('word '.repeat(401)), null);
  assert.equal(core.sanitizeSettings({ enabled: false }).onlineTranslation, true);
  assert.equal(core.sanitizeSettings({ onlineTranslation: false }).onlineTranslation, false);
});

test('translation chunking respects UTF-8 limits and preserves punctuation and content', () => {
  const encoder = new TextEncoder();
  for (const text of ['... Mr. Smith said: “Hello!” I.e. this is fine.', ('This is a sentence with “quoted” text. ').repeat(40).trim(), 'x'.repeat(1000) + ' end.']) {
    const parts = core.splitTranslationText(text);
    assert.ok(parts.every(part => encoder.encode(part).length <= 480));
    assert.equal(parts.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  }
});
