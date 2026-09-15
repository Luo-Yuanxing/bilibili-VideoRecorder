// DOM元素
const saveBtn = document.getElementById('saveGroup');
const BVCodeInput = document.getElementById('BVCodeInput');
const notification = document.getElementById('notification');
const errorMessage = document.getElementById('errorMessage');
const recordCountInput = document.getElementById('recordCount');
const saveSettingBtn = document.getElementById('saveSetting');
const clearCacheBtn = document.getElementById('clearCache');

// 数据结构
// 控制页面内容
let info = { "local": [{ "recordsGroupListSpecial": "特殊记录组", "recordsGroupListNormal": "普通记录组" }] };
// 用于存储记录组数据
/* recordsGroupListSpecial 结构为 [{
            title: title,
            BVCode: BVCode,
            records: []
        }] 
    recordsGroupListNormal 结构为 [{
            title: title,
            sid: sid,
            spaceId: spaceId,
            records: []
        }]
*/
let recordsGroupMap = { "recordsGroupListSpecial": [], "recordsGroupListNormal": [] };
let expandedGroups = {};
let recentlyViewedCount = 3; // 默认最近观看记录数量
let dragSourceIndex = null;
let dragOverIndex = null;
let dragSourceGroup = null;
let lastClickedLink = null;

// 加载保存的数据
function loadData() {
    Promise.all([
        storageGet(recordsStorage, ['recordsGroupMap']),
        storageGet(chrome.storage.sync, ['recordsGroupMap', 'recentlyViewedCount', 'lastClickedLink'])
    ]).then(([recordData, settings]) => {
        const data = {
            ...settings,
            recordsGroupMap: recordData.recordsGroupMap ?? settings.recordsGroupMap
        };
        // 确保recordsGroupMap存在且符合预期格式
        recordsGroupMap = normalizeRecordsGroupMap(data.recordsGroupMap);
        recentlyViewedCount = normalizeRecentlyViewedCount(data.recentlyViewedCount);
        recordCountInput.value = recentlyViewedCount;
        if (data.lastClickedLink) {
            lastClickedLink = data.lastClickedLink;
        }
        initRecordGroups();
        renderRecordGroups();
    }).catch(error => showError(`读取数据失败：${error.message}`));
}

// 初始化记录组列表
function initRecordGroups() {
    // 遍历 info.local 数组中的每个对象
    info.local.forEach(groupObj => {
        // 遍历每个对象中的键值对
        for (const [key, name] of Object.entries(groupObj)) {
            if (document.getElementById(key)) return;
            const recordsGroupListElement = document.createElement('div');
            recordsGroupListElement.className = 'section';
            const recordsList = document.createElement('div');
            recordsList.className = 'records-list';
            const heading = document.createElement('h3');
            heading.textContent = name;
            const list = document.createElement('div');
            list.id = key;
            recordsList.append(heading, list);
            recordsGroupListElement.appendChild(recordsList);
            const addGroupElement = document.getElementsByClassName('add-group')[0];
            if (addGroupElement) {
                addGroupElement.parentNode.insertBefore(recordsGroupListElement, addGroupElement.nextSibling);
            } else {
                document.body.appendChild(recordsGroupListElement);
            }
        }
    });
    info.local.forEach(groupObj => Object.keys(groupObj).forEach(id => {
        const recordList = document.getElementById(id);
        if (!recordList) return;
        recordList.replaceChildren();
        const groups = recordsGroupMap[id] || [];
        if (groups.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = '暂无保存的记录组';
            recordList.appendChild(empty);
            return;
        }

        groups.forEach((recordCard, index) => {
            const recordKey = id === 'recordsGroupListSpecial'
                ? `special_${recordCard.BVCode}`
                : `normal_${recordCard.sid}_${recordCard.spaceId}`;
            const isExpanded = expandedGroups[recordKey] || false;
            const groupItem = document.createElement('div');
            groupItem.className = 'record-item';

            const titleContainer = document.createElement('div');
            titleContainer.className = 'record-title-container';
            const dragHandle = document.createElement('div');
            dragHandle.className = 'drag-handle';
            dragHandle.draggable = true;
            const title = document.createElement('span');
            title.className = 'record-title';
            title.textContent = recordCard.upName ? `${recordCard.upName} - ${recordCard.title}` : (recordCard.title || '未命名记录组');
            titleContainer.append(dragHandle, title);

            const code = document.createElement('div');
            code.className = 'record-bv';
            const codeText = document.createElement('span');
            codeText.className = 'record-bvcode';
            codeText.textContent = recordCard.sid ? `SID: ${recordCard.sid}` : `BV: ${recordCard.BVCode || ''}`;
            code.appendChild(codeText);

            const watchRecords = document.createElement('div');
            watchRecords.className = `watch-records${isExpanded ? ' expanded' : ''}`;
            const records = Array.isArray(recordCard.records) ? recordCard.records : [];
            if (records.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'empty-record';
                empty.textContent = '暂无观看记录';
                watchRecords.appendChild(empty);
            } else {
                records.forEach(record => {
                    const entry = document.createElement('div');
                    entry.className = 'record-entry';
                    const infoElement = document.createElement('div');
                    infoElement.className = 'record-info';
                    const link = document.createElement('a');
                    link.className = 'record-name';
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = record.name || '未命名视频';
                    link.title = link.textContent;
                    link.dataset.progress = String(record.progress ?? 0);
                    try {
                        const recordUrl = new URL(record.url);
                        if (recordUrl.protocol === 'https:' && (recordUrl.hostname === 'bilibili.com' || recordUrl.hostname.endsWith('.bilibili.com'))) {
                            link.href = recordUrl.toString();
                        }
                    } catch (error) {
                        link.removeAttribute('href');
                    }
                    const date = document.createElement('span');
                    date.className = 'record-date';
                    date.textContent = formatDate(record.timestamp);
                    infoElement.append(link, date);
                    const progressBar = document.createElement('div');
                    progressBar.className = 'progress-bar';
                    const progress = document.createElement('div');
                    progress.style.width = `${Math.max(0, Math.min(100, Number(record.progress) || 0))}%`;
                    progressBar.appendChild(progress);
                    entry.append(infoElement, progressBar);
                    watchRecords.appendChild(entry);
                });
            }

            const actions = document.createElement('div');
            actions.className = 'actions';
            const expandButton = document.createElement('button');
            expandButton.className = 'action-btn expand';
            expandButton.dataset.key = recordKey;
            expandButton.dataset.type = 'expand';
            expandButton.textContent = isExpanded ? '收起' : '展开';
            const deleteButton = document.createElement('button');
            deleteButton.className = 'action-btn delete';
            deleteButton.dataset.id = id;
            deleteButton.dataset.index = String(index);
            deleteButton.dataset.type = 'delete';
            deleteButton.textContent = '删除';
            actions.append(expandButton, deleteButton);
            groupItem.append(titleContainer, code, watchRecords, actions);

            dragHandle.addEventListener('dragstart', event => onDragStart(event, id, index));
            dragHandle.addEventListener('dragend', onDragEnd);
            groupItem.addEventListener('dragover', event => onDragOver(event, id, index));
            groupItem.addEventListener('dragleave', onDragLeave);
            groupItem.addEventListener('drop', event => onDrop(event, id, index));
            recordList.appendChild(groupItem);
        });
    }));
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
        recordsGroupMap[groupId].splice(index, 1);
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
    enqueueRecordsGroupMapUpdate(() => recordsGroupMap).then(nextMap => {
        recordsGroupMap = nextMap;
        console.log('记录组已保存:', recordsGroupMap);
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

// 添加新记录组 -- 特殊合集
async function addNewRecordGroupForSpecial() {

    const BVCode = BVCodeInput.value.trim();

    if (!BVCode) {
        showError('请输入BV号');
        return;
    }

    // 校验BV号格式
    if (!/^BV\w{10}$/i.test(BVCode)) {
        showError('BV号格式不正确，格式应为BV后跟10位字母数字');
        return;
    }

    if (!await isSpecialCollection(BVCode)) {
        showError('该BV号似乎不是特殊合集类型');
        return;
    }

    // 显示加载状态
    const oldBtnText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<div class="spinner"></div>';
    saveBtn.disabled = true;

    try {
        const data = await fetchJsonWithTimeout(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(BVCode)}`, {
            timeoutMs: 8000
        });

        if (data.code !== 0 || !data.data || data.data.bvid !== BVCode) {
            throw new Error(data.message || '无法获取视频信息');
        }

        const title = data.data.title;

        // 检查是否已存在同BVCode记录组
        const existingGroup = recordsGroupMap['recordsGroupListSpecial'].find(group => group.BVCode === BVCode);
        if (existingGroup) {
            showError('该特殊合集已存在，请勿重复添加');
            return;
        }

        recordsGroupMap['recordsGroupListSpecial'].push({
            title: title,
            BVCode: BVCode,
            records: []
        });

        BVCodeInput.value = '';
        saveData();
        showNotification('记录组已成功添加！');
    } catch (error) {
        showError(error.message);
        console.error('获取视频信息失败:', error);
    } finally {
        // 恢复按钮状态
        saveBtn.innerHTML = oldBtnText;
        saveBtn.disabled = false;
    }
}

// 添加新记录组 -- 普通合集
async function addNewRecordGroupForNormal() {
    const BVCode = BVCodeInput.value.trim();

    if (!BVCode) {
        showError('请输入BV号');
        return;
    }

    // 校验BV号格式
    if (!/^BV\w{10}$/i.test(BVCode)) {
        showError('BV号格式不正确，格式应为BV后跟10位字母数字');
        return;
    }

    // 显示加载状态
    const oldBtnText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<div class="spinner"></div>';
    saveBtn.disabled = true;

    try {
        // 检验是否为普通合集
        const isSpecial = await isSpecialCollection(BVCode);
        if (isSpecial) {
            throw new Error('该BV号是特殊合集，请使用特殊合集功能添加');
        }

        // 获取合集信息
        /**
         * collectionInfo =
        {
            sid: sid,
            spaceId: spaceId,
            title: title,
            upName: upName,
        };
         */
        const collectionInfo = await getCollectionInfo(BVCode);
        if (!collectionInfo) {
            throw new Error('获取合集信息失败，请检查BV号是否正确');
        }

        // 检查是否已存在同sid记录组
        const existingGroup = recordsGroupMap['recordsGroupListNormal'].find(group => group.sid === collectionInfo.sid);
        if (existingGroup) {
            showError('该合集已存在，请勿重复添加');
            return;
        }

        recordsGroupMap['recordsGroupListNormal'].push({
            sid: collectionInfo.sid,
            spaceId: collectionInfo.spaceId,
            title: collectionInfo.title,
            upName: collectionInfo.upName,
            records: []
        });

        BVCodeInput.value = '';
        saveData();
        showNotification('记录组已成功添加！');

    } catch (error) {
        showError(error.message);
        console.error('获取合集信息失败:', error);
    }
    finally {
        // 恢复按钮状态
        saveBtn.innerHTML = oldBtnText;
        saveBtn.disabled = false;
    }


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
                '特殊合集：多P系列视频，共享相同标题' :
                '一般合集：单视频或多视频合集';
        });
    });

    // 保存按钮点击事件
    saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        hideError();
        // 获取选择的类型
        const selectedType = document.querySelector('.type-option.selected').dataset.type;

        if (selectedType === 'special') {
            addNewRecordGroupForSpecial();
        } else if (selectedType === 'normal') {
            addNewRecordGroupForNormal();
        }
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
            addNewRecordGroupForSpecial();
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
        const groupArray = recordsGroupMap[group];
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
            new Promise((resolve, reject) => recordsStorage.clear(() => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message)); else resolve();
            })),
            new Promise((resolve, reject) => chrome.storage.sync.clear(() => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message)); else resolve();
            }))
        ]).then(() => {
            recordsGroupMap = normalizeRecordsGroupMap();
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