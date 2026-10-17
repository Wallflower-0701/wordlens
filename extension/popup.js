'use strict';
const controls = ['enabled', 'trigger', 'accent', 'onlineTranslation', 'lookupMode', 'nativeEnabled'].map(id => document.getElementById(id));
const status = document.getElementById('status');
const resultBox = document.getElementById('search-result');
let searchSequence = 0;
let saveQueue = Promise.resolve();

async function loadSettings() {
  try {
    const settings = WordLensCore.sanitizeSettings((await chrome.storage.local.get('settings')).settings);
    controls[0].checked = settings.enabled;
    controls[1].value = settings.trigger;
    controls[2].value = settings.accent;
    controls[3].checked = settings.onlineTranslation;
    controls[4].value = settings.lookupMode;
    controls[5].checked = settings.nativeEnabled;
  } catch { setStatus('设置读取失败，请重新打开插件面板。', true); }
}

function setStatus(text, isError = false) { status.textContent = text; status.classList.toggle('error', isError); }
controls.forEach(control => {
  control.disabled = true;
  control.addEventListener('change', () => {
    const settings = { enabled: controls[0].checked, trigger: controls[1].value, accent: controls[2].value, onlineTranslation: controls[3].checked, lookupMode: controls[4].value, nativeEnabled: controls[5].checked };
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      try { await chrome.storage.local.set({ settings }); setStatus('设置已保存，已打开的网页会立即生效。'); checkNative(); }
      catch { setStatus('设置保存失败，请重试。', true); }
    });
  });
});
loadSettings().finally(() => controls.forEach(control => { control.disabled = false; }));

chrome.extension.isAllowedFileSchemeAccess().then(allowed => {
  document.getElementById('file-access-status').textContent = allowed ? '本地 HTML：文件访问已开启' : '本地 HTML：需要开启文件访问';
  document.getElementById('file-access-hint').hidden = allowed;
}).catch(() => { document.getElementById('file-access-status').textContent = '本地 HTML：请检查文件访问权限'; });
document.getElementById('file-access-settings').addEventListener('click', () => {
  const scheme = /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
  chrome.tabs.create({ url: `${scheme}://extensions/?id=${chrome.runtime.id}` });
});

const voiceStatus = document.getElementById('voice-status');
const voiceHint = document.getElementById('voice-hint');
const voiceCheck = document.getElementById('voice-check');
const voiceTest = document.getElementById('voice-test');
async function checkVoice() {
  voiceCheck.disabled = true;
  voiceStatus.textContent = '正在检查本地英语语音…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'voice-status' });
    voiceStatus.textContent = result.status === 'ok' ? `本地英语语音：${result.voiceName}` : (result.status === 'unavailable' ? '本地英语语音：浏览器未识别到' : '本地英语语音：检查失败');
    voiceHint.hidden = result.status === 'ok';
    voiceHint.textContent = result.message || '';
  } catch {
    voiceStatus.textContent = '语音检查失败，请重新加载插件。';
  } finally { voiceCheck.disabled = false; }
}
voiceCheck.addEventListener('click', checkVoice);
voiceTest.addEventListener('click', async () => {
  voiceTest.disabled = true;
  setStatus('正在测试本地英语语音…');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'speak', word: 'Hello. Welcome to WordLens.' });
    setStatus(result.status === 'ok' ? `已调用 ${result.voiceName}；请确认是否听到英语。` : result.message, result.status !== 'ok');
  } catch { setStatus('发音测试失败，请重新加载插件。', true); }
  finally { voiceTest.disabled = false; }
});
checkVoice();
let nativeCheckTicket = 0;
async function checkNative(reconnect = false) {
  const ticket = ++nativeCheckTicket;
  const label = document.getElementById('native-status');
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const result = await chrome.runtime.sendMessage({ type: reconnect && attempt === 0 ? 'native-reconnect' : 'native-status' });
      if (ticket !== nativeCheckTicket) return;
      label.textContent = result.message;
      label.dataset.state = result.status;
      if (result.status !== 'connecting') return;
      await new Promise(resolve => setTimeout(resolve, 650));
    } catch { label.textContent = '原页面增强检查失败，请重新加载插件。'; return; }
  }
}
document.getElementById('native-reconnect').addEventListener('click', () => checkNative(true));
checkNative();
document.getElementById('open-reader').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') });
});

function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

document.getElementById('query').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.getElementById('search-form').requestSubmit(); }
});

document.getElementById('search-form').addEventListener('submit', async event => {
  event.preventDefault();
  const ticket = ++searchSequence;
  const input = WordLensCore.normalizeText(document.getElementById('query').value);
  const word = input?.text;
  resultBox.hidden = false;
  resultBox.textContent = word ? (input.kind === 'word' ? '正在查询本地词典…' : '正在查询短语或翻译句子…') : '请输入英文单词、短语或句子（最多 2000 个字符）。';
  if (!word) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'lookup', word });
    if (ticket !== searchSequence) return;
    resultBox.replaceChildren();
    if (result.status !== 'ok') {
      resultBox.append(element('p', 'definition', result.status === 'not-found' ? '词典暂未收录这个单词，可以试试原形。' : (result.message || '查询失败，请重新加载插件。')));
      return;
    }
    const heading = element('div', 'result-heading');
    const button = element('button', 'pronounce', '听发音');
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      setStatus('正在调用本地英语语音…');
      try {
        const audio = await chrome.runtime.sendMessage({ type: 'speak', word: result.word });
        if (ticket !== searchSequence) return;
        setStatus(audio.status === 'ok' ? '本地英语朗读；音标以词典标注为准。' : audio.message, audio.status !== 'ok');
      } catch { if (ticket === searchSequence) setStatus('发音不可用，请检查本地英语语音包。', true); }
      finally { button.disabled = false; }
    });
    heading.append(element('h2', result.kind === 'word' ? '' : 'long', result.word), button);
    resultBox.append(heading, element('p', 'phonetic', result.phonetic ? WordLensCore.displayPhonetic(result.phonetic) : (result.kind === 'word' ? '暂无音标' : (result.translation ? '英文 → 简体中文' : '短语释义'))));
    if (result.isBaseForm) resultBox.append(element('p', 'result-note', `“${word}” 的原形释义`));
    result.definitions.forEach(line => resultBox.append(element('p', 'definition', line)));
    resultBox.append(element('p', 'result-note', result.translation ? 'MyMemory 机器翻译 · 仅发送查询文字' : 'ECDICT · 离线英汉词典'));
  } catch { if (ticket === searchSequence) resultBox.textContent = '查询失败，请在扩展管理页面重新加载插件。'; }
});

(async () => {
  const id = new URLSearchParams(location.hash.slice(1)).get('lookup');
  if (!id) return;
  history.replaceState(null, '', location.pathname);
  try {
    const pending = await WordLensSelectionMenu.createSelectionMenu(chrome, WordLensCore).consume(id);
    if (!pending) { setStatus('这次选区已过期，请重新选中文字后右键查词。', true); return; }
    document.getElementById('query').value = pending.text;
    document.getElementById('search-form').requestSubmit();
  } catch { setStatus('选区读取失败，请将文字粘贴到上方查询。', true); }
})();
