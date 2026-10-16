/* Local-only text extraction. Document content is never interpreted as HTML. */
(function (root) {
  'use strict';
  const LIMITS = Object.freeze({ file: 50 * 1024 * 1024, part: 10 * 1024 * 1024, text: 2000000, entries: 10000, pages: 2000 });
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function bytesOf(value) { return value instanceof Uint8Array ? value : new Uint8Array(value); }
  function checkSize(bytes) {
    if (!bytes.length) throw new Error('文件是空的，请选择其他文件。');
    if (bytes.length > LIMITS.file) throw new Error('文件超过 50 MB，请拆分后再打开。');
  }
  function boundedText(text) {
    if (text.length > LIMITS.text) throw new Error('文字过多，请拆分文档后再打开。');
    return text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n');
  }
  async function openZip(value) {
    const bytes = bytesOf(value); checkSize(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = p => view.getUint16(p, true), u32 = p => view.getUint32(p, true);
    let end = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
      if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) { end = p; break; }
    }
    if (end < 0) throw new Error('文档压缩结构不完整，请重新保存或下载文件。');
    const count = u16(end + 10), start = u32(end + 16), size = u32(end + 12);
    if (u16(end + 4) || u16(end + 6) || count !== u16(end + 8) || count > LIMITS.entries || count === 65535 || start + size !== end) throw new Error('不支持这个文档的压缩格式，请重新另存为 PPTX / DOCX。');
    const entries = new Map(); let pos = start;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let i = 0; i < count; i++) {
      if (pos + 46 > end || u32(pos) !== 0x02014b50) throw new Error('文档目录已损坏。');
      const length = u16(pos + 28), extra = u16(pos + 30), comment = u16(pos + 32);
      const next = pos + 46 + length + extra + comment;
      if (next > end || u16(pos + 34)) throw new Error('文档目录已损坏。');
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + length));
      if (entries.has(name)) throw new Error('文档包含重复条目，请重新保存。');
      entries.set(name, { flags: u16(pos + 8), method: u16(pos + 10), crc: u32(pos + 16), compressed: u32(pos + 20), size: u32(pos + 24), offset: u32(pos + 42) });
      pos = next;
    }
    if (pos !== end) throw new Error('文档目录已损坏。');
    return {
      async read(name) {
        const e = entries.get(name);
        if (!e) throw new Error('文档缺少必要内容，请重新保存为 PPTX / DOCX。');
        if (e.flags & 1) throw new Error('暂不支持加密的 Office 文件，请先另存为未加密副本。');
        if (e.size > LIMITS.part || ![0, 8].includes(e.method)) throw new Error('文档内容过大或压缩方式不受支持，请拆分或重新保存。');
        const p = e.offset;
        if (p + 30 > start || u32(p) !== 0x04034b50 || u16(p + 8) !== e.method || (u16(p + 6) & 1)) throw new Error('文档数据已损坏。');
        const begin = p + 30 + u16(p + 26) + u16(p + 28);
        if (begin + e.compressed > start) throw new Error('文档数据不完整。');
        if (decoder.decode(bytes.subarray(p + 30, p + 30 + u16(p + 26))) !== name) throw new Error('文档数据已损坏。');
        const input = bytes.subarray(begin, begin + e.compressed);
        let output = input;
        if (e.method === 8) {
          let transform;
          try { transform = new DecompressionStream('deflate-raw'); }
          catch { throw new Error('浏览器版本较旧，请更新 Edge / Chrome 后再打开 Office 文档。'); }
          const reader = new Blob([input]).stream().pipeThrough(transform).getReader();
          const chunks = []; let length = 0;
          try {
            while (true) {
              const item = await reader.read(); if (item.done) break;
              length += item.value.length;
              if (length > e.size || length > LIMITS.part) throw new Error('文档解压后过大或数据已损坏。');
              chunks.push(item.value);
            }
          } catch (error) {
            await reader.cancel().catch(() => {});
            throw new Error(/文档/.test(error.message) ? error.message : '文档解压失败，文件可能已损坏，请重新保存或下载。');
          }
          output = new Uint8Array(length); let at = 0;
          for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
        }
        if (output.length !== e.size || crc32(output) !== e.crc) throw new Error('文档校验失败，请重新保存或下载文件。');
        return decoder.decode(output);
      }
    };
  }
  function xml(source, Parser = root.DOMParser) {
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('文档包含不支持的 XML 声明。');
    const doc = new Parser().parseFromString(source, 'application/xml');
    if (!doc.documentElement || doc.getElementsByTagName('parsererror').length) throw new Error('文档文字结构已损坏。');
    return doc;
  }
  function descendants(node, ns, name) { return Array.from(node.getElementsByTagNameNS(ns, name)); }
  function runText(node, ns) {
    let text = '';
    function walk(parent) {
      for (const child of Array.from(parent.childNodes)) {
        if (child.nodeType !== 1) continue;
        if (child.namespaceURI === ns && child.localName === 't') text += child.textContent;
        else if (child.namespaceURI === ns && ['br', 'cr'].includes(child.localName)) text += '\n';
        else if (child.namespaceURI === ns && child.localName === 'tab') text += '\t';
        else if (child.namespaceURI === W && child.localName === 'del') continue;
        else walk(child);
      }
    }
    walk(node); return boundedText(text).trim();
  }
  function paragraphs(doc, ns) {
    const lines = descendants(doc, ns, 'p').map(p => runText(p, ns)).filter(Boolean);
    boundedText(lines.join('\n')); return lines;
  }
  function relationshipPath(target) {
    if (!target || /[\\?#:]/.test(target)) throw new Error('幻灯片引用格式不受支持。');
    const parts = target.startsWith('/') ? [] : ['ppt'];
    for (const part of target.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) throw new Error('幻灯片路径无效。'); parts.pop(); }
      else parts.push(part);
    }
    const path = parts.join('/');
    if (!path.startsWith('ppt/slides/') || !path.endsWith('.xml')) throw new Error('幻灯片路径无效。');
    return path;
  }
  async function openOffice(value, extension, Parser) {
    const archive = await openZip(value);
    if (extension === 'docx') {
      const doc = xml(await archive.read('word/document.xml'), Parser);
      const lines = paragraphs(doc, W);
      return { count: 1, unit: '文档', page: async () => lines, destroy() {} };
    }
    const presentation = xml(await archive.read('ppt/presentation.xml'), Parser);
    const rels = xml(await archive.read('ppt/_rels/presentation.xml.rels'), Parser);
    const targets = new Map(descendants(rels, REL, 'Relationship').map(rel => [rel.getAttribute('Id'), rel]));
    const ids = descendants(presentation, P, 'sldId');
    if (!ids.length || ids.length > LIMITS.pages) throw new Error('幻灯片为空或超过 2000 页，请拆分后再打开。');
    const paths = ids.map(id => {
      const rel = targets.get(id.getAttributeNS(R, 'id'));
      if (!rel || rel.getAttribute('TargetMode') === 'External' || !rel.getAttribute('Type').endsWith('/slide')) throw new Error('幻灯片引用无效。');
      return relationshipPath(rel.getAttribute('Target'));
    });
    return { count: paths.length, unit: '幻灯片', page: async index => paragraphs(xml(await archive.read(paths[index]), Parser), A), destroy() {} };
  }
  function openPlain(value) {
    const bytes = bytesOf(value); checkSize(bytes);
    let encoding = 'utf-8';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    if (encoding === 'utf-8' && bytes.subarray(0, 4096).includes(0)) throw new Error('这个文件不像文本文件，请选择 PPTX、DOCX、PDF 或 UTF-8 文本。');
    let text;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { throw new Error('文本编码无法识别，请将文件另存为 UTF-8 或带 BOM 的 UTF-16。'); }
    const lines = boundedText(text).split('\n');
    return { count: 1, unit: '文档', page: async () => lines, destroy() {} };
  }
  function pdfLines(items) {
    const lines = []; let line = '', previous = null;
    for (const item of items) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5], x = item.transform?.[4];
      if (previous && Number.isFinite(y) && Math.abs(y - previous.y) > Math.max(2, Math.abs(item.height || 10) * 0.45)) { if (line.trim()) lines.push(line.trim()); line = ''; previous = null; }
      if (line && previous && !/\s$/.test(line) && !/^\s/.test(item.str) && Number.isFinite(x) && x - previous.end > Math.max(0.5, Math.abs(item.height || 10) * 0.12)) line += ' ';
      line += item.str;
      previous = { y, end: x + (item.width || 0) };
      if (item.hasEOL) { if (line.trim()) lines.push(line.trim()); line = ''; previous = null; }
    }
    if (line.trim()) lines.push(line.trim());
    boundedText(lines.join('\n')); return lines;
  }
  const api = { LIMITS, checkSize, crc32, openZip, openOffice, openPlain, pdfLines };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WordLensDocuments = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
