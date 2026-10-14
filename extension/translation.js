/* A fixed-endpoint English-to-Chinese translation adapter. No page URLs are accepted. */
(() => {
  'use strict';
  const ENDPOINT = 'https://api.mymemory.translated.net/get';
  function decodeEntities(text) {
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    return text.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, token) => {
      if (token[0] !== '#') return named[token.toLowerCase()] || match;
      const code = token[1].toLowerCase() === 'x' ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
    });
  }
  function parseResponse(data) {
    if (data?.quotaFinished === true || Number(data?.responseStatus) === 429 || /USED ALL AVAILABLE FREE|NEXT AVAILABLE IN|DAILY LIMIT|QUOTA EXCEEDED/i.test(data?.responseData?.translatedText || '')) {
      throw new Error('免费翻译额度已用完，请稍后重试。离线单词和短语查询仍可使用。');
    }
    const translated = data?.responseData?.translatedText;
    if (Number(data?.responseStatus) !== 200 || typeof translated !== 'string' || !translated.trim()) throw new Error('翻译服务未返回有效结果，请稍后重试。');
    return decodeEntities(translated.trim());
  }
  function createTranslator(fetchImpl = fetch, timeoutMs = 20000) {
    const cache = new Map();
    const pending = new Map();
    const controllers = new Set();
    async function request(text) {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const output = [];
        for (const part of WordLensCore.splitTranslationText(text)) {
          const url = new URL(ENDPOINT);
          url.searchParams.set('q', part);
          url.searchParams.set('langpair', 'en|zh-CN');
          const response = await fetchImpl(url.href, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' });
          if (response.status === 429) throw new Error('免费翻译额度已用完，请稍后重试。离线单词和短语查询仍可使用。');
          if (!response.ok) throw new Error('翻译服务暂时不可用，请稍后重试。');
          output.push(parseResponse(await response.json()));
        }
        const translated = output.join('\n');
        if (!translated) throw new Error('翻译服务未返回有效结果，请稍后重试。');
        cache.set(text, translated);
        while (cache.size > 100) cache.delete(cache.keys().next().value);
        return translated;
      } catch (error) {
        if (controller.signal.aborted) throw new Error('翻译已取消或超时，请重试。');
        if (error instanceof TypeError) throw new Error('联网翻译失败，请检查网络后重试。离线单词和短语查询仍可使用。');
        throw error;
      } finally { clearTimeout(timeout); controllers.delete(controller); }
    }
    async function translate(value) {
      const input = WordLensCore.normalizeText(value);
      if (!input || input.kind === 'word') throw new Error('请输入英文短语或句子（最多 2000 个字符）。');
      const text = input.text;
      if (cache.has(text)) return cache.get(text);
      if (pending.has(text)) return pending.get(text);
      const operation = request(text);
      pending.set(text, operation);
      try { return await operation; }
      finally { if (pending.get(text) === operation) pending.delete(text); }
    }
    function clear() { cache.clear(); pending.clear(); controllers.forEach(controller => controller.abort()); }
    return { translate, clear };
  }
  const api = { ENDPOINT, parseResponse, decodeEntities, createTranslator };
  if (typeof module === 'object' && module.exports) module.exports = api;
  globalThis.WordLensTranslation = api;
})();
