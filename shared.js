const DEFAULT_SEASONS_MAP = {
    seasons_archives: [],
    seasons_series: []
};

const seasonsStorage = chrome.storage.local;
let seasonsWriteQueue = Promise.resolve();
const SEASONS_STORAGE_VERSION = 2;
const SEASONS_STORAGE_INDEX_KEY = 'seasons:v2:index';
const SEASONS_STORAGE_PREFIX = 'seasons:v2:season:';
const LEGACY_RECORDS_STORAGE_INDEX_KEY = 'records:v1:index';
const LEGACY_RECORDS_STORAGE_PREFIX = 'records:v1:group:';
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

function normalizeSeasonsMap(value) {
    if (!value || typeof value !== 'object') {
        return { ...DEFAULT_SEASONS_MAP };
    }

    const normalizeGroups = groups => Array.isArray(groups)
        ? groups.filter(group => group && typeof group === 'object').map(group => ({
            ...group,
            videos: Array.isArray(group.videos) ? group.videos : (Array.isArray(group.records) ? group.records : [])
        }))
        : [];

    return {
        seasons_archives: normalizeGroups(value.seasons_archives ?? value.recordsGroupListSpecial),
        seasons_series: normalizeGroups(value.seasons_series ?? value.recordsGroupListNormal)
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

function getSeasonId(seasonType, season, fallbackIndex) {
    const identifier = seasonType === 'seasons_archives'
        ? season.BVCode
        : `${season.sid}_${season.spaceId}`;
    return `${seasonType}:${encodeURIComponent(identifier || `invalid_${fallbackIndex}`)}`;
}

function getSeasonStorageKeys(seasonId, storagePrefix = SEASONS_STORAGE_PREFIX, videoKey = 'videos') {
    const prefix = `${storagePrefix}${seasonId}`;
    return { meta: `${prefix}:meta`, chunks: `${prefix}:${videoKey}:` };
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

async function loadSeasonsMap() {
    const indexData = await storageGet(seasonsStorage, [SEASONS_STORAGE_INDEX_KEY, LEGACY_RECORDS_STORAGE_INDEX_KEY, 'recordsGroupMap', 'seasonsMap']);
    const index = indexData[SEASONS_STORAGE_INDEX_KEY];

    if (!index || index.version !== SEASONS_STORAGE_VERSION) {
        const legacyIndex = indexData[LEGACY_RECORDS_STORAGE_INDEX_KEY];
        if (legacyIndex?.version === 1) {
            const legacyMap = await loadStoredSeasonsMap(legacyIndex, LEGACY_RECORDS_STORAGE_PREFIX, ['recordsGroupListSpecial', 'recordsGroupListNormal'], 'records');
            await writeSeasonsMap(legacyMap, null);
            return legacyMap;
        }
        const legacyMap = normalizeSeasonsMap(indexData.recordsGroupMap);
        if (indexData.recordsGroupMap) await writeSeasonsMap(legacyMap, null);
        return legacyMap;
    }

    return loadStoredSeasonsMap(index, SEASONS_STORAGE_PREFIX, ['seasons_archives', 'seasons_series']);
}

async function loadStoredSeasonsMap(index, storagePrefix, seasonTypes, videoKey = 'videos') {
    const seasonIds = seasonTypes.flatMap(seasonType => index[seasonType] || []);
    const metadataKeys = seasonIds.map(seasonId => getSeasonStorageKeys(seasonId, storagePrefix, videoKey).meta);
    const metadata = await storageGet(seasonsStorage, metadataKeys);
    const chunkKeys = seasonIds.flatMap(seasonId => {
        const seasonIndex = metadata[getSeasonStorageKeys(seasonId, storagePrefix, videoKey).meta];
        const chunkCount = Number.isInteger(seasonIndex?.chunkCount) ? seasonIndex.chunkCount : 0;
        const { chunks } = getSeasonStorageKeys(seasonId, storagePrefix, videoKey);
        return Array.from({ length: chunkCount }, (_, chunkIndex) => `${chunks}${chunkIndex}`);
    });
    const chunks = chunkKeys.length ? await storageGet(seasonsStorage, chunkKeys) : {};
    const result = { ...DEFAULT_SEASONS_MAP };

    seasonTypes.forEach((seasonType, seasonTypeIndex) => {
        const targetSeasonType = seasonTypes.length === 2 && seasonTypeIndex === 0 ? 'seasons_archives' : 'seasons_series';
        (index[seasonType] || []).forEach(seasonId => {
            const { meta, chunks: chunkPrefix } = getSeasonStorageKeys(seasonId, storagePrefix, videoKey);
            const seasonIndex = metadata[meta];
            if (!seasonIndex?.group || typeof seasonIndex.group !== 'object') return;
            const videos = Array.from({ length: seasonIndex.chunkCount || 0 }, (_, chunkIndex) => chunks[`${chunkPrefix}${chunkIndex}`])
                .flat()
                .filter(record => record && typeof record === 'object');
            result[targetSeasonType].push({ ...seasonIndex.group, videos });
        });
    });
    return normalizeSeasonsMap(result);
}

async function writeSeasonsMap(seasonsMap, previousIndex) {
    const normalizedMap = normalizeSeasonsMap(seasonsMap);
    const currentIndex = previousIndex || (await storageGet(seasonsStorage, [SEASONS_STORAGE_INDEX_KEY]))[SEASONS_STORAGE_INDEX_KEY];
    const nextIndex = {
        version: SEASONS_STORAGE_VERSION,
        seasons_archives: [],
        seasons_series: []
    };
    const values = {};

    Object.keys(DEFAULT_SEASONS_MAP).forEach(seasonType => {
        normalizedMap[seasonType].forEach((season, seasonIndex) => {
            const seasonId = getSeasonId(seasonType, season, seasonIndex);
            const keys = getSeasonStorageKeys(seasonId);
            const { videos, ...seasonMetadata } = season;
            const videoChunks = splitRecordChunks(videos);
            nextIndex[seasonType].push(seasonId);
            values[keys.meta] = { group: seasonMetadata, chunkCount: videoChunks.length };
            videoChunks.forEach((chunk, chunkIndex) => {
                values[`${keys.chunks}${chunkIndex}`] = chunk;
            });
        });
    });

    if (Object.keys(values).length) await storageSet(seasonsStorage, values);
    await storageSet(seasonsStorage, { [SEASONS_STORAGE_INDEX_KEY]: nextIndex });

    const oldSeasonIds = currentIndex?.version === SEASONS_STORAGE_VERSION
        ? [...(currentIndex.seasons_archives || []), ...(currentIndex.seasons_series || [])]
        : [];
    const staleKeys = oldSeasonIds.flatMap(seasonId => {
        const keys = getSeasonStorageKeys(seasonId);
        const oldMetadata = null;
        return seasonId && ![...nextIndex.seasons_archives, ...nextIndex.seasons_series].includes(seasonId)
            ? [keys.meta]
            : oldMetadata;
    }).filter(Boolean);
    if (staleKeys.length) {
        const staleMetadata = await storageGet(seasonsStorage, staleKeys);
        const staleChunkKeys = staleKeys.flatMap(metaKey => {
            const metadata = staleMetadata[metaKey];
            const chunkPrefix = metaKey.replace(/:meta$/, ':videos:');
            return Array.from({ length: metadata?.chunkCount || 0 }, (_, chunkIndex) => `${chunkPrefix}${chunkIndex}`);
        });
        await storageRemove(seasonsStorage, [...staleKeys, ...staleChunkKeys]);
    }
    if (currentIndex?.version !== SEASONS_STORAGE_VERSION) await storageRemove(seasonsStorage, ['recordsGroupMap', LEGACY_RECORDS_STORAGE_INDEX_KEY]);
}

function enqueueSeasonsMapUpdate(update) {
    seasonsWriteQueue = seasonsWriteQueue.then(async () => {
        const currentMap = await loadSeasonsMap();
        const nextMap = normalizeSeasonsMap(update(currentMap));
        await writeSeasonsMap(nextMap);
        return nextMap;
    });
    return seasonsWriteQueue;
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

    if (type === 'seasons_archives') {
        formattedUrl.searchParams.set('p', getPParam(url));
    }

    return formattedUrl.toString();
}