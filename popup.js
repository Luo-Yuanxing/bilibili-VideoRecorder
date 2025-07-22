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
        }]*/
let recordsGroupMap = { "recordsGroupListSpecial": [], "recordsGroupListNormal": [] };
let recordsContent = [];
let expandedGroups = {};
let recentlyViewedCount = 3; // 默认最近观看记录数量
let dragSourceIndex = null;
let dragOverIndex = null;
let dragSourceGroup = null;
let dragOverGroup = null;
let lastClickedLink = null;

// 加载保存的数据
function loadData() {
    chrome.storage.sync.get(['recordsGroupMap', 'recentlyViewedCount', 'lastClickedLink'], (data) => {
        // 确保recordsGroupMap存在且符合预期格式
        if (data.recordsGroupMap && data.recordsGroupMap.recordsGroupListSpecial) {
            recordsGroupMap = data.recordsGroupMap;
        }
        if (data.recentlyViewedCount) {
            recentlyViewedCount = data.recentlyViewedCount;
            recordCountInput.value = recentlyViewedCount;
        }
        if (data.lastClickedLink) {
            lastClickedLink = data.lastClickedLink;
        }
        initRecordGroups();
        renderRecordGroups();
    });
}

// 初始化记录组列表
function initRecordGroups() {
    // 遍历 info.local 数组中的每个对象
    info.local.forEach(groupObj => {
        // 遍历每个对象中的键值对
        for (const [key, name] of Object.entries(groupObj)) {
            let recordsGroupListElement = document.createElement('div');
            recordsGroupListElement.className = 'section';
            recordsGroupListElement.innerHTML = `
                <div class="records-list">
                    <h3>${name}</h3>
                    <div id="${key}"></div>
                </div>`;
            const addGroupElement = document.getElementsByClassName('add-group')[0];
            if (addGroupElement) {
                addGroupElement.parentNode.insertBefore(recordsGroupListElement, addGroupElement.nextSibling);
            } else {
                document.body.appendChild(recordsGroupListElement);
            }
        }
    });
}

// 渲染记录组列表
function renderRecordGroups() {

    info.local.forEach(groupObj => {
        // 遍历每个对象中的键值对
        for (const [id, name] of Object.entries(groupObj)) {
            const recordList = document.getElementById(id);
            if (!recordList) continue; // 确保元素存在

            recordList.innerHTML = '';

            if (recordsGroupMap[id] && recordsGroupMap[id].length === 0) {
                recordList.innerHTML = '<div class="empty">暂无保存的记录组</div>';
                continue;
            }

            (recordsGroupMap[id] || []).forEach((recordCard, index) => {
                const isExpanded = expandedGroups[recordCard.BVCode] || false;
                const groupItem = document.createElement('div');
                groupItem.className = 'record-item';
                groupItem.innerHTML = `
                <div class="record-title-container">
                <div class="drag-handle" draggable="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 12H16" stroke="#99a2aa" stroke-width="2" stroke-linecap="round"/>
                    <path d="M8 8H16" stroke="#99a2aa" stroke-width="2" stroke-linecap="round"/>
                    <path d="M8 16H16" stroke="#99a2aa" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </div>
                    ${recordCard.upName ? `<span class="record-title">${recordCard.upName} - ${recordCard.title}</span>` : `<span class="record-title">${recordCard.title}</span>`}
                </div>

                <div class="record-bv">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 17V7L17 12L9 17Z" fill="currentColor"/>
                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                ${recordCard.sid ? `<span class="record-bvcode">SID: ${recordCard.sid}</span>` : `<span class="record-bvcode">BV: ${recordCard.BVCode}</span>`}
                </div>

                <div class="watch-records ${isExpanded ? 'expanded' : ''}">
                ${recordCard.records && recordCard.records.length > 0
                        ? recordCard.records.map(record => `
                    <div class="record-entry">
                    <div class="record-info">
                        <a class="record-name" href="${record.url}" target="_blank" title="${record.name}" data-progress="${record.progress}">${record.name}</a>
                        <span class="record-date">${formatDate(record.timestamp)}</span>
                    </div>
                    <div class="progress-bar">
                        <div style="width:${record.progress}%"></div>
                    </div>
                    </div>`
                        ).join('') : '<div class="empty-record">暂无观看记录</div>'
                    }
                </div>

                <div class="actions">
                <button class="action-btn expand" data-bvcode="${recordCard.BVCode}" data-type="expand">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    ${isExpanded ?
                        '<path d="M19 15L12 9L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' :
                        '<path d="M19 9L12 15L5 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
                    }
                    </svg>
                    ${isExpanded ? '收起' : '展开'}
                </button>
                <button class="action-btn delete" data-id="${id}" data-index="${index}" data-type="delete">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 6V16.2C18 17.8802 18 18.7202 17.673 19.362C17.3854 19.9265 16.9265 20.3854 16.362 20.673C15.7202 21 14.8802 21 13.2 21H10.8C9.11984 21 8.27976 21 7.63803 20.673C7.07354 20.3854 6.6146 19.9265 6.32698 19.362C6 18.7202 6 17.8802 6 16.2V6M4 6H20M16 6L15.7294 5.18807C15.4671 4.40125 15.3359 4.00784 15.0927 3.71698C14.8779 3.46013 14.6021 3.26132 14.2905 3.13878C13.9376 3 13.516 3 12.6726 3H11.3274C10.484 3 10.0624 3 9.70951 3.13878C9.39792 3.26132 9.12208 3.46013 8.90729 3.71698C8.66405 4.00784 8.53292 4.40125 8.27064 5.18807L8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    删除
                </button>
                </div>`;

                // 绑定拖拽事件
                const dragHandle = groupItem.querySelector('.drag-handle');
                dragHandle.addEventListener('dragstart', (e) => onDragStart(e, id, index));
                dragHandle.addEventListener('dragend', onDragEnd);

                groupItem.addEventListener('dragover', (e) => onDragOver(e, id, index));
                groupItem.addEventListener('dragleave', onDragLeave);
                groupItem.addEventListener('drop', (e) => onDrop(e, id, index));
                recordList.appendChild(groupItem);
            });
        }
    });

    // 添加事件监听器
    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', handleAction);
    });
}

// 处理按钮动作
function handleAction(e) {
    const bvcode = e.target.dataset.bvcode;
    const type = e.target.dataset.type;
    const index = e.target.dataset.index;
    const groupId = e.target.dataset.id; // 获取记录组ID

    if (type === 'delete') {
        if (!confirm('确定要删除这个卡片吗？')) return;
        // 从对应的记录组数组中删除
        recordsGroupMap[groupId].splice(index, 1);
        // 删除展开状态
        if (expandedGroups[bvcode]) delete expandedGroups[bvcode];
        saveData();
        showNotification('此卡片已删除！');
    } else if (type === 'expand') {
        // 切换展开状态
        expandedGroups[bvcode] = !expandedGroups[bvcode];
        // 重新渲染记录组列表
        renderRecordGroups();
    }
}

// 保存数据
function saveData() {
    chrome.storage.sync.set({ recordsGroupMap }, () => {
        console.log('记录组已保存:', recordsGroupMap);
        renderRecordGroups();
    });
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

// 检测是否是特殊合集类型
// 检测url中参数p=1于p=2页面的title是否相同，相同则是普通合集，不同则是特殊合集
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
        const video_pod__item = doc.querySelector('.video-pod__item');
        if (!video_pod__item) {
            // 单视频页面，不是特殊合集
            return false;
        }
        if (video_pod__item.getAttribute('data-key') !== BVCode) {
            // 视频与BV号不匹配
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
        const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${BVCode}`);
        if (!response.ok) {
            throw new Error('视频获取失败');
        }

        const data = await response.json();
        if (data.data.bvid !== BVCode) {
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
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('视频请求失败');
        }
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const collectionElement = doc.querySelector('.video-pod__header .header-top .left a');
        if (!collectionElement) {
            throw new Error('未找到合集链接');
        }
        // https://space.bilibili.com/1837617/channel/collectiondetail?sid=127155&spm_id_from=333.788.0.0
        const sidMatch = collectionElement.href.match(/sid=(\d+)/);
        if (!sidMatch) {
            throw new Error('合集SID未找到');
        }
        const sid = sidMatch[1];
        // 获取空间ID：1837617
        const spaceIdMatch = collectionElement.href.match(/space.bilibili.com\/(\d+)/);
        if (!spaceIdMatch) {
            throw new Error('空间ID未找到');
        }
        const spaceId = spaceIdMatch[1];

        // 获取title a.textContent
        const title = collectionElement.textContent.trim();
        if (!title) {
            throw new Error('合集标题未找到');
        }

        // 请求up名字
        const spaceResponse = await fetch(`https://space.bilibili.com/${spaceId}`);
        if (!spaceResponse.ok) {
            throw new Error('UP主信息请求失败');
        }
        const spaceHtml = await spaceResponse.text();
        const spaceDoc = new DOMParser().parseFromString(spaceHtml, 'text/html');
        const upNameElement = spaceDoc.querySelector('title');
        if (!upNameElement) {
            throw new Error('UP主名称未找到');
        }
        // e.g. 薄海纸鱼的个人空间-薄海纸鱼个人主页-哔哩哔哩视频
        const upName = upNameElement.textContent.split('-')[0].trim().replace(/的个人空间|个人主页|视频/g, '').trim();

        return {
            sid: sid,
            spaceId: spaceId,
            title: title,
            upName: upName,
        };
    } catch (error) {
        console.error('获取合集信息失败:', error);
        return null;
    }

}

// 初始化和事件监听
document.addEventListener('DOMContentLoaded', () => {
    loadData();

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
        if (e.target.matches('.record-name')) {
            e.preventDefault();
            const url = e.target.href;
            chrome.storage.sync.set({
                lastClickedLink: {
                    url: url,
                    progress: e.target.dataset.progress || 0
                }
            }, () => {
                console.log('最后点击的链接已保存:', { url: url, progress: e.target.dataset.progress || 0 });
            });
            // 打开新标签页
            chrome.tabs.create({ url: url });
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
    const newCount = parseInt(recordCountInput.value);
    if (isNaN(newCount) || newCount < 1 || newCount > 50) {
        showError('请输入1-50之间的有效数字');
        return;
    }

    recentlyViewedCount = newCount;
    chrome.storage.sync.set({ recentlyViewedCount }, () => {
        showNotification('设置已保存！');
    });
}

// 更新所有记录组
function updateAllRecordGroups() {
    for (const id in recordsGroupMap) {
        const group = recordsGroupMap[id];
        if (group && Array.isArray(group)) {
            group.forEach(record => {
                if (record.records && record.records.length > recentlyViewedCount) {
                    record.records = record.records.slice(0, recentlyViewedCount);
                }
            });
        }
    }
    saveData();
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
    dragOverGroup = group;  // 设置目标组
    dragOverIndex = index;  // 设置目标索引

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

    // 确保源组和目标组相同（同组内拖拽）
    if (dragSourceGroup === group && sourceIndex !== null && targetIndex !== null && sourceIndex !== targetIndex) {
        const groupArray = recordsGroupMap[group];  // 使用传入的group参数

        // 根据拖拽位置确定放置位置
        const isTop = e.currentTarget.classList.contains('drag-over-top');
        const finalPosition = isTop ? targetIndex : targetIndex + 1;

        // 移动数组元素
        const movedItem = groupArray.splice(sourceIndex, 1)[0];
        groupArray.splice(finalPosition, 0, movedItem);

        saveData();
        showNotification('记录组已重新排序');
    }
    onDragEnd();
    return false;
}

// 清除缓存按钮事件
clearCacheBtn.addEventListener('click', () => {
    if (confirm('确定要清空所有存储数据吗？此操作不可撤销。')) {
        chrome.storage.sync.clear(() => {
            recordsGroupMap = { "recordsGroupListSpecial": [], "recordsGroupListNormal": [] };
            expandedGroups = {};
            recentlyViewedCount = 3; // 重置默认值
            loadData();
            showNotification('所有存储数据已清空！');
        });
        recordCountInput.value = 3;
        // 刷新插件
        chrome.runtime.reload();
    }
});