'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../extension/pdf-text.js'),D=require('../extension/documents.js'),core=require('../extension/core.js');
const {texLigaturePdf}=require('./fixtures.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib');
const dictionary=core.createDictionary(async prefix=>JSON.parse(zlib.gunzipSync(await fs.readFile(path.resolve(__dirname,'../extension/data',prefix+'.json.gz')))));

test('A real Type3 TeX PDF reaches the dictionary as find, while unknown-font bytes remain invalid',async()=>{
  const pdfjs=await import('../extension/vendor/pdfjs/pdf.mjs');
  for (const tex of [true,false]) {
    const task=pdfjs.getDocument({data:new Uint8Array(texLigaturePdf(tex)),fontExtraProperties:true,isEvalSupported:false,useWasm:false,
      standardFontDataUrl:path.resolve(__dirname,'../extension/vendor/pdfjs/standard_fonts')+'/'});
    try {
      const doc=await task.promise,page=await doc.getPage(1),info=(await doc.getMetadata()).info;
      const raw=D.pdfLines((await page.getTextContent()).items).join(' ');
      assert.equal(raw,'\u001cnd'); assert.equal(core.normalizeText(raw),null);
      const result=await P.pageText(page,pdfjs,info),selected=D.pdfLines(result.items).join(' ');
      if(tex){
        assert.equal(selected,'find'); assert.equal(result.repairedMappings,1);
        const input=core.normalizeText(selected); assert.equal(input.text,'find');
        const entry=await dictionary.lookup(input.text); assert.equal(entry.query,'find'); assert.match(entry.definitions.join(' '),/发现|找到/);
      } else { assert.equal(selected,raw); assert.equal(result.repairedMappings,0); assert.equal(core.normalizeText(selected),null); }
    } finally { await task.destroy(); }
  }
});

test('Conflicting glyph evidence and missing operators never turn a control byte into a guessed word',()=>{
  const info={Creator:'TeX',Producer:'pdfTeX'},OPS={setFont:1,showText:2};
  const good={type:'Type3',differences:new Map([[28,'a28'],[100,'a100'],[110,'a110']])};
  const glyph={unicode:'\u001c',originalCharCode:28,operatorListId:'a28'};
  const operators={fnArray:[1,2,1,2],argsArray:[['good'],[[glyph]],['unknown'],[[glyph]]]};
  const items=[{str:'\u001cnd and \u001clled'}];
  const repairs=P.repairsForPage(info,operators,name=>name==='good'?good:{type:'Type1'},OPS,items);
  assert.equal(repairs.size,0); assert.equal(P.normalizeItems(items,repairs)[0].str,items[0].str);
  assert.equal(P.repairsForPage(info,{fnArray:[1,2],argsArray:[['good'],[[glyph]]]},()=>good,OPS,items).size,0);
  assert.equal(P.normalizeItems([{str:'ﬁnd ﬂow oﬃce'}])[0].str,'find flow office');
});

test('An unreadable font keeps the page available without guessing its control characters',async()=>{
  const content={items:[{str:'\u001cnd'},{str:'ﬁlled'}]};
  const result=await P.pageText({getTextContent:async()=>content,getOperatorList:async()=>{throw Error('Bad font');}},{OPS:{}},{Creator:'TeX',Producer:'pdfTeX'});
  assert.equal(result.items[0].str,'\u001cnd');assert.equal(result.items[1].str,'filled');assert.equal(result.repairedMappings,0);
});
