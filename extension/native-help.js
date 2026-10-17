document.getElementById('extension-id').textContent = chrome.runtime.id;
document.getElementById('copy-id').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(chrome.runtime.id); document.getElementById('notice').textContent = '已复制扩展 ID，请粘贴到辅助程序安装窗口。'; }
  catch { document.getElementById('notice').textContent = '复制失败，请手动选中上方 ID 复制。'; }
});
async function check(reconnect = false) {
  const label = document.getElementById('connection');
  try {
    const result = await chrome.runtime.sendMessage({ type: reconnect ? 'native-reconnect' : 'native-status' });
    label.textContent = result.message;
    if (result.status === 'connecting') setTimeout(() => check(false), 700);
  } catch { label.textContent = '无法连接插件，请重新加载 WordLens 后再试。'; }
}
document.getElementById('reconnect').addEventListener('click', () => check(true)); check();
