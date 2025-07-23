// content.js - 注入到B站视频页面

// 添加全局变量管理定时器
let progressInterval = null;

async function main() {
    // 清理之前的定时器
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }

    const currentBV = window.location.pathname.split('/')[2];
    if (!currentBV) return;

    const isSpecial = await isSpecialCollection(currentBV);
    const recordsGroupMapType = isSpecial ? "recordsGroupListSpecial" : "recordsGroupListNormal";

    chrome.storage.sync.get(['recordsGroupMap', 'recentlyViewedCount'], (data) => {
        const { recordsGroupMap, recentlyViewedCount } = data;

        // 1. 找到匹配的卡片
        let matchedGroup;
        if (recordsGroupMapType === "recordsGroupListSpecial") {
            // 查询BVCord
            matchedGroup = data.recordsGroupMap[recordsGroupMapType].find(group => group.BVCode === currentBV);
            if (!matchedGroup) {
                // 如果没有找到，可能是特殊合集但未记录
                console.log(`未找到匹配的记录组: ${currentBV}`);
                return;
            }
        } else if (recordsGroupMapType === "recordsGroupListNormal") {
            // 查询sid
            const collectionElement = document.querySelector('.video-pod__header .header-top .left a');
            if (!collectionElement) {
                return;
            }
            const sidMatch = collectionElement.href.match(/sid=(\d+)/);
            if (!sidMatch) {
                return;
            }
            const currentSID = sidMatch[1];
            matchedGroup = data.recordsGroupMap[recordsGroupMapType].find(group => group.sid === currentSID);
            if (!matchedGroup) {
                // 如果没有找到，可能是普通合集但未记录
                console.log(`未找到匹配的记录组: ${currentBV}`);
                return;
            }
        }

        if (matchedGroup) {
            // 2. 监听播放行为
            const isContextValid = () => !!chrome.runtime?.id;
            progressInterval = setInterval(() => {

                const video = document.querySelector('video');
                if (!video) return;

                // 2.1 获取视频名称
                const video_pod__body = document.querySelectorAll('.video-pod__body .active');
                let activeItem = Array.from(video_pod__body).filter(
                    el => !el.classList.contains('head')
                );
                activeItem = activeItem.length > 0 ? activeItem[0] : null;
                const videoName = activeItem ? activeItem.textContent.trim() : '未知视频';

                // 2.2 编辑url，删除无关查询参数
                const currentUrl = formatUrl(window.location.href, recordsGroupMapType);

                const progress = Math.floor((video.currentTime / video.duration) * 100);

                // 若视频剩余时间不足30秒，则删除getProgressInterval
                if (video.duration - video.currentTime < 30) {
                    clearInterval(progressInterval);
                    console.log('视频剩余时间不足30秒，停止记录进度');
                }

                // 3. 生成观看记录
                const newRecord = {
                    name: videoName,
                    url: currentUrl,
                    timestamp: new Date().toISOString(),
                    progress,
                    duration: video.duration
                };

                // 4. 更新存储（保留最近recentlyViewedCount 条）
                if (!recentlyViewedCount) {
                    // 获取不到让插件崩溃
                    alert('无法获取设置中"最近观看记录数量"，请在设置界面保存设置，或联系开发者');
                    throw new Error('无法获取最近观看记录数量');
                }
                const updatedGroups = recordsGroupMap[recordsGroupMapType].map(group => {
                    const identifier = isSpecial ? currentBV : matchedGroup.sid;
                    if ((isSpecial && group.BVCode === identifier) ||
                        (!isSpecial && group.sid === identifier)) {
                        if (isSpecial) {
                            if (group.BVCode === currentBV) {
                                const existingRecords = group.records;
                                const lastRecordIndex = existingRecords.findIndex(r => r.url === newRecord.url);

                                let newRecords;
                                if (lastRecordIndex !== -1) {
                                    // 同一视频：覆盖最近一次记录
                                    newRecords = [...existingRecords];
                                    newRecords[lastRecordIndex] = newRecord;
                                } else {
                                    // 新视频：添加到开头并截断
                                    newRecords = [newRecord, ...existingRecords].slice(0, recentlyViewedCount);
                                }

                                return { ...group, records: newRecords };
                            }
                        } else {
                            if (group.sid === matchedGroup.sid) {
                                const existingRecords = group.records;
                                const lastRecordIndex = existingRecords.findIndex(r => r.url === newRecord.url);

                                let newRecords;
                                if (lastRecordIndex !== -1) {
                                    // 同一视频：覆盖最近一次记录
                                    newRecords = [...existingRecords];
                                    newRecords[lastRecordIndex] = newRecord;
                                } else {
                                    // 新视频：添加到开头并截断
                                    newRecords = [newRecord, ...existingRecords].slice(0, recentlyViewedCount);
                                }

                                return { ...group, records: newRecords };
                            }
                        }
                    }
                    return group;
                });

                chrome.storage.sync.set({
                    recordsGroupMap: {
                        ...data.recordsGroupMap,
                        [recordsGroupMapType]: updatedGroups
                    }
                });
                console.log(`已更新${recordsGroupMapType}记录组`);
            }, 30000);
        }
    });
}

// 检查是否已执行
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    main();
    handleData();
} else {
    document.addEventListener('DOMContentLoaded', main); // 添加监听
    document.addEventListener('DOMContentLoaded', handleData); // 添加监听
}
// 添加SPA路由变化监听
let lastPath = window.location.pathname;
const observer = new MutationObserver(() => {
    if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        main(); // 路径变化时重新执行
    }
});
observer.observe(document.body, { childList: true, subtree: true });

// 拷贝popup.js中的isSpecialCollection函数
async function isSpecialCollection(BVCode) {
    const url = `https://www.bilibili.com/video/${BVCode}`;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error('视频请求失败');
        }
        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const video_pod__items = doc.querySelectorAll('.video-pod__item');
        let video_pod__item = null;
        if (!video_pod__items) {
            // 单视频页面，不是特殊合集
            return false;
        }
        // 匹配BV号
        for (const item of video_pod__items) {
            if (item.getAttribute('data-key') === BVCode) {
                video_pod__item = item;
                break;
            }
        }
        if (!video_pod__item) {
            // 查询不到匹配的BV号
            return false;
        }
        if (video_pod__item.querySelector('.page-list')) {
            // 有多P页面，可能是特殊合集
            return true;
        } else {
            // 普通合集
            return false;
        }
    } catch (error) {
        console.error('检测失败:', error);
        return false;
    }
}

function handleData() {
    // 确保脚本在页面加载后执行
    const video = document.querySelector('video');
    if (video) {
        console.log('视频页面脚本已注入');
    } else {
        console.warn('未检测到视频元素，脚本可能未正确注入');
    }
    chrome.storage.sync.get(['lastClickedLink'], (data) => {
        if (data.lastClickedLink) {
            console.log('最后点击的链接:', data.lastClickedLink);
            // 判断是否为lastClickedLink.url的页面
            if (window.location.href === data.lastClickedLink.url) {
                // 如果是，设置视频进度
                const video = document.querySelector('video');
                if (video && data.lastClickedLink.progress) {
                    video.currentTime = (data.lastClickedLink.progress / 100) * video.duration - 5; // 减5秒，避免跳转到最后
                    console.log(`视频进度已设置为: ${data.lastClickedLink.progress}%`);
                }
            }
        }
    });
}

function formatUrl(url, type) {
    const urlFormat = new URL(url);
    urlFormat.search = '';

    if (type === "recordsGroupMapTypeSpecial") {
        const urlParams = new URLSearchParams(url);
        const p = urlParams.get('p');
        if (p) urlFormat.searchParams.set('p', p);
    }

    return urlFormat.toString();
}
