(function (root) {
  'use strict';
  const T1 = new Map([[21, '–'], [27, 'ff'], [28, 'fi'], [29, 'fl'], [30, 'ffi'], [31, 'ffl']]);
  const LIGATURES = Object.freeze({ 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' });
  function isTex(info) {
    return /^TeX$/i.test(info?.Creator || '') && /pdfTeX/i.test(info?.Producer || '');
  }
  function numericTexFont(font, code) {
    if (font?.type !== 'Type3' || !(font.differences instanceof Map) || font.differences.get(code) !== `a${code}`) return false;
    let letters = 0;
    for (const [key, name] of font.differences) {
      if (name === '.notdef') continue;
      if (name !== `a${key}`) return false;
      if (key >= 65 && key <= 122) letters++;
    }
    return letters >= 2;
  }
  function repairsForPage(info, operators, fontForName, OPS, items) {
    const repairs = new Map();
    if (!isTex(info)) return repairs;
    const evidence = new Map(), stack = []; let fontName = null;
    for (let i = 0; i < operators.fnArray.length; i++) {
      const op = operators.fnArray[i], args = operators.argsArray[i];
      if (op === OPS.save) stack.push(fontName);
      else if (op === OPS.restore) fontName = stack.pop() ?? null;
      else if (op === OPS.setFont) fontName = args[0];
      else if (op === OPS.showText) {
        for (const glyph of args[0]) {
          if (!glyph || typeof glyph !== 'object' || glyph.unicode?.length !== 1) continue;
          const code = glyph.unicode.charCodeAt(0);
          if (!T1.has(code)) continue;
          const found = evidence.get(code) || { valid: true, count: 0 }; found.count++;
          let font; try { font = fontForName(fontName); } catch {}
          found.valid &&= glyph.originalCharCode === code && glyph.operatorListId === `a${code}` && numericTexFont(font, code);
          evidence.set(code, found);
        }
      }
    }
    for (const [code, found] of evidence) {
      const character = String.fromCharCode(code);
      const count = items.reduce((sum, item) => sum + (typeof item.str === 'string' ? item.str.split(character).length - 1 : 0), 0);
      // TextContent may coalesce fonts. Require every occurrence to be accounted
      // for by the drawing operators; never guess from a control byte alone.
      if (found.valid && count === found.count) repairs.set(character, T1.get(code));
    }
    return repairs;
  }
  function normalizeItems(items, repairs = new Map()) {
    return items.map(item => {
      if (typeof item.str !== 'string') return item;
      const str = item.str.replace(/[ﬀ-ﬆ]/g, character => LIGATURES[character] || character)
        .replace(/[\u0015\u001b-\u001f]/g, character => repairs.get(character) ?? character);
      return str === item.str ? item : { ...item, str };
    });
  }
  async function pageText(page, pdfjs, info) {
    const content = await page.getTextContent(); let repairs = new Map();
    if (isTex(info)) {
      try {
        const operators = await page.getOperatorList();
        repairs = repairsForPage(info, operators, name => page.commonObjs.get(name), pdfjs.OPS, content.items);
      } catch {} // An undecodable font must not discard the rest of the page.
    }
    return { ...content, items: normalizeItems(content.items, repairs), repairedMappings: repairs.size };
  }
  const api = { isTex, repairsForPage, normalizeItems, pageText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WordLensPdfText = api;
})(globalThis);
