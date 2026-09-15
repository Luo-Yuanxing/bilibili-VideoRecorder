const DEFAULT_SEASONS_MAP = {
    seasons_archives: [],
    seasons_series: []
};

const seasonsStorage = chrome.storage.local;
let seasonsWriteQueue = Promise.resolve();
const SEASONS_STORAGE_VERSION = 2;
const SEASONS_STORAGE_NAMESPACE = `seasons:v${SEASONS_STORAGE_VERSION}`;
const SEASONS_STORAGE_INDEX_KEY = `${SEASONS_STORAGE_NAMESPACE}:index`;
const SEASONS_STORAGE_PREFIX = `${SEASONS_STORAGE_NAMESPACE}:season:`;
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

function isExtensionContextInvalidated(error) {
    return error?.message?.includes('Extension context invalidated');
}

function normalizeRecentlyViewedCount(value) {
    return Number.isInteger(value) && value >= 1 && value <= 50 ? value : 3;
}

function isCurrentSeasonsIndex(index) {
    return index?.version === SEASONS_STORAGE_VERSION
        && Object.keys(DEFAULT_SEASONS_MAP).every(seasonType => Array.isArray(index[seasonType]));
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

    const normalizeVideos = (seasonType, videos) => {
        const videosByUrl = new Map();
        (Array.isArray(videos) ? videos : []).forEach(video => {
            if (!video || typeof video !== 'object') return;
            const videoUrl = typeof video.url === 'string' ? formatUrl(video.url, seasonType) : '';
            const videoId = videoUrl || `${video.name || ''}:${video.timestamp || ''}`;
            if (!videosByUrl.has(videoId)) videosByUrl.set(videoId, { ...video, url: videoUrl || video.url });
        });
        return [...videosByUrl.values()];
    };

    const normalizeGroups = (seasonType, groups) => {
        if (!Array.isArray(groups)) return [];

        const groupIndexes = new Map();
        const normalizedGroups = [];
        groups.filter(group => group && typeof group === 'object').forEach((group, index) => {
            const groupId = getSeasonId(seasonType, group, index);
            const normalizedGroup = { ...group, videos: normalizeVideos(seasonType, group.videos) };
            const existingIndex = groupIndexes.get(groupId);
            if (existingIndex === undefined) {
                groupIndexes.set(groupId, normalizedGroups.length);
                normalizedGroups.push(normalizedGroup);
            } else {
                const existingGroup = normalizedGroups[existingIndex];
                const mergedVideos = [...normalizedGroup.videos, ...existingGroup.videos];
                normalizedGroups[existingIndex] = {
                    ...existingGroup,
                    ...normalizedGroup,
                    videos: normalizeVideos(seasonType, mergedVideos)
                };
            }
        });
        return normalizedGroups;
    };

    return {
        seasons_archives: normalizeGroups('seasons_archives', value.seasons_archives),
        seasons_series: normalizeGroups('seasons_series', value.seasons_series)
    };
}

async function isSpecialCollection(BVCode) {
    const url = `https://www.bilibili.com/video/${encodeURIComponent(BVCode)}`;
    try {
        const html = await fetchTextWithTimeout(url, { timeoutMs: 8000 });
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
        : season.sid;
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
    const index = (await storageGet(seasonsStorage, [SEASONS_STORAGE_INDEX_KEY]))[SEASONS_STORAGE_INDEX_KEY];
    if (!index) return { ...DEFAULT_SEASONS_MAP };
    if (index.version !== SEASONS_STORAGE_VERSION) {
        throw new Error(`不支持的数据存储版本：${index.version}`);
    }
    if (!isCurrentSeasonsIndex(index)) {
        throw new Error('当前数据存储版本的索引格式无效');
    }

    return loadStoredSeasonsMap(index);
}

async function loadStoredSeasonsMap(index) {
    const seasonTypes = Object.keys(DEFAULT_SEASONS_MAP);
    const seasonIds = seasonTypes.flatMap(seasonType => index[seasonType] || []);
    const metadataKeys = seasonIds.map(seasonId => getSeasonStorageKeys(seasonId).meta);
    const metadata = await storageGet(seasonsStorage, metadataKeys);
    const chunkKeys = seasonIds.flatMap(seasonId => {
        const seasonIndex = metadata[getSeasonStorageKeys(seasonId).meta];
        const chunkCount = Number.isInteger(seasonIndex?.chunkCount) ? seasonIndex.chunkCount : 0;
        const { chunks } = getSeasonStorageKeys(seasonId);
        return Array.from({ length: chunkCount }, (_, chunkIndex) => `${chunks}${chunkIndex}`);
    });
    const chunks = chunkKeys.length ? await storageGet(seasonsStorage, chunkKeys) : {};
    const result = { ...DEFAULT_SEASONS_MAP };

    seasonTypes.forEach(seasonType => {
        (index[seasonType] || []).forEach(seasonId => {
            const { meta, chunks: chunkPrefix } = getSeasonStorageKeys(seasonId);
            const seasonIndex = metadata[meta];
            if (!seasonIndex?.group || typeof seasonIndex.group !== 'object') return;
            const videos = Array.from({ length: seasonIndex.chunkCount || 0 }, (_, chunkIndex) => chunks[`${chunkPrefix}${chunkIndex}`])
                .flat()
                .filter(record => record && typeof record === 'object');
            result[seasonType].push({ ...seasonIndex.group, videos });
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

    const oldSeasonIds = isCurrentSeasonsIndex(currentIndex)
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
}

function enqueueSeasonsMapUpdate(update) {
    seasonsWriteQueue = seasonsWriteQueue.catch(() => undefined).then(async () => {
        const currentMap = await loadSeasonsMap();
        const updatedMap = update(currentMap);
        if (!updatedMap) return currentMap;
        const nextMap = normalizeSeasonsMap(updatedMap);
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
    formattedUrl.hash = '';

    if (type === 'seasons_archives') {
        formattedUrl.searchParams.set('p', getPParam(url));
    }

    return formattedUrl.toString();
}