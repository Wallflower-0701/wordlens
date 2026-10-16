(function (root) {
  'use strict';
  const ID = 'wordlens-lookup-selection', PREFIX = 'selection-query:', TTL = 120000;
  function createSelectionMenu(api, core, options = {}) {
    const now = options.now || Date.now, uuid = options.uuid || (() => crypto.randomUUID());
    async function register() {
      await api.contextMenus.removeAll();
      api.contextMenus.create({ id: ID, title: '用 WordLens 查词 / 翻译所选文字', contexts: ['selection'] });
    }
    async function open(info) {
      if (info.menuItemId !== ID) return;
      const input = core.normalizeText(info.selectionText);
      // Even invalid / oversized selections open the panel with a useful explanation.
      const id = uuid(), stored = await api.storage.session.get(null);
      const keys = Object.keys(stored).filter(key => key.startsWith(PREFIX));
      const expired = keys.filter(key => !stored[key]?.created || now() - stored[key].created > TTL);
      expired.push(...keys.filter(key => !expired.includes(key)).slice(0, Math.max(0, keys.length - expired.length - 7)));
      if (expired.length) await api.storage.session.remove(expired);
      await api.storage.session.set({ [PREFIX + id]: { text: input?.text || '', created: now() } });
      try { await api.windows.create({ url: api.runtime.getURL(`popup.html#lookup=${id}`), type: 'popup', width: 420, height: 740 }); }
      catch { await api.storage.session.remove(PREFIX + id); }
    }
    async function consume(id) {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(id || '')) return null;
      const key = PREFIX + id, result = (await api.storage.session.get(key))[key];
      await api.storage.session.remove(key);
      if (!result || !Number.isFinite(result.created) || now() - result.created < 0 || now() - result.created > TTL) return null;
      return result;
    }
    return { register, open, consume };
  }
  const api = { ID, createSelectionMenu };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WordLensSelectionMenu = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
