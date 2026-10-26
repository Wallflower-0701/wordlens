'use strict';
importScripts('core.js', 'translation.js', 'speech.js', 'selection-menu.js', 'native-bridge.js');

const selectionMenu = WordLensSelectionMenu.createSelectionMenu(chrome, WordLensCore);
chrome.contextMenus.onClicked.addListener(info => { selectionMenu.open(info).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { selectionMenu.register().catch(() => {}); });

const dictionary = WordLensCore.createDictionary(async key => {
  const response = await fetch(chrome.runtime.getURL(`data/${key}.json.gz`));
  if (response.status === 404) return {};
  if (!response.ok) throw new Error('词典文件读取失败');
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
});

const translator = WordLensTranslation.createTranslator();
const speech = WordLensSpeech.createSpeech(chrome.tts, chrome.runtime);
let recentPageLookup = null;
const nativeBridge = WordLensNative.createBridge({ api: chrome, core: WordLensCore, lookup: lookupText, speak,
  recent: async text => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.url?.split(/[?#]/)[0] === chrome.runtime.getURL('reader.html')) return true;
    if (tab?.id !== undefined) {
      try {
        // The card may have been open for minutes before its speaker is used.
        // Ask the live page rather than extending a query-time grace period.
        const card = await chrome.tabs.sendMessage(tab.id, { type: 'page-card-state' });
        if (card?.visible === true) return true;
      } catch { /* Protected viewers have no content script; use native lookup. */ }
    }
    if (!recentPageLookup || Date.now() - recentPageLookup.time > 900 || recentPageLookup.text.toLowerCase() !== text.toLowerCase()) return false;
    return tab?.id === recentPageLookup.tab;
  }
});
const settingsReady = chrome.storage.local.get('settings').then(({ settings }) => nativeBridge.configure(settings)).catch(() => {});
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
  if (area === 'local' && changes.settings) nativeBridge.configure(changes.settings.newValue);
});

async function speak(word) {
  const settings = WordLensCore.sanitizeSettings((await chrome.storage.local.get('settings')).settings);
  return speech.speak(word, settings.accent);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return false;
  if (['native-status', 'native-reconnect'].includes(message.type)) {
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
    settingsReady.then(async () => {
      if (message.type === 'native-reconnect') nativeBridge.configure((await chrome.storage.local.get('settings')).settings, true);
      sendResponse(nativeBridge.status());
    }).catch(() => sendResponse({ status: 'error', message: '本地辅助状态读取失败。' })); return true;
  }
  if (message.type === 'voice-status') {
    chrome.storage.local.get('settings').then(({ settings }) => speech.status(WordLensCore.sanitizeSettings(settings).accent))
      .then(sendResponse).catch(() => sendResponse({ status: 'error', message: '语音检查失败，请重新加载插件。' }));
    return true;
  }
  if (!['lookup', 'speak'].includes(message.type)) return false;
  const input = WordLensCore.normalizeText(message.word);
  if (!input) { sendResponse({ status: 'invalid', message: '请选择英文单词、短语或句子（最多 2000 个字符）。' }); return false; }
  if (message.type === 'lookup' && sender.tab) recentPageLookup = { text: input.text, tab: sender.tab.id, time: Date.now() };
  const operation = message.type === 'lookup' ? lookupText(input.text) : speak(input.text);
  operation.then(sendResponse).catch(() => sendResponse({ status: 'error', message: '读取失败，请在扩展管理页面重新加载插件，并刷新网页。' }));
  return true;
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'lookup-selection') return;
  const settings = WordLensCore.sanitizeSettings((await chrome.storage.local.get('settings')).settings);
  if (!settings.enabled) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const started = Date.now();
  try { await chrome.tabs.sendMessage(tab.id, { type: 'lookup-selection' }); } catch { }
  if (recentPageLookup?.tab === tab?.id && recentPageLookup.time >= started) return;
  await settingsReady;
  if (!nativeBridge.capture()) {
    await chrome.windows.create({ url: chrome.runtime.getURL('native-help.html'), type: 'popup', width: 580, height: 740 });
  }
});

chrome.runtime.onInstalled.addListener(async details => {
  await selectionMenu.register();
  if (details.reason !== 'install') return;
  const current = await chrome.storage.local.get('settings');
  if (!current.settings) await chrome.storage.local.set({ settings: WordLensCore.DEFAULTS });
  await chrome.tabs.create({ url: chrome.runtime.getURL('guide.html') });
});
