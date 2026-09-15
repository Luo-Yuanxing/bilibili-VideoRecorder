// DOM元素
const saveBtn = document.getElementById('saveGroup');
const BVCodeInput = document.getElementById('BVCodeInput');
const notification = document.getElementById('notification');
const errorMessage = document.getElementById('errorMessage');
const recordCountInput = document.getElementById('recordCount');
const saveSettingBtn = document.getElementById('saveSetting');
const clearCacheBtn = document.getElementById('clearCache');

const GROUP_CONFIG = [
    { id: 'seasonsArchivesList', seasonType: 'seasons_archives', title: 'seasons_archives 合集' },
    { id: 'seasonsSeriesList', seasonType: 'seasons_series', title: 'seasons_series 视频列表' }
];

// 用于存储记录组数据
/* 
    seasons_archives: [{
            title: title,
            BVCode: BVCode,
            records: []
        }] 
    seasons_series: [{
            title: title,
            sid: sid,
            spaceId: spaceId,
            records: []
        }]
*/
let seasonsMap = { seasons_archives: [], seasons_series: [] };
let expandedGroups = {};
let recentlyViewedCount = 3; // 默认最近观看记录数量
let dragSourceIndex = null;
let dragOverIndex = null;
let dragSourceGroup = null;

// 加载保存的数据
function loadData() {
    Promise.all([
        loadSeasonsMap(),
        storageGet(chrome.storage.sync, ['seasonsMap', 'recentlyViewedCount', 'lastClickedLink'])
    ]).then(([storedSeasonsMap, settings]) => {
        const data = {
            ...settings,
            seasonsMap: storedSeasonsMap ?? settings.seasonsMap
        };
        seasonsMap = normalizeSeasonsMap(data.seasonsMap);
        recentlyViewedCount = normalizeRecentlyViewedCount(data.recentlyViewedCount);
        recordCountInput.value = recentlyViewedCount;
        initRecordGroups();
        renderRecordGroups();
    }).catch(error => showError(`读取数据失败：${error.message}`));
}

// 初始化记录组列表
function initRecordGroups() {
    GROUP_CONFIG.forEach(({ id, seasonType, title }) => {
        let recordList = document.getElementById(id);
        if (!recordList) {
            const section = document.createElement('div');
            section.className = 'section';
            const recordsList = document.createElement('div');
            recordsList.className = 'records-list';
            recordsList.appendChild(createTextElement('h3', '', title));
            recordList = document.createElement('div');
            recordList.id = id;
            recordsList.appendChild(recordList);
            section.appendChild(recordsList);
            const addGroup = document.querySelector('.add-group');
            if (addGroup?.parentNode) addGroup.parentNode.insertBefore(section, addGroup.nextSibling);
        }

        recordList.replaceChildren();
        const groups = seasonsMap[seasonType] || [];
        if (!groups.length) {
            recordList.appendChild(createTextElement('div', 'empty', '暂无保存的 season'));
            return;
        }
        groups.forEach((group, index) => recordList.appendChild(createGroupItem(group, seasonType, index)));
    });
}

function createTextElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

function createGroupItem(group, seasonType, index) {
    const recordKey = seasonType === 'seasons_archives'
        ? `special_${group.BVCode}`
        : `normal_${group.sid}_${group.spaceId}`;
    const isExpanded = Boolean(expandedGroups[recordKey]);
    const item = createTextElement('div', 'record-item', '');
    const titleContainer = createTextElement('div', 'record-title-container', '');
    const dragHandle = createTextElement('div', 'drag-handle', '');
    dragHandle.draggable = true;
    titleContainer.append(dragHandle, createTextElement('span', 'record-title', group.upName ? `${group.upName} - ${group.title}` : (group.title || '未命名 season')));

    const code = createTextElement('div', 'record-bv', '');
    code.appendChild(createTextElement('span', 'record-bvcode', group.sid ? `SID: ${group.sid}` : `BV: ${group.BVCode || ''}`));
    const actions = createTextElement('div', 'actions', '');
    actions.append(createActionButton('expand', isExpanded ? '收起' : '展开', { key: recordKey }), createActionButton('delete', '删除', { id: seasonType, index }));
    item.append(titleContainer, code, createWatchRecords(group.videos, isExpanded), actions);

    dragHandle.addEventListener('dragstart', event => onDragStart(event, seasonType, index));
    dragHandle.addEventListener('dragend', onDragEnd);
    item.addEventListener('dragover', event => onDragOver(event, seasonType, index));
    item.addEventListener('dragleave', onDragLeave);
    item.addEventListener('drop', event => onDrop(event, seasonType, index));
    return item;
}

function createActionButton(type, text, data) {
    const button = createTextElement('button', `action-btn ${type}`, text);
    button.dataset.type = type;
    Object.entries(data).forEach(([key, value]) => { button.dataset[key] = String(value); });
    return button;
}

function createWatchRecords(records, isExpanded) {
    const container = createTextElement('div', `watch-records${isExpanded ? ' expanded' : ''}`, '');
    if (!Array.isArray(records) || records.length === 0) {
        container.appendChild(createTextElement('div', 'empty-record', '暂无观看记录'));
        return container;
    }
    records.forEach(record => container.appendChild(createRecordEntry(record)));
    return container;
}

function createRecordEntry(record) {
    const entry = createTextElement('div', 'record-entry', '');
    const infoElement = createTextElement('div', 'record-info', '');
    const link = createTextElement('a', 'record-name', record.name || '未命名视频');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = link.textContent;
    link.dataset.progress = String(record.progress ?? 0);
    if (isAllowedBilibiliUrl(record.url)) link.href = record.url;
    infoElement.append(link, createTextElement('span', 'record-date', formatDate(record.timestamp)));

    const progressBar = createTextElement('div', 'progress-bar', '');
    const progress = createTextElement('div', '', '');
    progress.style.width = `${Math.max(0, Math.min(100, Number(record.progress) || 0))}%`;
    progressBar.appendChild(progress);
    entry.append(infoElement, progressBar);
    return entry;
}

// 处理按钮动作
function handleAction(e) {
    const button = e.target.closest('.action-btn');
    if (!button) return;
    const key = button.dataset.key;
    const type = button.dataset.type;
    const index = button.dataset.index;
    const groupId = button.dataset.id;

    if (type === 'delete') {
        if (!confirm('确定要删除这个卡片吗？')) return;
        // 从对应的记录组数组中删除
        seasonsMap[groupId].splice(index, 1);
        // 删除展开状态
        if (expandedGroups[key]) delete expandedGroups[key];
        saveData();
        showNotification('此卡片已删除！');
    } else if (type === 'expand') {
        // 切换展开状态
        expandedGroups[key] = !expandedGroups[key];
        // 重新渲染记录组列表
        renderRecordGroups();
    }
}

// 保存数据
function saveData() {
    enqueueSeasonsMapUpdate(() => seasonsMap).then(nextMap => {
        seasonsMap = nextMap;
        console.log('seasonsMap 已保存:', seasonsMap);
        renderRecordGroups();
    }).catch(error => showError(`保存数据失败：${error.message}`));
}

// 显示通知
function showNotification(message, isSuccess = true) {
    notification.textContent = message;
    notification.style.background = isSuccess ? '#f0f9eb' : '#fef0f0';
    notification.style.color = isSuccess ? '#67c23a' : '#f56c6c';
    notification.style.display = 'block';

    setTimeout(() => {
        notification.style.display = 'none';
    }, 2000);
}

// 显示错误消息
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

// 隐藏错误消息
function hideError() {
    errorMessage.style.display = 'none';
}

function getInputBVCode() {
    const BVCode = BVCodeInput.value.trim();
    if (!BVCode) {
        showError('请输入BV号');
        return null;
    }
    if (!/^BV\w{10}$/i.test(BVCode)) {
        showError('BV号格式不正确，格式应为BV后跟10位字母数字');
        return null;
    }
    return BVCode;
}

async function addRecordGroup({ groupId, duplicateMessage, createGroup }) {
    const BVCode = getInputBVCode();
    if (!BVCode) return;

    const oldBtnText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<div class="spinner"></div>';
    saveBtn.disabled = true;

    try {
        const { group, isDuplicate } = await createGroup(BVCode, seasonsMap[groupId]);
        if (isDuplicate) {
            showError(duplicateMessage);
            return;
        }
        seasonsMap[groupId].push(group);
        BVCodeInput.value = '';
        saveData();
        showNotification('season 已成功添加！');
    } catch (error) {
        showError(error.message);
        console.error('获取记录组信息失败:', error);
    } finally {
        saveBtn.innerHTML = oldBtnText;
        saveBtn.disabled = false;
    }
}

// 添加新记录组 -- 特殊合集
function addNewRecordGroupForSpecial() {
    return addRecordGroup({
        groupId: 'seasons_archives',
        duplicateMessage: '该 seasons_archives 合集已存在，请勿重复添加',
        createGroup: async (BVCode, groups) => {
            if (!await isSpecialCollection(BVCode)) {
                throw new Error('该BV号似乎不是特殊合集类型');
            }
            const data = await fetchJsonWithTimeout(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(BVCode)}`, { timeoutMs: 8000 });
            if (data.code !== 0 || !data.data || data.data.bvid !== BVCode) {
                throw new Error(data.message || '无法获取视频信息');
            }
            const group = { title: data.data.title, BVCode, videos: [] };
            return { group, isDuplicate: groups.some(item => item.BVCode === BVCode) };
        }
    });
}

// 添加新记录组 -- 普通合集
function addNewRecordGroupForNormal() {
    return addRecordGroup({
        groupId: 'seasons_series',
        duplicateMessage: '该 seasons_series 视频列表已存在，请勿重复添加',
        createGroup: async (BVCode, groups) => {
            if (await isSpecialCollection(BVCode)) {
                throw new Error('该BV号是特殊合集，请使用特殊合集功能添加');
            }
            const collectionInfo = await getCollectionInfo(BVCode);
            if (!collectionInfo) {
                throw new Error('获取合集信息失败，请检查BV号是否正确');
            }
            const group = { ...collectionInfo, videos: [] };
            return { group, isDuplicate: groups.some(item => item.sid === collectionInfo.sid) };
        }
    });
}

async function getCollectionInfo(BVCode) {
    const url = `https://www.bilibili.com/video/${BVCode}`;
    try {
        const html = await fetchTextWithTimeout(url, { timeoutMs: 8000 });
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const collectionElement = doc.querySelector('.video-pod__header .header-top .left a');
        if (!collectionElement || !collectionElement.href) {
            throw new Error('未找到合集链接');
        }

        const sidMatch = collectionElement.href.match(/(?:sid=|\/collectiondetail\?sid=)(\d+)/);
        if (!sidMatch) {
            throw new Error('合集SID未找到');
        }
        const sid = sidMatch[1];

        const spaceIdMatch = collectionElement.href.match(/space\.bilibili\.com\/(\d+)/);
        if (!spaceIdMatch) {
            throw new Error('空间ID未找到');
        }
        const spaceId = spaceIdMatch[1];

        const title = collectionElement.textContent.trim();
        if (!title) {
            throw new Error('合集标题未找到');
        }

        const spaceHtml = await fetchTextWithTimeout(`https://space.bilibili.com/${spaceId}`, { timeoutMs: 8000 });
        const spaceDoc = new DOMParser().parseFromString(spaceHtml, 'text/html');
        const upNameElement = spaceDoc.querySelector('title');
        if (!upNameElement || !upNameElement.textContent) {
            throw new Error('UP主名称未找到');
        }

        const upName = upNameElement.textContent
            .split('-')[0]
            .trim()
            .replace(/的个人空间|个人主页|视频/g, '')
            .trim();

        if (!upName) {
            throw new Error('UP主名称解析失败');
        }

        return {
            sid,
            spaceId,
            title,
            upName,
        };
    } catch (error) {
        console.error('获取合集信息失败:', error);
        return null;
    }

}

// 初始化和事件监听
document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // 初始化chrome.storage内容
    recentlyViewedCount = normalizeRecentlyViewedCount(recentlyViewedCount);
    storageSet(chrome.storage.sync, { recentlyViewedCount }).catch(error => console.error('保存默认设置失败:', error));

    // 类型选择器功能
    const specialOption = document.getElementById('specialOption');
    const normalOption = document.getElementById('normalOption');
    const typeHint = document.getElementById('typeHint');

    [specialOption, normalOption].forEach(option => {
        option.addEventListener('click', function () {
            specialOption.classList.remove('selected');
            normalOption.classList.remove('selected');
            this.classList.add('selected');
            typeHint.textContent = this.id === 'specialOption' ?
                'seasons_archives：共享标题的多P视频合集' :
                'seasons_series：按 sid 归档的视频列表';
        });
    });

    // 保存按钮点击事件
    const submitRecordGroup = () => {
        const selectedType = document.querySelector('.type-option.selected')?.dataset.type;
        if (selectedType === 'special') addNewRecordGroupForSpecial();
        if (selectedType === 'normal') addNewRecordGroupForNormal();
    };

    saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        hideError();
        submitRecordGroup();
    });

    // 输入框输入事件 - 清除错误
    BVCodeInput.addEventListener('input', () => {
        hideError();
    });

    // 回车键提交
    BVCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            hideError();
            submitRecordGroup();
        }
    });

    document.body.addEventListener('click', (e) => {
        const actionButton = e.target.closest('.action-btn');
        if (actionButton) {
            handleAction(e);
            return;
        }

        if (e.target.matches('.record-name')) {
            e.preventDefault();
            const url = e.target.href;
            if (!isAllowedBilibiliUrl(url)) {
                showError('记录链接不是有效的哔哩哔哩地址');
                return;
            }
            const progress = Number(e.target.dataset.progress) || 0;
            storageSet(chrome.storage.sync, {
                lastClickedLink: {
                    url,
                    progress
                }
            }).then(() => {
                console.log('最后点击的链接已保存:', { url, progress });
            }).catch(error => showError(`保存播放位置失败：${error.message}`));
            chrome.tabs.create({ url });
        }
    });
});

// 日期格式化函数
function formatDate(isoString) {
    const date = new Date(isoString);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// 保存设置
function saveSettings() {
    const newCount = Number(recordCountInput.value);
    if (!Number.isInteger(newCount) || newCount < 1 || newCount > 50) {
        showError('请输入1-50之间的有效数字');
        return;
    }

    recentlyViewedCount = newCount;
    storageSet(chrome.storage.sync, { recentlyViewedCount })
        .then(() => showNotification('设置已保存！'))
        .catch(error => showError(`设置保存失败：${error.message}`));
}

saveSettingBtn.addEventListener('click', saveSettings);
recordCountInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        saveSettings();
    }
});

// 添加拖拽事件处理函数
function onDragStart(e, group, index) {
    dragSourceGroup = group; // 新增全局变量
    dragSourceIndex = index;
    e.currentTarget.closest('.record-item').classList.add('dragging');
    e.dataTransfer.setData('text/plain', index);
    e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e, group, index) {
    e.preventDefault();
    dragOverIndex = index;

    const targetItem = e.currentTarget;
    const rect = targetItem.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    // 移除所有drag-over类
    document.querySelectorAll('.record-item').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    // 确定是放在上半部分还是下半部分
    if (y < height / 2) {
        targetItem.classList.add('drag-over-top');
    } else {
        targetItem.classList.add('drag-over-bottom');
    }

    return false;
}

function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
}

function onDragEnd(e) {
    document.querySelectorAll('.record-item').forEach(item => {
        item.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
    });
    dragSourceIndex = null;
    dragOverIndex = null;
}

function onDrop(e, group, index) {
    e.preventDefault();
    e.stopPropagation();
    const sourceIndex = dragSourceIndex;
    const targetIndex = dragOverIndex;

    if (dragSourceGroup === group && sourceIndex !== null && targetIndex !== null && sourceIndex !== targetIndex) {
        const groupArray = seasonsMap[group];
        const isTop = e.currentTarget.classList.contains('drag-over-top');
        const rawFinalPosition = isTop ? targetIndex : targetIndex + 1;
        const finalPosition = sourceIndex < rawFinalPosition ? rawFinalPosition - 1 : rawFinalPosition;
        const movedItem = groupArray.splice(sourceIndex, 1)[0];
        groupArray.splice(Math.max(0, Math.min(finalPosition, groupArray.length)), 0, movedItem);

        saveData();
        showNotification('记录组已重新排序');
    }
    onDragEnd();
    return false;
}

// 清除缓存按钮事件
clearCacheBtn.addEventListener('click', () => {
    if (confirm('确定要清空所有存储数据吗？此操作不可撤销。')) {
        Promise.all([
            new Promise((resolve, reject) => seasonsStorage.clear(() => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message)); else resolve();
            })),
            new Promise((resolve, reject) => chrome.storage.sync.clear(() => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message)); else resolve();
            }))
        ]).then(() => {
            seasonsMap = normalizeSeasonsMap();
            expandedGroups = {};
            recentlyViewedCount = 3;
            loadData();
            showNotification('所有存储数据已清空！');
        }).catch(error => showError(`清空存储失败：${error.message}`));
        recordCountInput.value = 3;
        // 刷新插件
        chrome.runtime.reload();
    }
});

// 接收来自content.js的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refreshPopup') {
        // 刷新记录组数据
        loadData();
        sendResponse({ status: 'success' });
    }
});

function renderRecordGroups() {
    initRecordGroups();
}