/* Select local English voices only; never silently fall back to network speech. */
(() => {
  'use strict';
  const MISSING_MESSAGE = '浏览器未识别到本地英语语音。Windows：在“时间和语言 → 语音 → 添加语音”中安装英语，再彻底退出并重新打开浏览器。';
  const language = value => typeof value === 'string' ? value.trim().replace(/_/g, '-').toLowerCase() : '';
  function localEnglishVoices(voices) {
    return (Array.isArray(voices) ? voices : []).filter(voice =>
      voice && /^en(?:-|$)/.test(language(voice.lang)) && voice.remote !== true &&
      (!voice.extensionId || voice.remote === false));
  }
  function chooseVoice(voices, accent) {
    const english = localEnglishVoices(voices);
    const preferred = english.filter(voice => language(voice.lang) === language(accent));
    const candidates = preferred.length ? preferred : english;
    return candidates.find(voice => !voice.extensionId) || candidates[0];
  }
  function createSpeech(tts, runtime, { delay = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 12000, voiceTimeoutMs = 3000 } = {}) {
    let speechSequence = 0;
    function getVoices() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('语音列表读取超时，请重启浏览器后重试。')), voiceTimeoutMs);
        try {
          tts.getVoices(voices => {
            clearTimeout(timer);
            if (runtime.lastError) reject(new Error('语音列表读取失败，请重启浏览器后重试。'));
            else resolve(voices);
          });
        } catch {
          clearTimeout(timer);
          reject(new Error('本地发音接口不可用，请重启浏览器后重试。'));
        }
      });
    }
    async function discover(accent) {
      // The browser may initialize its voice catalog after the first query.
      let voices;
      for (const wait of [0, 200, 500]) {
        if (wait) await delay(wait);
        voices = await getVoices();
        if (chooseVoice(voices, accent)) break;
      }
      return localEnglishVoices(voices);
    }
    async function status(accent) {
      try {
        const voices = await discover(accent);
        const voice = chooseVoice(voices, accent);
        return voice ? { status: 'ok', voiceName: voice.voiceName || '本地英语语音', accent: voice.lang }
          : { status: 'unavailable', message: MISSING_MESSAGE };
      } catch (error) { return { status: 'error', message: error.message }; }
    }
    async function speak(text, accent) {
      const ticket = ++speechSequence;
      let voice;
      try { voice = chooseVoice(await discover(accent), accent); }
      catch (error) { return { status: 'error', message: error.message }; }
      if (ticket !== speechSequence) return { status: 'cancelled', message: '已切换到新的朗读请求。' };
      if (!voice) return { status: 'unavailable', message: MISSING_MESSAGE };
      return new Promise(resolve => {
        let finished = false;
        let probe;
        const finish = result => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          clearTimeout(probe);
          resolve(result);
        };
        const ok = () => finish({ status: 'ok', voiceName: voice.voiceName || '本地英语语音', accent: voice.lang });
        const timer = setTimeout(() => finish({ status: 'error', message: '发音引擎未响应，请重启浏览器后重试。' }), timeoutMs);
        try {
          tts.speak(text, {
            voiceName: voice.voiceName, lang: voice.lang.replace(/_/g, '-'), rate: 0.85, enqueue: false,
            ...(voice.extensionId ? { extensionId: voice.extensionId } : {}),
            onEvent: event => {
              if (event.type === 'start' || event.type === 'end') ok();
              if (event.type === 'error') finish({ status: 'error', message: '本地发音失败，请重启浏览器；仍失败时检查系统英语语音。' });
              if (event.type === 'cancelled' || event.type === 'interrupted') finish({ status: 'cancelled', message: '朗读已停止，请点击发音按钮重试。' });
            }
          }, () => {
            if (runtime.lastError) finish({ status: 'error', message: '无法调用本地发音引擎，请重启浏览器后重试。' });
            // Some engines omit start/end events. Verify activity instead of
            // treating acceptance of the request as audible success.
            else if (!finished && typeof tts.isSpeaking === 'function') {
              probe = setTimeout(() => {
                if (finished) return;
                try { tts.isSpeaking(active => { if (!runtime.lastError && active) ok(); }); } catch { /* Await the event or timeout. */ }
              }, 250);
            }
          });
        } catch { finish({ status: 'error', message: '无法调用本地发音引擎，请重启浏览器后重试。' }); }
      });
    }
    return { speak, status };
  }
  const api = { localEnglishVoices, chooseVoice, createSpeech };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.WordLensSpeech = api;
})();
