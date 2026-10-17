/* Shared, dependency-free lookup logic. */
(() => {
  'use strict';
  const DEFAULTS = Object.freeze({ enabled: true, trigger: 'selection', accent: 'en-GB', onlineTranslation: true, lookupMode: 'auto', nativeEnabled: false });
  const MAX_TEXT_LENGTH = 2000;

  function normalizeText(value) {
    if (typeof value !== 'string' || value.length > 10000) return null;
    const text = value.trim().replace(/\s+/g, ' ');
    if (!text || text.length > MAX_TEXT_LENGTH || !/[A-Za-z]/.test(text) || /[<>{}`\u0000-\u0008\u000e-\u001f\u3400-\u9fff]/.test(text)) return null;
    const word = normalizeWord(text);
    if (word) return { text, kind: 'word' };
    if (!/\s/.test(text)) return null;
    return { text, kind: /[.!?]/.test(text) || text.split(' ').length > 8 ? 'sentence' : 'phrase' };
  }

  function dictionaryKey(value) {
    const input = normalizeText(value);
    if (!input || input.text.length > 160) return null;
    const key = input.text.replace(/[‘’]/g, "'").replace(/[‐‑–]/g, '-')
      .replace(/^[\s"“”([{<.,!?;:]+|[\s"“”\])}>.,!?;:]+$/g, '').toLowerCase();
    return /^[a-z]+(?:[-' ][a-z]+)*$/.test(key) ? key : null;
  }

  function splitTranslationText(text, maxBytes = 480) {
    const encoder = new TextEncoder();
    const parts = [];
    let current = '';
    // Preserve the full input; prefer sentence boundaries near the chunk limit.
    for (const character of text) {
      while (encoder.encode(current + character).length > maxBytes) {
        const endings = [...current.matchAll(/[.!?]["”']?\s/g)];
        const last = endings[endings.length - 1];
        const sentenceEnd = last ? last.index + last[0].length : 0;
        const wordEnd = current.lastIndexOf(' ') + 1;
        const boundary = sentenceEnd >= current.length / 2 ? sentenceEnd : (wordEnd || current.length);
        const part = current.slice(0, boundary).trim();
        if (part) parts.push(part);
        current = current.slice(boundary).trimStart();
      }
      if (current || !/\s/.test(character)) current += character;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  function normalizeWord(value) {
    if (typeof value !== 'string' || value.length > 120) return null;
    const word = value.trim().replace(/[‘’]/g, "'").replace(/[‐‑–]/g, '-')
      .replace(/^[\s"“”([{<.,!?;:]+|[\s"“”\])}>.,!?;:]+$/g, '');
    return word.length <= 64 && /^[A-Za-z]+(?:[-'][A-Za-z]+)*$/.test(word) ? word.toLowerCase() : null;
  }

  function sanitizeSettings(value) {
    return {
      enabled: typeof value?.enabled === 'boolean' ? value.enabled : DEFAULTS.enabled,
      trigger: value?.trigger === 'alt' ? 'alt' : 'selection',
      accent: value?.accent === 'en-US' ? 'en-US' : 'en-GB',
      onlineTranslation: typeof value?.onlineTranslation === 'boolean' ? value.onlineTranslation : DEFAULTS.onlineTranslation,
      lookupMode: ['auto', 'shortcut', 'context'].includes(value?.lookupMode) ? value.lookupMode : 'auto',
      nativeEnabled: value?.nativeEnabled === true
    };
  }

  function shardKey(word) { return word.slice(0, 2).replace(/[^a-z]/g, '_'); }
  function displayPhonetic(value) {
    return value ? '/' + value.replace(/^[/\[]|[/\]]$/g, '').replace(/'/g, 'ˈ').replace(/:/g, 'ː') + '/' : '暂无音标';
  }

  function createDictionary(loadShard, maxCached = 10) {
    const cache = new Map();
    async function shard(key) {
      if (cache.has(key)) {
        const result = cache.get(key);
        cache.delete(key);
        cache.set(key, result);
        return result;
      }
      const pending = Promise.resolve().then(() => loadShard(key));
      cache.set(key, pending);
      while (cache.size > maxCached) cache.delete(cache.keys().next().value);
      try { return await pending; }
      catch (error) { if (cache.get(key) === pending) cache.delete(key); throw error; }
    }

    async function lookup(value) {
      const query = dictionaryKey(value);
      if (!query) return { status: 'invalid' };
      let key = query;
      const seen = new Set();
      for (let i = 0; i < 5; i++) {
        if (seen.has(key)) break;
        seen.add(key);
        const data = await shard(shardKey(key));
        const row = Object.hasOwn(data, key) ? data[key] : null;
        if (typeof row === 'string') { key = row; continue; }
        if (Array.isArray(row) && row.length >= 3) {
          return { status: 'ok', query, word: row[0], phonetic: row[1],
            definitions: row[2].split('\n').map(line => line.trim()).filter(Boolean),
            isBaseForm: key !== query, kind: query.includes(' ') ? 'phrase' : 'word', source: 'ECDICT' };
        }
        break;
      }
      return { status: 'not-found', query };
    }
    return { lookup };
  }

  const api = { DEFAULTS, MAX_TEXT_LENGTH, normalizeWord, normalizeText, dictionaryKey, splitTranslationText, sanitizeSettings, shardKey, displayPhonetic, createDictionary };
  if (typeof module === 'object' && module.exports) module.exports = api;
  globalThis.WordLensCore = api;
})();
