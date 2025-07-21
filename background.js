// 持久化后台任务
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.set({ theme: 'light' });
});

// 监听浏览器事件
chrome.action.onClicked.addListener((tab) => {
    console.log('扩展按钮被点击', tab);
});


