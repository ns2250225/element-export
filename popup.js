document.getElementById('startBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    // 拦截浏览器系统页面
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      alert('插件无法在浏览器系统页面运行，请打开一个普通的网页（如 baidu.com）重试。');
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: "start_selection" }, (response) => {
      // 捕获未注入脚本的错误
      if (chrome.runtime.lastError) {
        alert('插件刚安装或刚更新，请先刷新当前网页（按 F5）再使用！');
      } else {
        window.close(); // 点击后正常关闭弹窗
      }
    });
  }
});