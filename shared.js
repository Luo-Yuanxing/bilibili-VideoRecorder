const DEFAULT_RECORDS_GROUP_MAP = {
    recordsGroupListSpecial: [],
    recordsGroupListNormal: []
};

const recordsStorage = chrome.storage.local;
let recordsWriteQueue = Promise.resolve();

function storageGet(area, keys) {
    return new Promise((resolve, reject) => {
        area.get(keys, result => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            resolve(result);
        });
    });
}

function storageSet(area, values) {
    return new Promise((resolve, reject) => {
        area.set(values, () => {
            const error = chrome.runtime.lastError;
            if (error) {
                reject(new Error(error.message));
                return;
            }
            resolve();
        });
    });
}

function normalizeRecentlyViewedCount(value) {
    return Number.isInteger(value) && value >= 1 && value <= 50 ? value : 3;
}

async function fetchTextWithTimeout(url, { timeoutMs = 8000, headers = {} } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.text();
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchJsonWithTimeout(url, { timeoutMs = 8000, headers = {} } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        if (!data || typeof data !== 'object') {
            throw new Error('接口响应不是对象');
        }
        return data;
    } finally {
        clearTimeout(timeoutId);
    }
}

function isAllowedBilibiliUrl(urlString) {
    try {
        const url = new URL(urlString);
        if (url.protocol !== 'https:') {
            return false;
        }
        const host = url.hostname.toLowerCase();
        return host === 'bilibili.com' || host === 'www.bilibili.com' || host === 'api.bilibili.com' || host === 'space.bilibili.com' || host.endsWith('.bilibili.com');
    } catch (error) {
        return false;
    }
}

function enqueueRecordsGroupMapUpdate(update) {
    recordsWriteQueue = recordsWriteQueue.then(async () => {
        const data = await storageGet(recordsStorage, ['recordsGroupMap']);
        const currentMap = normalizeRecordsGroupMap(data.recordsGroupMap);
        const nextMap = normalizeRecordsGroupMap(update(currentMap));
        await storageSet(recordsStorage, { recordsGroupMap: nextMap });
        return nextMap;
    });
    return recordsWriteQueue;
}

function normalizeRecordsGroupMap(value) {
    if (!value || typeof value !== 'object') {
        return { ...DEFAULT_RECORDS_GROUP_MAP };
    }

    const normalizeGroups = groups => Array.isArray(groups)
        ? groups.filter(group => group && typeof group === 'object').map(group => ({
            ...group,
            records: Array.isArray(group.records) ? group.records : []
        }))
        : [];

    return {
        recordsGroupListSpecial: normalizeGroups(value.recordsGroupListSpecial),
        recordsGroupListNormal: normalizeGroups(value.recordsGroupListNormal)
    };
}

async function isSpecialCollection(BVCode) {
    const url = `https://www.bilibili.com/video/${encodeURIComponent(BVCode)}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('视频请求失败');
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const items = doc.querySelectorAll('.video-pod__item');
        if (items.length === 0) {
            return false;
        }

        const currentItem = Array.from(items).find(item => item.getAttribute('data-key') === BVCode);
        if (Array.from(items).every(item => item.classList.contains('simple-base-item'))) {
            return true;
        }

        return Boolean(currentItem?.querySelector('.page-list'));
    } catch (error) {
        console.error('检测失败:', error);
        return false;
    }
}

function getPParam(urlStr) {
    try {
        return new URL(urlStr).searchParams.get('p') || '1';
    } catch (error) {
        return '1';
    }
}

function formatUrl(url, type) {
    const formattedUrl = new URL(url);
    formattedUrl.search = '';

    if (type === 'recordsGroupListSpecial') {
        formattedUrl.searchParams.set('p', getPParam(url));
    }

    return formattedUrl.toString();
}