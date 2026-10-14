const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../extension/core.js');
const { createTranslator, parseResponse } = require('../extension/translation.js');

test('translation sends only selected text to the fixed endpoint, and deduplicates/caches requests', async () => {
  const requests = [];
  const translator = createTranslator(async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '阅读开启新思路。' } }));
  });
  const text = 'Reading opens the door to new ideas.';
  const results = await Promise.all([translator.translate(text), translator.translate(text)]);
  assert.equal(results[0], '阅读开启新思路。');
  assert.equal(results[1], results[0]);
  await translator.translate(text);
  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url);
  assert.equal(url.origin, 'https://api.mymemory.translated.net');
  assert.equal(url.searchParams.get('q'), text);
  assert.equal(url.searchParams.get('langpair'), 'en|zh-CN');
  assert.equal([...url.searchParams].length, 2);
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
});

test('quota and malformed responses never appear as translations', () => {
  assert.throws(() => parseResponse({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } }), /额度/);
  assert.throws(() => parseResponse({ responseStatus: 403, responseData: { translatedText: 'denied' } }), /有效结果/);
  assert.throws(() => parseResponse({ responseStatus: 200, responseData: { translatedText: '' } }), /有效结果/);
  assert.equal(parseResponse({ responseStatus: 200, responseData: { translatedText: '&quot;你好&quot; &amp; &#x4e16;&#30028;' } }), '"你好" & 世界');
});

test('timeouts and offline failures are reported and unsuccessful requests are retryable', async () => {
  let calls = 0;
  const translator = createTranslator(async () => {
    if (++calls === 1) throw new TypeError('network');
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '你好，世界。' } }));
  });
  await assert.rejects(translator.translate('Hello world.'), /联网翻译失败/);
  assert.equal(await translator.translate('Hello world.'), '你好，世界。');
  const timeout = createTranslator((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))), 20);
  await assert.rejects(timeout.translate('Hello world.'), /超时/);
});

test('long selections are split without truncation and each request stays under 500 bytes', async () => {
  const parts = [];
  const translator = createTranslator(async url => {
    const q = new URL(url).searchParams.get('q');
    parts.push(q);
    return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '这是译文。' } }));
  });
  const text = ('Reading opens the door to new ideas. ').repeat(40).trim();
  const translation = await translator.translate(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => Buffer.byteLength(part) <= 480));
  assert.equal(parts.join(' ').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.equal(translation.split('\n').length, parts.length);
});
