// content.js - 注入到B站视频页面
chrome.storage.sync.get(['recordsGroupMap', 'recentlyViewedCount'], (data) => {
    const currentBV = window.location.pathname.split('/')[2];
    if (!currentBV) return;

    const recordsGroupMapType = isSpecialCollection(currentBV) ? "recordsGroupListSpecial" : "recordsGroupListNormal";

    // 1. 找到匹配的卡片
    const matchedGroup = (data.recordsGroupMap[recordsGroupMapType] || []).find(
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
            chrome.storage.sync.get(['recordsGroupMap', 'recentlyViewedCount'], (data) => {
                console.log(data);
                if (!data.recentlyViewedCount) {
                    // 获取不到让插件崩溃
                    alert('无法获取最近观看记录数量，请在设置界面保存设置，或联系开发者');
                    throw new Error('无法获取最近观看记录数量');
                }
                const recentlyViewedCount = data.recentlyViewedCount;
                const updatedGroups = data.recordsGroupMap[recordsGroupMapType].map(group => {
                    if (group.BVCode === currentBV) {
                        const newRecords = [record, ...group.records].slice(0, recentlyViewedCount);
                        return { ...group, records: newRecords };
                    }
                    return group;
                });

                chrome.storage.sync.set({
                    recordsGroupMap: {
                        ...data.recordsGroupMap,
                        [recordsGroupMapType]: updatedGroups
                    }
                });
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

// 拷贝popup.js中的isSpecialCollection函数
async function isSpecialCollection(BVCode) {
    const url1 = `https://www.bilibili.com/video/${BVCode}?p=1`;
    const url2 = `https://www.bilibili.com/video/${BVCode}?p=2`;

    // 使用Promise.all并行请求提高效率
    return Promise.all([
        fetch(url1).then(res => res.ok ? res.text() : Promise.reject('p1请求失败')),
        fetch(url2).then(res => res.ok ? res.text() : Promise.reject('p2请求失败'))
    ])
        .then(([html1, html2]) => {
            // 使用DOMParser确保更可靠的标题解析
            const getTitle = html => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                return doc.querySelector('h1').textContent.trim();
            };

            return getTitle(html1) === getTitle(html2);
        })
        .catch(error => {
            console.error('检测失败:', error);
            return false; // 失败时默认按普通视频处理
        });
}