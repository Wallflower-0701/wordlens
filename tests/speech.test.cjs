const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chooseVoice, localEnglishVoices, createSpeech } = require('../extension/speech.js');

const english = { voiceName: 'English local', lang: 'en-US', remote: false };
const options = { delay: async () => {}, voiceTimeoutMs: 30, timeoutMs: 30 };

test('remote, unknown extension engines and Chinese voices never become an English fallback', async () => {
  const excluded = [
    { lang: 'zh-CN', remote: false },
    { lang: 'en-US', remote: true },
    { lang: 'en-US', extensionId: 'unknown' },
    { voiceName: 'English', remote: false },
  ];
  assert.deepEqual(localEnglishVoices(excluded), []);
  let speaks = 0;
  const speech = createSpeech({ getVoices: done => done(excluded), speak: () => speaks++ }, {}, options);
  const result = await speech.speak('Basic', 'en-US');
  assert.equal(result.status, 'unavailable');
  assert.match(result.message, /浏览器未识别/);
  assert.match(result.message, /添加语音/);
  assert.equal(speaks, 0);
});

test('regional preferences accept underscore locales and keep a local English fallback', () => {
  const uk = { voiceName: 'UK local', lang: 'EN_gb', remote: false };
  assert.equal(chooseVoice([english, uk], 'en-GB'), uk);
  assert.equal(chooseVoice([english], 'en-GB'), english);
});

test('explicitly local extension voices work and are routed to their engine', async () => {
  const voice = { voiceName: 'Local engine', lang: 'en_US', remote: false, extensionId: 'local-engine' };
  let actual;
  const speech = createSpeech({
    getVoices: done => done([voice]),
    speak: (text, settings, done) => { actual = { text, settings }; done(); settings.onEvent({ type: 'start' }); },
  }, {}, options);
  assert.equal((await speech.speak('Basic Notions', 'en-US')).status, 'ok');
  assert.equal(actual.text, 'Basic Notions');
  assert.equal(actual.settings.lang, 'en-US');
  assert.equal(actual.settings.extensionId, 'local-engine');
  assert.equal(chooseVoice([voice, english], 'en-US'), english);
});

test('a cold browser voice catalog can initialize after the first request', async () => {
  let calls = 0;
  const waits = [];
  const speech = createSpeech({ getVoices: done => done(++calls === 1 ? [] : [english]) }, {}, {
    ...options, delay: async ms => waits.push(ms),
  });
  const status = await speech.status('en-GB');
  assert.equal(status.status, 'ok');
  assert.equal(status.voiceName, english.voiceName);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [200]);
});

test('voice API failure and timeout are distinct from a missing language pack', async () => {
  const runtime = {};
  const failed = createSpeech({ getVoices: done => {
    runtime.lastError = { message: 'platform failure' }; done([]); delete runtime.lastError;
  } }, runtime, options);
  const failure = await failed.status('en-US');
  assert.equal(failure.status, 'error');
  assert.match(failure.message, /读取失败/);
  const stalled = createSpeech({ getVoices: () => {} }, {}, options);
  const timeout = await stalled.speak('Hello', 'en-US');
  assert.equal(timeout.status, 'error');
  assert.match(timeout.message, /读取超时/);
});

test('the next check discovers a voice installed after an earlier unavailable result', async () => {
  let voices = [];
  const speech = createSpeech({ getVoices: done => done(voices) }, {}, options);
  assert.equal((await speech.status('en-US')).status, 'unavailable');
  voices = [english];
  assert.equal((await speech.status('en-US')).status, 'ok');
});

test('engine errors and cancelled speech never report successful playback', async () => {
  for (const [event, expected] of [['error', 'error'], ['cancelled', 'cancelled'], ['interrupted', 'cancelled']]) {
    const speech = createSpeech({ getVoices: done => done([english]), speak: (text, settings) => settings.onEvent({ type: event }) }, {}, options);
    assert.equal((await speech.speak('Hello', 'en-US')).status, expected);
  }
  const runtime = {};
  const failed = createSpeech({ getVoices: done => done([english]), speak: (text, settings, done) => {
    runtime.lastError = { message: 'engine failure' }; done(); delete runtime.lastError;
  } }, runtime, options);
  assert.equal((await failed.speak('Hello', 'en-US')).status, 'error');
});

test('an accepted request without activity does not claim successful speech', async () => {
  const speech = createSpeech({ getVoices: done => done([english]), speak: (text, settings, done) => done() }, {}, options);
  const result = await speech.speak('Hello', 'en-US');
  assert.equal(result.status, 'error');
  assert.match(result.message, /未响应/);
});

test('an engine without speech events can report verified activity', async () => {
  const speech = createSpeech({
    getVoices: done => done([english]), speak: (text, settings, done) => done(), isSpeaking: done => done(true),
  }, {}, { ...options, timeoutMs: 1000 });
  assert.equal((await speech.speak('Hello', 'en-US')).status, 'ok');
});
