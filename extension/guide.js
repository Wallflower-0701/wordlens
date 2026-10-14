'use strict';
chrome.storage.local.get('settings').then(({ settings }) => {
  if (settings?.enabled === false) document.getElementById('demo-status').textContent = '请先在面板开启划词';
  else if (settings?.trigger === 'alt') document.getElementById('demo-status').textContent = '当前需按住 Alt 选中';
});
