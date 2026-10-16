(() => {
  'use strict';
  if (globalThis.__wordLensActive) return;
  globalThis.__wordLensActive = true;
  const { normalizeText, sanitizeSettings, displayPhonetic } = WordLensCore;
  let settings = sanitizeSettings();
  let host, shadow, card, body, wordLabel, phoneticLabel, note, speaker;
  let sequence = 0;
  let anchor = null;
  let activeWord = '';
  let selectedQuery = '';
  let open = false;
  let timer;
  let pointerSelecting = false;
  let ready = false;
  let speechSequence = 0;

  const style = `
    :host { all: initial !important; position: fixed !important; inset: var(--wl-top, 0px) auto auto var(--wl-left, 0px) !important;
      margin: 0 !important; padding: 0 !important; border: 0 !important;
      background: transparent !important; z-index: 2147483647 !important;
      width: var(--wl-width, min(344px, calc(100vw - 24px))) !important; color-scheme: light !important; }
    :host([hidden]) { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    .card { font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      color: #263d35; background: #fffefb; border: 1px solid #dedfd5; border-radius: 18px;
      box-shadow: 0 10px 40px #132c2826, 0 2px 8px #132c2810; overflow: hidden; text-align: left;
      max-height: calc(100vh - 24px); display: flex; flex-direction: column; }
    .top { display: flex; align-items: center; gap: 7px; padding: 14px 18px 0; }
    .brand { font-size: 10px; font-weight: 800; letter-spacing: 1.7px; color: #648274; }
    .offline { font-size: 10px; padding: 1px 7px; border-radius: 20px; background: #eaf2e9; color: #496a50; }
    button { font: inherit; cursor: pointer; border: 0; background: transparent; color: inherit; padding: 0; }
    button:focus-visible { outline: 2px solid #56765e; outline-offset: 3px; }
    .close { margin-left: auto; height: 26px; width: 26px; border-radius: 8px; font-size: 21px; color: #7a837b; line-height: 1; }
    .close:hover { background: #eff1e9; }
    .heading { padding: 7px 20px 16px; }
    .word { font: 600 30px/1.25 Georgia, "Times New Roman", serif; margin: 0 0 10px; overflow-wrap: anywhere; color: #203b30; }
    .word.long { font: 500 17px/1.55 -apple-system, "Segoe UI", sans-serif; max-height: 145px; overflow: auto; }
    .sound-row { display: flex; align-items: center; gap: 10px; }
    .phonetic { color: #6d776e; font-size: 14px; font-family: "Segoe UI", "Arial Unicode MS", sans-serif; overflow-wrap: anywhere; }
    .speak { flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; background: #eaf1e7; color: #356349; display: grid; place-items: center; }
    .speak:hover { background: #d9e6d5; }
    .speak:disabled { opacity: .5; cursor: wait; }
    .speak svg { width: 16px; height: 16px; }
    .body { padding: 16px 20px 19px; border-top: 1px solid #edeee5; overflow: auto; overscroll-behavior: contain; min-height: 0; }
    .definition { margin: 0 0 9px; overflow-wrap: anywhere; }
    .definition:last-child { margin-bottom: 0; }
    .pos { display: inline-block; font: 600 12px/1.7 Georgia, serif; color: #63805f; background: #eff3e9; padding: 0 6px; border-radius: 4px; margin-right: 7px; }
    .muted { color: #7d8379; font-size: 12px; margin: 7px 0 0; }
    .note { padding: 9px 20px 11px; background: #f6f7f0; font-size: 10px; color: #7d8578; }
    .error { color: #99572e; }
    @media (prefers-reduced-motion: no-preference) { .card { animation: appear .13s ease-out; } @keyframes appear { from { opacity: 0; transform: translateY(4px); } } }
  `;

  function build() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'wordlens-card-host';
    host.setAttribute('popover', 'manual');
    host.hidden = true;
    shadow = host.attachShadow({ mode: 'open' });
    // Only this static, extension-owned template is parsed as HTML. All lookup data uses textContent.
    shadow.innerHTML = `<style>${style}</style><section class="card" role="dialog" aria-label="WordLens 释义与翻译" aria-modal="false">
      <div class="top"><span class="brand">WORDLENS</span><span class="offline">离线</span><button class="close" type="button" aria-label="关闭释义" title="关闭（Esc）">×</button></div>
      <div class="heading"><h2 class="word"></h2><div class="sound-row"><span class="phonetic"></span>
      <button class="speak" type="button" aria-label="朗读所选英文" title="本地语音朗读英文"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke-linejoin="round"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke-linecap="round"/></svg></button></div></div>
      <div class="body" aria-live="polite"></div><div class="note" role="status"></div></section>`;
    document.documentElement.append(host);
    card = shadow.querySelector('.card');
    body = shadow.querySelector('.body');
    wordLabel = shadow.querySelector('.word');
    phoneticLabel = shadow.querySelector('.phonetic');
    note = shadow.querySelector('.note');
    speaker = shadow.querySelector('.speak');
    shadow.querySelector('.close').addEventListener('click', hide);
    speaker.addEventListener('click', play);
    // Keep the source selection while using the card with a pointer.
    shadow.addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault(); });
  }

  function inside(event) { return host && event.composedPath().includes(host); }
  function hide() {
    sequence++;
    speechSequence++;
    open = false;
    activeWord = '';
    selectedQuery = '';
    if (!host) return;
    if (host.matches(':popover-open')) host.hidePopover();
    host.hidden = true;
  }

  function position() {
    if (!open || !anchor || !host) return;
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft || 0;
    const topEdge = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    host.style.setProperty('--wl-width', `${Math.min(344, Math.max(120, width - 24))}px`);
    const rect = card.getBoundingClientRect();
    const left = Math.min(Math.max(leftEdge + 12, anchor.left), leftEdge + width - rect.width - 12);
    let top = anchor.bottom + 10;
    if (top + rect.height > topEdge + height - 12) top = anchor.top - rect.height - 10;
    top = Math.max(topEdge + 12, Math.min(top, topEdge + height - rect.height - 12));
    host.style.setProperty('--wl-left', `${left}px`);
    host.style.setProperty('--wl-top', `${top}px`);
  }

  function paragraph(text, className = 'definition') {
    const element = document.createElement('p');
    element.className = className;
    element.textContent = text;
    body.append(element);
    return element;
  }

  function render(result, selected) {
    body.replaceChildren();
    speaker.disabled = result.status !== 'ok';
    note.classList.remove('error');
    if (result.status === 'ok') {
      wordLabel.textContent = result.word;
      wordLabel.classList.toggle('long', result.kind !== 'word');
      shadow.querySelector('.offline').textContent = result.translation ? '联网翻译' : '离线';
      phoneticLabel.textContent = result.phonetic ? displayPhonetic(result.phonetic) : (result.kind === 'word' ? '暂无音标' : (result.translation ? '英文 → 简体中文' : '短语释义'));
      activeWord = result.word;
      if (result.isBaseForm) paragraph(`“${selected}” 的原形释义`, 'muted');
      for (const line of result.definitions) {
        const match = line.match(/^([a-z]{1,6}\.(?:\/[a-z]{1,6}\.)?)\s+(.+)$/);
        const element = paragraph('');
        if (match) {
          const badge = document.createElement('span');
          badge.className = 'pos'; badge.textContent = match[1];
          element.append(badge, document.createTextNode(match[2]));
        } else element.textContent = line;
      }
      note.textContent = result.translation ? 'MyMemory 机器翻译 · 仅发送所选文字 · Esc 关闭' : 'ECDICT 离线词典 · 点击空白或按 Esc 关闭';
    } else {
      phoneticLabel.textContent = '—';
      paragraph(result.status === 'not-found' ? '词典暂未收录这个单词' : (result.message || '查询暂时不可用'));
      if (result.status === 'not-found') paragraph('可以试试单词原形，或检查拼写。', 'muted');
      note.textContent = 'WordLens · 按 Esc 关闭';
    }
    position();
  }

  async function play() {
    if (!activeWord) return;
    const ticket = ++speechSequence;
    speaker.disabled = true;
    note.classList.remove('error');
    note.textContent = '正在调用本地英语语音…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'speak', word: activeWord });
      if (ticket !== speechSequence) return;
      note.textContent = result.status === 'ok' ? '本地语音合成 · 音标以词典标注为准' : result.message;
      note.classList.toggle('error', result.status !== 'ok');
    } catch {
      if (ticket === speechSequence) { note.textContent = '插件已更新，请刷新网页后重试。'; note.classList.add('error'); }
    } finally { if (ticket === speechSequence) { speaker.disabled = false; position(); } }
  }

  function editable(selection, event) {
    const nodes = [selection.anchorNode, selection.focusNode, event.target, document.activeElement];
    return nodes.some(node => {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      return element && (element.isContentEditable || element.closest('input,textarea,select,[role="textbox"]'));
    });
  }

  async function inspect(event, manual = false) {
    if (!ready || !settings.enabled || inside(event)) return;
    if (!manual && settings.lookupMode !== 'auto') return;
    if (!manual && settings.trigger === 'alt' && !event.altKey) { hide(); return; }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || editable(selection, event)) { hide(); return; }
    const input = normalizeText(selection.toString());
    if (!input) { hide(); return; }
    const word = input.text;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) { hide(); return; }
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
    if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) { hide(); return; }
    build();
    const ticket = ++sequence;
    speechSequence++;
    selectedQuery = word;
    anchor = { left: rect.left, top: rect.top, bottom: rect.bottom };
    open = true;
    wordLabel.textContent = word;
    wordLabel.classList.toggle('long', input.kind !== 'word');
    shadow.querySelector('.offline').textContent = input.kind === 'word' ? '离线' : '释义 / 翻译';
    phoneticLabel.textContent = '正在查询…';
    body.replaceChildren();
    paragraph(input.kind === 'word' ? '正在读取本地词典…' : '正在查询短语或翻译句子…', 'muted');
    note.textContent = input.kind === 'word' ? '离线查询 · 无需联网' : (settings.onlineTranslation ? '本地优先 · 未收录时仅发送所选文字联网翻译' : '联网翻译已关闭 · 仅查询本地词典');
    note.classList.remove('error');
    speaker.disabled = true;
    host.hidden = false;
    if (typeof host.showPopover === 'function' && !host.matches(':popover-open')) host.showPopover();
    position();
    try {
      const result = await chrome.runtime.sendMessage({ type: 'lookup', word });
      if (ticket === sequence && open) render(result, word);
    } catch {
      if (ticket === sequence && open) render({ status: 'error', message: '插件已更新或连接中断，请刷新网页后重试。' }, word);
    }
  }

  function scheduleInspect(event, delay) {
    const selection = window.getSelection();
    const expected = selection?.isCollapsed ? null : normalizeText(selection?.toString())?.text;
    clearTimeout(timer);
    if (!expected) { hide(); return; }
    timer = setTimeout(() => {
      const current = window.getSelection();
      if (current?.isCollapsed || normalizeText(current?.toString())?.text !== expected) { hide(); return; }
      inspect(event);
    }, delay);
  }

  document.addEventListener('pointerdown', event => {
    if (!event.isTrusted || inside(event)) return;
    pointerSelecting = true;
    clearTimeout(timer);
    hide();
  }, true);
  document.addEventListener('pointerup', event => {
    if (!event.isTrusted) return;
    pointerSelecting = false;
    if (inside(event) || event.button !== 0) return;
    scheduleInspect(event, 35);
  }, true);
  document.addEventListener('pointercancel', () => { pointerSelecting = false; hide(); }, true);
  document.addEventListener('keyup', event => {
    if (!event.isTrusted) return;
    if (event.key === 'Escape') { clearTimeout(timer); hide(); return; }
    if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      scheduleInspect(event, 50);
    }
  }, true);
  document.addEventListener('selectionchange', () => {
    if (pointerSelecting || !open) return;
    const selection = window.getSelection();
    if (selection?.anchorNode && shadow?.contains(selection.anchorNode)) return;
    // Invalidate in-flight lookups as soon as the underlying selection changes.
    const word = selection?.isCollapsed ? null : normalizeText(selection?.toString())?.text;
    if (!word || word !== selectedQuery) hide();
  });
  window.addEventListener('scroll', event => { if (open && !inside(event)) hide(); }, true);
  window.addEventListener('resize', hide);
  window.visualViewport?.addEventListener('resize', hide);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) { settings = sanitizeSettings(changes.settings.newValue); hide(); }
  });
  chrome.storage.local.get('settings').then(result => { settings = sanitizeSettings(result.settings); ready = true; }).catch(() => { ready = true; });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'lookup-selection') return false;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !normalizeText(selection.toString())) return false;
    inspect({ target: document.activeElement, altKey: false, composedPath: () => [] }, true).then(() => respond({ status: 'handled' }));
    return true;
  });
})();
