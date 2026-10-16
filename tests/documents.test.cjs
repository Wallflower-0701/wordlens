'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { DOMParser } = require('@xmldom/xmldom');
const D = require('../extension/documents.js');
const { zip, presentationFiles, wordFiles, pdf } = require('./fixtures.cjs');
test('PPTX preserves relationship order, formatted runs, breaks and empty slides', async () => {
  const model = await D.openOffice(zip(presentationFiles), 'pptx', DOMParser);
  assert.equal(model.count, 3);
  assert.deepEqual(await model.page(0), ['Basic Notions', 'A sequence is a list of numbers arranged in a particular order.', 'English & 中文 <safe>\nNext line']);
  assert.match((await model.page(1))[0], /curiosity/);
  assert.deepEqual(await model.page(2), []);
});
test('DOCX keeps paragraphs, table text, entities and hyperlink text without executing markup', async () => {
  const model = await D.openOffice(zip(wordFiles, { store: true }), 'docx', DOMParser);
  assert.deepEqual(await model.page(0), ['Basic Notions', 'sequence', '数列 & text', '<script>alert(1)</script>\tend']);
});
test('Office external slide references and XML entities are rejected', async () => {
  const external = { ...presentationFiles, 'ppt/_rels/presentation.xml.rels': presentationFiles['ppt/_rels/presentation.xml.rels'].replace('Target="slides/slide2.xml"', 'TargetMode="External" Target="https://example.com/slide.xml"') };
  await assert.rejects(D.openOffice(zip(external), 'pptx', DOMParser), /引用无效/);
  await assert.rejects(D.openOffice(zip({ 'word/document.xml': '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///secret">]><a/>' }), 'docx', DOMParser), /XML 声明/);
});
test('Corrupt, encrypted, truncated and oversized ZIP data fail with an explanation', async () => {
  assert.equal(D.crc32(Buffer.from('123456789')), 0xcbf43926);
  const data = zip(wordFiles, { store: true }); data[30 + Buffer.byteLength('word/document.xml') + 15] ^= 1;
  await assert.rejects(D.openOffice(data, 'docx', DOMParser), /校验失败/);
  await assert.rejects(D.openOffice(zip(wordFiles, { encrypted: true }), 'docx', DOMParser), /加密/);
  await assert.rejects(D.openZip(zip(wordFiles).subarray(0, 50)), /不完整/);
  const bomb = zip(wordFiles); const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bomb.writeUInt32LE(1, central + 24);
  await assert.rejects(D.openOffice(bomb, 'docx', DOMParser), /过大|损坏/);
  const huge = zip(wordFiles); huge.writeUInt32LE(D.LIMITS.part + 1, huge.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
  await assert.rejects(D.openOffice(huge, 'docx', DOMParser), /过大/);
});
test('Plain text handles UTF-8, UTF-16 BOM, line endings and rejects binary or oversized files', async () => {
  const plain = D.openPlain(Buffer.from('Basic\r\n中文\n<script>')); assert.deepEqual(await plain.page(0), ['Basic', '中文', '<script>']);
  const utf16 = D.openPlain(Buffer.concat([Buffer.from([255, 254]), Buffer.from('hello 中文', 'utf16le')])); assert.deepEqual(await utf16.page(0), ['hello 中文']);
  assert.throws(() => D.openPlain(Buffer.from([1, 0, 2, 0])), /不像文本/);
  assert.throws(() => D.openPlain(new Uint8Array(D.LIMITS.file + 1)), /50 MB/);
});
test('Bundled PDF.js extracts a real PDF; image-only / empty pages remain empty', async () => {
  const pdfjs = await import('../extension/vendor/pdfjs/pdf.mjs');
  for (const empty of [false, true]) {
    const task = pdfjs.getDocument({ data: new Uint8Array(pdf(empty)), isEvalSupported: false, useWasm: false, disableFontFace: true, standardFontDataUrl: require('node:path').resolve(__dirname, '../extension/vendor/pdfjs/standard_fonts') + '/' });
    const document = await task.promise;
    const text = await (await document.getPage(1)).getTextContent();
    const lines = D.pdfLines(text.items);
    assert.deepEqual(lines, empty ? [] : ['Basic Notions', 'A sequence is a list of numbers arranged in a particular order.']);
    await task.destroy();
  }
});
