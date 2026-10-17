(function (root) {
  'use strict';
  const HOST = 'com.wordlens.selection';
  function createBridge({ api, core, lookup, speak, recent = async () => false, timeout = 6000 }) {
    let port = null, settings = core.sanitizeSettings(), state = 'disabled', message = '原页面增强已关闭。';
    let generation = 0, active = null, handshake;
    function status() { return { status: state, message }; }
    function post(value) {
      if (!port) return false;
      try { port.postMessage(value); return true; }
      catch { stop(); state = 'missing'; message = '本地辅助组件已断开，请重新连接。'; return false; }
    }
    function stop() {
      generation++; active = null; clearTimeout(handshake);
      const previous = port; port = null; if (previous) { try { previous.disconnect(); } catch {} }
    }
    async function received(value, connected) {
      if (connected !== port || !value || typeof value !== 'object') return;
      if (value.type === 'ready') {
        if (value.version !== '1.3.1') { stop(); state = 'missing'; message = '本地辅助版本不匹配，请安装 / 更新 1.3.1 组件。'; return; }
        clearTimeout(handshake); state = 'ready'; message = '原页面增强已连接 · 只读取当前选区';
        if (value.automatic === false && settings.lookupMode === 'auto') message = '本地辅助已连接，但鼠标取词不可用；可切换快捷键模式。';
        post({ type: 'configure', mode: settings.lookupMode, trigger: settings.trigger }); return;
      }
      if (state !== 'ready' || !settings.enabled || !settings.nativeEnabled || settings.lookupMode === 'context') return;
      if (value.type === 'capture-status') {
        const reasons = {
          'no-provider': '查看器尚未提供可读取的文字层',
          'no-selection': '未读到所选文字，请重新选择英文',
          'protected': '输入框或受保护文字不自动取词',
          'provider-error': '读取文字层失败，请重新选择',
          'provider-timeout': '读取文字层超时，请点击重新连接',
          'search-limit': '文字层查找超时或过于复杂，请尝试 Alt+W',
          'too-long': '选区超过 2000 字符，请缩短选区'
        };
        if (value.state === 'no-selection' && Object.hasOwn(reasons, value.reason)) message = `原页面增强已连接 · ${reasons[value.reason]}`;
        else if (value.state === 'selected') message = '原页面增强已连接 · 已读到选区，正在查询';
        else if (value.state === 'shown') message = '原页面增强已连接 · 已显示原页面释义';
        return;
      }
      if (value.type === 'dismissed') { generation++; active = null; return; }
      if (value.type === 'selection') {
        const ticket = ++generation; active = null;
        const input = core.normalizeText(value.text);
        if (!input || !/^[a-f0-9]{32}$/.test(value.requestId || '')) { post({ type: 'dismiss' }); return; }
        if (await recent(input.text)) { if (ticket === generation) post({ type: 'dismiss' }); return; }
        if (ticket !== generation || connected !== port) return;
        active = { id: value.requestId, text: input.text };
        let result;
        try { result = await lookup(input.text); }
        catch { result = { status: 'error', message: '查询失败，请重试。' }; }
        if (ticket !== generation || connected !== port || !active) return;
        result = { ...result, displayPhonetic: result.phonetic ? core.displayPhonetic(result.phonetic) : (input.kind === 'word' ? '暂无音标' : '英文 → 中文') };
        post({ type: 'result', requestId: value.requestId, result });
      } else if (value.type === 'speak' && active?.id === value.requestId) {
        const id = active.id, ticket = generation; let audio;
        try { audio = await speak(active.text); } catch { audio = { status: 'error', message: '本地发音暂时不可用。' }; }
        if (ticket === generation && connected === port) post({ type: 'speech-status', requestId: id, message: audio.status === 'ok' ? '本地英语朗读 · 音标以词典为准' : audio.message });
      } else if (value.type === 'capture-empty') {
        generation++; active = null;
        if (/^[a-f0-9]{32}$/.test(value.requestId || '')) post({ type: 'result', requestId: value.requestId,
          result: { status: 'error', message: '没有读到所选文字。请先选中英文后重试；扫描图片、受保护文档或未暴露文字的画布暂时无法取词。' } });
        else post({ type: 'dismiss' });
      }
    }
    function configure(value, force = false) {
      settings = core.sanitizeSettings(value); generation++; active = null;
      if (!settings.nativeEnabled || !settings.enabled || settings.lookupMode === 'context') {
        stop(); state = 'disabled'; message = settings.lookupMode === 'context' ? '右键模式：选择文字后右键查词。' : '原页面增强已关闭。'; return status();
      }
      if (force) stop();
      if (port) { post({ type: 'configure', mode: settings.lookupMode, trigger: settings.trigger }); return status(); }
      state = 'connecting'; message = '正在连接本地辅助组件…';
      try {
        const connected = api.runtime.connectNative(HOST); port = connected;
        connected.onMessage.addListener(value => { received(value, connected).catch(() => {}); });
        connected.onDisconnect.addListener(() => {
          const reason = api.runtime.lastError?.message;
          if (connected !== port) return;
          port = null; clearTimeout(handshake); generation++; active = null; state = 'missing';
          message = reason ? '本地辅助组件未连接，请先安装，再点击重新连接。' : '本地辅助组件已断开，请重新连接。';
        });
        handshake = setTimeout(() => { if (connected !== port || state === 'ready') return; stop(); state = 'missing'; message = '本地辅助组件连接超时，请重新安装 / 更新后重试。'; }, timeout);
      } catch { port = null; state = 'unsupported'; message = '此浏览器不支持 Windows 原页面增强。'; }
      return status();
    }
    function capture() { return state === 'ready' && post({ type: 'capture' }); }
    return { configure, status, capture, stop };
  }
  const api = { HOST, createBridge };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WordLensNative = api;
})(globalThis);
