const DEFAULT_RECORDS_GROUP_MAP = {
    recordsGroupListSpecial: [],
    recordsGroupListNormal: []
};

const recordsStorage = chrome.storage.local;
let recordsWriteQueue = Promise.resolve();
const RECORDS_STORAGE_VERSION = 1;
const RECORDS_STORAGE_INDEX_KEY = 'records:v1:index';
const RECORDS_STORAGE_PREFIX = 'records:v1:group:';
const RECORDS_CHUNK_MAX_BYTES = 6000;

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

function storageRemove(area, keys) {
    return new Promise((resolve, reject) => {
        area.remove(keys, () => {
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

function getRecordGroupId(groupType, group, fallbackIndex) {
    const identifier = groupType === 'recordsGroupListSpecial'
        ? group.BVCode
        : `${group.sid}_${group.spaceId}`;
    return `${groupType}:${encodeURIComponent(identifier || `invalid_${fallbackIndex}`)}`;
}

function getRecordGroupStorageKeys(groupId) {
    const prefix = `${RECORDS_STORAGE_PREFIX}${groupId}`;
    return { meta: `${prefix}:meta`, chunks: `${prefix}:records:` };
}

function splitRecordChunks(records) {
    const chunks = [];
    let chunk = [];
    let chunkSize = 2;

    records.forEach(record => {
        const recordSize = new TextEncoder().encode(JSON.stringify(record)).length + (chunk.length ? 1 : 0);
        if (chunk.length && chunkSize + recordSize > RECORDS_CHUNK_MAX_BYTES) {
            chunks.push(chunk);
            chunk = [];
            chunkSize = 2;
        }
        chunk.push(record);
        chunkSize += recordSize;
    });

    if (chunk.length) chunks.push(chunk);
    return chunks;
}

async function loadRecordsGroupMap() {
    const indexData = await storageGet(recordsStorage, [RECORDS_STORAGE_INDEX_KEY, 'recordsGroupMap']);
    const index = indexData[RECORDS_STORAGE_INDEX_KEY];

    if (!index || index.version !== RECORDS_STORAGE_VERSION) {
        const legacyMap = normalizeRecordsGroupMap(indexData.recordsGroupMap);
        if (indexData.recordsGroupMap) await writeRecordsGroupMap(legacyMap, null);
        return legacyMap;
    }

    const groupIds = [...index.recordsGroupListSpecial, ...index.recordsGroupListNormal];
    const metadataKeys = groupIds.map(groupId => getRecordGroupStorageKeys(groupId).meta);
    const metadata = await storageGet(recordsStorage, metadataKeys);
    const chunkKeys = groupIds.flatMap(groupId => {
        const groupIndex = metadata[getRecordGroupStorageKeys(groupId).meta];
        const chunkCount = Number.isInteger(groupIndex?.chunkCount) ? groupIndex.chunkCount : 0;
        const { chunks } = getRecordGroupStorageKeys(groupId);
        return Array.from({ length: chunkCount }, (_, chunkIndex) => `${chunks}${chunkIndex}`);
    });
    const chunks = chunkKeys.length ? await storageGet(recordsStorage, chunkKeys) : {};
    const result = { ...DEFAULT_RECORDS_GROUP_MAP };

    Object.keys(result).forEach(groupType => {
        (index[groupType] || []).forEach(groupId => {
            const { meta, chunks: chunkPrefix } = getRecordGroupStorageKeys(groupId);
            const groupIndex = metadata[meta];
            if (!groupIndex?.group || typeof groupIndex.group !== 'object') return;
            const records = Array.from({ length: groupIndex.chunkCount || 0 }, (_, chunkIndex) => chunks[`${chunkPrefix}${chunkIndex}`])
                .flat()
                .filter(record => record && typeof record === 'object');
            result[groupType].push({ ...groupIndex.group, records });
        });
    });
    return normalizeRecordsGroupMap(result);
}

async function writeRecordsGroupMap(recordsGroupMap, previousIndex) {
    const normalizedMap = normalizeRecordsGroupMap(recordsGroupMap);
    const currentIndex = previousIndex || (await storageGet(recordsStorage, [RECORDS_STORAGE_INDEX_KEY]))[RECORDS_STORAGE_INDEX_KEY];
    const nextIndex = {
        version: RECORDS_STORAGE_VERSION,
        recordsGroupListSpecial: [],
        recordsGroupListNormal: []
    };
    const values = {};

    Object.keys(DEFAULT_RECORDS_GROUP_MAP).forEach(groupType => {
        normalizedMap[groupType].forEach((group, groupIndex) => {
            const groupId = getRecordGroupId(groupType, group, groupIndex);
            const keys = getRecordGroupStorageKeys(groupId);
            const { records, ...groupMetadata } = group;
            const recordChunks = splitRecordChunks(records);
            nextIndex[groupType].push(groupId);
            values[keys.meta] = { group: groupMetadata, chunkCount: recordChunks.length };
            recordChunks.forEach((chunk, chunkIndex) => {
                values[`${keys.chunks}${chunkIndex}`] = chunk;
            });
        });
    });

    if (Object.keys(values).length) await storageSet(recordsStorage, values);
    await storageSet(recordsStorage, { [RECORDS_STORAGE_INDEX_KEY]: nextIndex });

    const oldGroupIds = currentIndex?.version === RECORDS_STORAGE_VERSION
        ? [...(currentIndex.recordsGroupListSpecial || []), ...(currentIndex.recordsGroupListNormal || [])]
        : [];
    const staleKeys = oldGroupIds.flatMap(groupId => {
        const keys = getRecordGroupStorageKeys(groupId);
        const oldMetadata = null;
        return groupId && ![...nextIndex.recordsGroupListSpecial, ...nextIndex.recordsGroupListNormal].includes(groupId)
            ? [keys.meta]
            : oldMetadata;
    }).filter(Boolean);
    if (staleKeys.length) {
        const staleMetadata = await storageGet(recordsStorage, staleKeys);
        const staleChunkKeys = staleKeys.flatMap(metaKey => {
            const metadata = staleMetadata[metaKey];
            const chunkPrefix = metaKey.replace(/:meta$/, ':records:');
            return Array.from({ length: metadata?.chunkCount || 0 }, (_, chunkIndex) => `${chunkPrefix}${chunkIndex}`);
        });
        await storageRemove(recordsStorage, [...staleKeys, ...staleChunkKeys]);
    }
    if (currentIndex?.version !== RECORDS_STORAGE_VERSION) await storageRemove(recordsStorage, ['recordsGroupMap']);
}

function enqueueRecordsGroupMapUpdate(update) {
    recordsWriteQueue = recordsWriteQueue.then(async () => {
        const currentMap = await loadRecordsGroupMap();
        const nextMap = normalizeRecordsGroupMap(update(currentMap));
        await writeRecordsGroupMap(nextMap);
        return nextMap;
    });
    return recordsWriteQueue;
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