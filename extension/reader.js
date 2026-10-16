const D = WordLensDocuments;
const input = document.getElementById('file');
const message = document.getElementById('message');
const content = document.getElementById('page-content');
const select = document.getElementById('page');
let model = null, current = 0, sequence = 0;
let pdfLibrary;

function status(text, error = false) { message.textContent = text; message.classList.toggle('error', error); }
function buttons(loading) {
  select.disabled = loading;
  document.getElementById('previous').disabled = loading || !model || current === 0;
  document.getElementById('next').disabled = loading || !model || current >= model.count - 1;
}
async function renderPage(index, ticket = ++sequence) {
  if (!model || index < 0 || index >= model.count) return;
  current = index; select.value = String(index);
  buttons(true); content.replaceChildren(); status('正在提取本页文字…');
  try {
    const lines = await model.page(index);
    if (ticket !== sequence) return;
    const fragment = document.createDocumentFragment();
    for (const line of lines) {
      const p = document.createElement('p'); p.textContent = line || '\u00a0'; fragment.append(p);
    }
    if (!lines.some(line => line.trim())) {
      const p = document.createElement('p'); p.className = 'empty';
      p.textContent = '本页没有可提取的文字，可能是图片或扫描页。请换一页；图片中的文字需要先做 OCR 识别。'; fragment.append(p);
    }
    content.replaceChildren(fragment); current = index; select.value = String(index);
    status('双击英文单词，或拖选短语、句子，即可查词。可在插件设置中切换 Alt + 选中。');
  } catch (error) { if (ticket === sequence) status(error.message || '本页读取失败，请尝试其他页面。', true); }
  finally { if (ticket === sequence) buttons(false); }
}
async function pdfDocument(bytes) {
  pdfLibrary ||= import('./vendor/pdfjs/pdf.mjs');
  const pdfjs = await pdfLibrary;
  // A direct local worker avoids the generic PDF.js blob wrapper for extension URLs.
  const port = new Worker(chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs'), { type: 'module' });
  const worker = new pdfjs.PDFWorker({ port });
  let rejectWorker;
  const workerFailure = new Promise((_, reject) => { rejectWorker = reject; });
  const onWorkerError = () => { worker.destroy(); port.terminate(); rejectWorker(new Error('PDF 组件启动失败，请重新加载插件后再试。')); };
  port.addEventListener('error', onWorkerError);
  const task = pdfjs.getDocument({ data: bytes, worker, isEvalSupported: false, useWasm: false, enableXfa: false,
    cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'), cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
    useWorkerFetch: false });
  let pdf, timer;
  async function destroy() {
    clearTimeout(timer); port.removeEventListener('error', onWorkerError);
    try { await task.destroy(); } finally { worker.destroy(); port.terminate(); }
  }
  try {
    timer = setTimeout(onWorkerError, 30000);
    pdf = await Promise.race([task.promise, workerFailure]); clearTimeout(timer);
    if (pdf.numPages > D.LIMITS.pages) throw new Error('PDF 超过 2000 页，请拆分后再打开。');
  } catch (error) {
    await destroy();
    if (error.name === 'PasswordException') throw new Error('PDF 有密码保护，请先另存为未加密副本。');
    throw new Error(error.name === 'InvalidPDFException' ? 'PDF 文件不完整或已损坏。' : (error.message || 'PDF 读取失败。'));
  }
  return { count: pdf.numPages, unit: '页', destroy,
    async page(index) {
      const page = await pdf.getPage(index + 1);
      try { const text = await page.getTextContent(); return D.pdfLines(text.items); }
      finally { page.cleanup(); }
    }
  };
}
async function showDocument(next, name, ticket) {
  if (ticket !== sequence) { await next.destroy(); return; }
  model = next; current = 0;
  document.getElementById('welcome').hidden = true;
  document.getElementById('document').hidden = false;
  document.getElementById('file-name').textContent = name;
  select.replaceChildren();
  for (let i = 0; i < next.count; i++) {
    const option = document.createElement('option'); option.value = String(i); option.textContent = String(i + 1); select.append(option);
  }
  document.getElementById('page-count').textContent = `/ ${next.count} ${next.unit}`;
  await renderPage(0, ticket);
}
async function openFile(file) {
  if (!file) return;
  const ticket = ++sequence;
  const old = model; model = null; buttons(true);
  document.getElementById('document').hidden = true; content.replaceChildren();
  status('正在本机打开文件…');
  try {
    await old?.destroy();
    if (file.size > D.LIMITS.file) throw new Error('文件超过 50 MB，请拆分后再打开。');
    const ext = file.name.split('.').pop().toLowerCase();
    if (['ppt', 'doc', 'xls', 'xlsx', 'odp', 'odt'].includes(ext)) throw new Error('暂不直接支持此格式。PPT / Word 请另存为 PPTX / DOCX；表格请导出为 CSV，或将文档导出为含文字的 PDF。');
    if (!['pptx', 'docx', 'pdf', 'txt', 'md', 'csv', 'tsv', 'log', 'json', 'xml', 'tex'].includes(ext)) throw new Error('请选择 PPTX、DOCX、PDF 或 UTF-8 文本文件。');
    const bytes = new Uint8Array(await file.arrayBuffer()); D.checkSize(bytes);
    if (ticket !== sequence) return;
    const next = ['pptx', 'docx'].includes(ext) ? await D.openOffice(bytes, ext) : ext === 'pdf' ? await pdfDocument(bytes) : D.openPlain(bytes);
    await showDocument(next, file.name, ticket);
  } catch (error) {
    if (ticket !== sequence) return;
    status(error.message || '文件读取失败，请重新保存文件后再试。', true);
    document.getElementById('welcome').hidden = false; buttons(false);
  }
}
document.getElementById('open-file').addEventListener('click', () => input.click());
input.addEventListener('change', () => { const file = input.files[0]; input.value = ''; openFile(file); });
select.addEventListener('change', () => renderPage(Number(select.value)));
document.getElementById('previous').addEventListener('click', () => renderPage(current - 1));
document.getElementById('next').addEventListener('click', () => renderPage(current + 1));
document.getElementById('open-example').addEventListener('click', async () => {
  const button = document.getElementById('open-example'); button.disabled = true;
  try {
    const response = await fetch(chrome.runtime.getURL('examples/reading.pdf'));
    if (!response.ok) throw new Error('示例文件读取失败，请重新加载插件。');
    await openFile(new File([await response.arrayBuffer()], 'WordLens 示例课件.pdf'));
  } catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
});
