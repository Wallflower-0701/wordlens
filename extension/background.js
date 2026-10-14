'use strict';
importScripts('core.js', 'translation.js');

const dictionary = WordLensCore.createDictionary(async key => {
  const response = await fetch(chrome.runtime.getURL(`data/${key}.json.gz`));
  if (response.status === 404) return {};
  if (!response.ok) throw new Error('词典文件读取失败');
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
});

const translator = WordLensTranslation.createTranslator();
async function lookupText(value) {
  const input = WordLensCore.normalizeText(value);
  if (!input) return { status: 'invalid', message: '请选择英文单词、短语或句子（最多 2000 个字符）。' };
  const local = await dictionary.lookup(input.text);
  if (local.status === 'ok' || input.kind === 'word') return local;
  const settings = WordLensCore.sanitizeSettings((await chrome.storage.local.get('settings')).settings);
  if (!settings.onlineTranslation) return { status: 'offline-only', message: '本地词典未收录这段文字。请在插件面板开启“联网翻译”以翻译短语和句子。' };
  try {
    const translated = await translator.translate(input.text);
    return { status: 'ok', word: input.text, query: input.text, kind: input.kind, phonetic: '', definitions: translated.split('\n'), source: 'MyMemory', translation: true };
  } catch (error) { return { status: 'error', message: error.message }; }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings?.newValue?.onlineTranslation === false) translator.clear();
});

async function speak(word) {
  const settings = WordLensCore.sanitizeSettings((await chrome.storage.local.get('settings')).settings);
  const voices = await new Promise(resolve => chrome.tts.getVoices(resolve));
  const english = voices.filter(voice => /^en(?:-|$)/i.test(voice.lang || '') && !voice.remote && !voice.extensionId);
  const voice = english.find(item => item.lang?.toLowerCase() === settings.accent.toLowerCase()) || english[0];
  if (!voice) return { status: 'error', message: '没有可用的本地英语语音，请在系统设置中安装英语语音包。' };
  return new Promise(resolve => {
    let finished = false;
    const finish = result => { if (!finished) { finished = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => finish({ status: 'error', message: '发音引擎未响应，请稍后重试。' }), 12000);
    chrome.tts.speak(word, {
      voiceName: voice.voiceName, lang: voice.lang, rate: 0.85, enqueue: false,
      onEvent: event => {
        if (event.type === 'start' || event.type === 'end') finish({ status: 'ok', accent: voice.lang });
        if (event.type === 'error') finish({ status: 'error', message: '发音失败，请检查系统英语语音包。' });
        if (event.type === 'cancelled' || event.type === 'interrupted') finish({ status: 'ok' });
      }
    }, () => {
      if (chrome.runtime.lastError) finish({ status: 'error', message: '无法使用本地发音引擎，请检查英语语音包。' });
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
  if (!['lookup', 'speak'].includes(message.type)) return false;
  const input = WordLensCore.normalizeText(message.word);
  if (!input) { sendResponse({ status: 'invalid', message: '请选择英文单词、短语或句子（最多 2000 个字符）。' }); return false; }
  const operation = message.type === 'lookup' ? lookupText(input.text) : speak(input.text);
  operation.then(sendResponse).catch(() => sendResponse({ status: 'error', message: '读取失败，请在扩展管理页面重新加载插件，并刷新网页。' }));
  return true;
});

chrome.runtime.onInstalled.addListener(async details => {
  if (details.reason !== 'install') return;
  const current = await chrome.storage.local.get('settings');
  if (!current.settings) await chrome.storage.local.set({ settings: WordLensCore.DEFAULTS });
  await chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
});
