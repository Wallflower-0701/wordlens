'use strict';
const zlib = require('node:zlib');
const { crc32 } = require('../extension/documents.js');
function zip(files, options = {}) {
  const body = [], directory = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(text), packed = options.store ? data : zlib.deflateRawSync(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(options.encrypted ? 1 : 0, 6); header.writeUInt16LE(options.store ? 0 : 8, 8);
    header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    header.copy(central, 8, 6, 26); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    body.push(header, filename, packed); directory.push(central, filename); offset += header.length + filename.length + packed.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length / 2, 8); end.writeUInt16LE(directory.length / 2, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, dir, end]);
}
const presentationFiles = {
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst></p:presentation>',
  'ppt/_rels/presentation.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/></Relationships>',
  'ppt/slides/slide1.xml': '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><a:p><a:r><a:t>A little curiosity can turn an ordinary day into a beautiful adventure.</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>',
  'ppt/slides/slide2.xml': '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><a:p><a:r><a:t>Basic </a:t></a:r><a:r><a:t>Notions</a:t></a:r></a:p><a:p><a:r><a:t>A sequence is a list of numbers arranged in a particular order.</a:t></a:r></a:p><a:p><a:r><a:t>English &amp; 中文 &lt;safe&gt;</a:t></a:r><a:br/><a:r><a:t>Next line</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>',
  'ppt/slides/slide3.xml': '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld/></p:sld>'
};
const wordFiles = { 'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Basic </w:t></w:r><w:hyperlink><w:r><w:t>Notions</w:t></w:r></w:hyperlink><w:del><w:r><w:t>deleted</w:t></w:r></w:del></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>sequence</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数列 &amp; text</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t><w:tab/><w:t>end</w:t></w:r></w:p></w:body></w:document>' };
function pdf(empty = false) {
  const text = empty ? '' : 'BT /F1 24 Tf 50 740 Td (Basic Notions) Tj 0 -40 Td /F1 14 Tf (A sequence is a list of numbers arranged in a particular order.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
  ];
  let output = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(output); output += 'xref\n0 6\n0000000000 65535 f \n';
  offsets.slice(1).forEach(offset => { output += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  output += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output);
}
function texLigaturePdf(tex = true) {
  const stream = value => `<< /Length ${Buffer.byteLength(value)} >>\nstream\n${value}\nendstream`;
  const widths=Array.from({length:83},(_,i)=>[28,100,110].includes(i+28)?600:0).join(' ');
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /FirstChar 28 /LastChar 110 /Widths [${widths}] /Encoding << /Type /Encoding /Differences [28 /a28 100 /a100 110 /a110] >> /CharProcs << /a28 6 0 R /a100 7 0 R /a110 8 0 R >> /Resources << /Font << /H 9 0 R >> >> >>`,
    stream('BT /F1 18 Tf 50 740 Td <1C6E64> Tj ET'),
    stream('600 0 d0 BT /H 1000 Tf (fi) Tj ET'),
    stream('600 0 d0 BT /H 1000 Tf (d) Tj ET'),
    stream('600 0 d0 BT /H 1000 Tf (n) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Creator (${tex?'TeX':'Other'}) /Producer (${tex?'pdfTeX fixture':'Unknown'}) >>`
  ];
  let output='%PDF-1.4\n'; const offsets=[0];
  objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const start=Buffer.byteLength(output); output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset=>{output+=`${String(offset).padStart(10,'0')} 00000 n \n`;});
  return Buffer.from(output+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R /Info 10 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
module.exports = { zip, presentationFiles, wordFiles, pdf, texLigaturePdf };
