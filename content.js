// content.js - 注入到B站视频页面
chrome.storage.sync.get(['recordsGroupList', 'recentlyViewedCount '], (data) => {
  const currentBV = window.location.pathname.split('/')[2];
  if (!currentBV) return;

  // 1. 找到匹配的记录组
  const matchedGroup = (data.recordsGroupList || []).find(
    g => g.BVCode === currentBV
  );

  if (matchedGroup) {
    // 2. 监听播放行为
    const video = document.querySelector('video');
    if (!video) return;

    const isContextValid = () => !!chrome.runtime?.id;

    // 2.1 获取视频名称
    const video_pod__body = document.querySelectorAll('.video-pod__body .active');
    let activeItem = Array.from(video_pod__body).filter(
      el => !el.classList.contains('head')
    );
    activeItem = activeItem.length > 0 ? activeItem[0] : null;
    const videoName = activeItem ? activeItem.textContent.trim() : '未知视频';

    // 2.2 获取url
    const videoUrl = window.location.href;

    // 记录播放进度（节流处理）
    let lastRecordedTime = 0;
    video.addEventListener('timeupdate', throttle(() => {
      if (!isContextValid()) return;

      const progress = Math.floor((video.currentTime / video.duration) * 100);

      // 3. 生成观看记录
      const record = {
        name: videoName,
        url: videoUrl,
        timestamp: new Date().toISOString(),
        progress,
        duration: video.duration
      };

      // 4. 更新存储（保留最近recentlyViewedCount 条）
      chrome.storage.sync.get(['recordsGroupList', 'recentlyViewedCount'], (data) => {
        console.log(data);
        if (!data.recentlyViewedCount) {
          // 获取不到让插件崩溃
          alert('无法获取最近观看记录数量，请在设置界面保存设置，或联系开发者');
          throw new Error('无法获取最近观看记录数量');
        }
        const recentlyViewedCount  = data.recentlyViewedCount;
        const updatedGroups = data.recordsGroupList.map(group => {
          if (group.BVCode === currentBV) {
            const newRecords = [record, ...group.records].slice(0, recentlyViewedCount);
            return { ...group, records: newRecords };
          }
          return group;
        });

        chrome.storage.sync.set({ recordsGroupList: updatedGroups });
      });
    }, 30000)); // 30秒节流
  }
});

// 节流函数
function throttle(fn, delay) {
  let lastCall = 0;
  return (...args) => {
    const now = new Date().getTime();
    if (now - lastCall < delay) return;
    lastCall = now;
    return fn(...args);
  };
}
