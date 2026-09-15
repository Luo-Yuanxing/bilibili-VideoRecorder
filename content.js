// content.js - 注入到B站视频页面

// 添加全局变量管理定时器
let progressInterval = null;
let routeGeneration = 0;
let restoreGeneration = 0;

function stopTracking() {
    if (progressInterval !== null) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

async function main() {

    // log
    console.log('main函数已执行，开始处理B站视频页面');

    // 清理之前的定时器
    stopTracking();
    const currentGeneration = ++routeGeneration;

    const currentBV = window.location.pathname.split('/')[2];
    if (!currentBV) return;

    const isSpecial = await isSpecialCollection(currentBV);
    if (currentGeneration !== routeGeneration) return;
    const seasonType = isSpecial ? 'seasons_archives' : 'seasons_series';

    loadSeasonsMap().then(async storedSeasonsMap => {
        const settings = await storageGet(chrome.storage.sync, ['recentlyViewedCount']);
        return ({
            seasonsMap: storedSeasonsMap,
            recentlyViewedCount: settings.recentlyViewedCount
        });
    }).then((data) => {
        if (currentGeneration !== routeGeneration) return;
        const seasonsMap = normalizeSeasonsMap(data.seasonsMap);
        const recentlyViewedCount = normalizeRecentlyViewedCount(data.recentlyViewedCount);

        // 1. 找到匹配的卡片
        let matchedGroup;
        if (seasonType === 'seasons_archives') {
            // 查询BVCord
            matchedGroup = seasonsMap[seasonType].find(season => season && season.BVCode === currentBV);
            if (!matchedGroup) {
                // 如果没有找到，可能是特殊合集但未记录
                console.log(`未找到匹配的 season: ${currentBV}`);
                return;
            }
        } else if (seasonType === 'seasons_series') {
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
            matchedGroup = seasonsMap[seasonType].find(season => season && season.sid === currentSID);
            if (!matchedGroup) {
                // 如果没有找到，可能是普通合集但未记录
                console.log(`未找到匹配的 season: ${currentBV}`);
                return;
            }
        }

        if (matchedGroup) {
            // 2. 监听播放行为
            const recordProgress = () => {
                if (currentGeneration !== routeGeneration) {
                    stopTracking();
                    return;
                }

                const video = document.querySelector('video');
                if (!video) return;

                const duration = Number(video.duration);
                if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(video.currentTime)) return;

                // 2.1 获取视频名称
                const video_pod__body = document.querySelectorAll('.video-pod__body .active');
                let activeItem = Array.from(video_pod__body).filter(
                    el => !el.classList.contains('head')
                );
                activeItem = activeItem.length > 0 ? activeItem[0] : null;
                const videoName = activeItem ? activeItem.textContent.trim() : '未知视频';

                // 2.2 编辑url，删除无关查询参数
                const currentUrl = formatUrl(window.location.href, seasonType);

                const progress = Math.max(0, Math.min(100, Math.floor((video.currentTime / duration) * 100)));

                // 若视频剩余时间不足30秒，则删除getProgressInterval
                if (video.duration - video.currentTime < 30) {
                    stopTracking();
                    console.log('视频剩余时间不足30秒，停止记录进度');
                }

                // 3. 生成观看记录
                const newRecord = {
                    name: videoName,
                    url: currentUrl,
                    timestamp: new Date().toISOString(),
                    progress,
                    duration
                };

                // 4. 更新存储（保留最近recentlyViewedCount 条）
                enqueueSeasonsMapUpdate(latestMap => {
                    const updatedGroups = latestMap[seasonType].map(season => {
                    const identifier = isSpecial ? currentBV : matchedGroup.sid;
                    if ((isSpecial && season.BVCode === identifier) ||
                        (!isSpecial && season.sid === identifier)) {
                        if (isSpecial) {
                            if (season.BVCode === currentBV) {
                                const existingVideos = season.videos;
                                let lastRecordIndex = existingVideos.findIndex(video => video.url === newRecord.url);
                                // 还需保证p相同
                                if (lastRecordIndex !== -1 && getPParam(existingVideos[lastRecordIndex].url) !== getPParam(newRecord.url)) {
                                    lastRecordIndex = -1; // 如果p不同，则视为新视频
                                }
                                let newVideos;
                                if (lastRecordIndex !== -1) {
                                    // 同一视频：覆盖最近一次记录
                                    newVideos = [...existingVideos];
                                    newVideos[lastRecordIndex] = newRecord;
                                } else {
                                    // 新视频：添加到开头并截断
                                    newVideos = [newRecord, ...existingVideos].slice(0, recentlyViewedCount);
                                }

                                return { ...season, videos: newVideos };
                            }
                        } else {
                            if (season.sid === matchedGroup.sid) {
                                const existingVideos = season.videos;
                                const lastRecordIndex = existingVideos.findIndex(video => video.url === newRecord.url);

                                let newVideos;
                                if (lastRecordIndex !== -1) {
                                    // 同一视频：覆盖最近一次记录
                                    newVideos = [...existingVideos];
                                    newVideos[lastRecordIndex] = newRecord;
                                } else {
                                    // 新视频：添加到开头并截断
                                    newVideos = [newRecord, ...existingVideos].slice(0, recentlyViewedCount);
                                }

                                return { ...season, videos: newVideos };
                            }
                        }
                    }
                    return season;
                });

                    // 处理实际存储数据大于recentlyViewedCount的情况，删除多余记录
                    updatedGroups.forEach(season => {
                    if (season.videos.length > recentlyViewedCount) {
                        season.videos = season.videos.slice(0, recentlyViewedCount);
                    }
                });
                    return {
                        ...latestMap,
                        [seasonType]: updatedGroups
                    };
                }).catch(error => console.error('保存观看记录失败:', error));
                console.log(`已更新${seasonType}视频列表`);
            };

            recordProgress();
            progressInterval = setInterval(recordProgress, 30000);
        }
    }).catch(error => console.error('读取观看记录失败:', error));
}

// 初始设置
let lastLocation = window.location.href; // 存储完整URL以检测参数变化

function checkLocationChange() {
    const currentLocation = window.location.href;
    if (currentLocation !== lastLocation) {
        lastLocation = currentLocation; // 更新存储的URL
        main(); // 执行页面更新
    }
}

// DOM就绪检查
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    main();
    handleData();
} else {
    document.addEventListener('DOMContentLoaded', main);
    document.addEventListener('DOMContentLoaded', handleData);
}

// 增强的路由监听
const observer = new MutationObserver(checkLocationChange);
observer.observe(document.body, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener(request => {
    if (request?.type === 'seasonAdded') main();
});

// 额外添加历史事件监听（针对浏览器前进/后退）
window.addEventListener('popstate', checkLocationChange);

// 处理手动URL变更（如pushState/replaceState）
const originalPushState = history.pushState;
history.pushState = function () {
    originalPushState.apply(this, arguments);
    setTimeout(checkLocationChange, 50); // 异步确保DOM更新完成
};

const originalReplaceState = history.replaceState;
history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    setTimeout(checkLocationChange, 50);
};

function handleData() {
    // 确保脚本在页面加载后执行
    const video = document.querySelector('video');
    if (video) {
        console.log('视频页面脚本已注入');
    } else {
        console.log('未检测到视频元素，脚本可能未正确注入');
    }
    const currentRestoreGeneration = ++restoreGeneration;
    storageGet(chrome.storage.sync, ['lastClickedLink']).then(data => {
        if (currentRestoreGeneration !== restoreGeneration || !data.lastClickedLink) return;
        const link = data.lastClickedLink;
        if (window.location.href === link.url) {
            console.log('最后点击的链接:', data.lastClickedLink);
            restoreVideoProgress(link, currentRestoreGeneration);
        }
    }).catch(error => console.error('读取恢复进度失败:', error));
}

function restoreVideoProgress(link, generation) {
    const applyProgress = () => {
        if (generation !== restoreGeneration) return;
        const video = document.querySelector('video');
        const progress = Number(link.progress);
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0 || !Number.isFinite(progress)) return false;
        const target = Math.max(0, Math.min(video.duration, video.duration * Math.max(0, Math.min(100, progress)) / 100 - 5));
        video.currentTime = target;
        console.log(`视频进度已设置为: ${progress}%`);
        storageSet(chrome.storage.sync, { lastClickedLink: null }).catch(error => console.error('清理恢复进度失败:', error));
        return true;
    };

    if (applyProgress()) return;
    const video = document.querySelector('video');
    if (video) video.addEventListener('loadedmetadata', applyProgress, { once: true });
}

function formatUrl(url, type) {
    const urlFormat = new URL(url);
    urlFormat.search = '';

    if (type === 'seasons_archives') {
        const p = getPParam(url);
        urlFormat.searchParams.set('p', p);
    }

    return urlFormat.toString();
}

function getPParam(urlStr) {
    try {
        const url = new URL(urlStr);
        const pParam = url.searchParams.get('p') || '1'; // 无p参数默认为1
        return pParam;
    } catch (e) {
        return '1'; // URL解析失败时返回默认值
    }
}