// DOM元素
const saveBtn = document.getElementById('saveGroup');
const recordList = document.getElementById('recordList');
const BVCodeInput = document.getElementById('BVCodeInput');
const notification = document.getElementById('notification');
const errorMessage = document.getElementById('errorMessage');
const recordCountInput = document.getElementById('recordCount');
const saveSettingBtn = document.getElementById('saveSetting');

// 数据结构
let recordsGroupList = [];
let recordsContent = [];
let expandedGroups = {};
let recentlyViewedCount = 3; // 默认最近观看记录数量

// 加载保存的数据
function loadData() {
    chrome.storage.sync.get(['recordsGroupList', 'recentlyViewedCount'], (data) => {
        if (data.recordsGroupList) {
            recordsGroupList = data.recordsGroupList;
        }
        if (data.recentlyViewedCount) {
            recentlyViewedCount = data.recentlyViewedCount;
            recordCountInput.value = recentlyViewedCount;
        }
        renderRecordGroups();
    });
}

// 渲染记录组列表
function renderRecordGroups() {
    recordList.innerHTML = '';

    if (recordsGroupList.length === 0) {
        recordList.innerHTML = '<div class="empty">暂无保存的记录组</div>';
        return;
    }

    recordsGroupList.forEach((group, index) => {
        const isExpanded = expandedGroups[group.BVCode] || false;
        const groupItem = document.createElement('div');
        groupItem.className = 'record-item';
        groupItem.innerHTML = `
          <h3 class="record-title">${group.title}</h3>

          <div class="record-bv">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 17V7L17 12L9 17Z" fill="currentColor"/>
              <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>${group.BVCode}</span>
          </div>

          <div class="watch-records ${isExpanded ? 'expanded' : ''}">
            ${group.records && group.records.length > 0
                ? group.records.map(record => `
                    <div class="record-entry">
                        <div class="record-info">
                            <a class="record-name" href="${record.url}" target="_blank" title="${record.name}">${record.name}</a>
                            <span class="record-date">${formatDate(record.timestamp)}</span>
                        </div>
                        <div class="progress-bar">
                            <div style="width:${record.progress}%"></div>
                        </div>
                    </div>`
                ).join('')
                : '<div class="empty-record">暂无观看记录</div>'
            }
          </div>

          <div class="actions">
            <button class="action-btn expand" data-bvcode="${group.BVCode}" data-type="expand">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <!-- 根据展开状态显示不同图标 -->
                ${isExpanded ?
                '<path d="M19 15L12 9L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' :
                '<path d="M19 9L12 15L5 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
            }
              </svg>
              ${isExpanded ? '收起' : '展开'}
            </button>
            <button class="action-btn delete" data-index="${index}" data-type="delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6V16.2C18 17.8802 18 18.7202 17.673 19.362C17.3854 19.9265 16.9265 20.3854 16.362 20.673C15.7202 21 14.8802 21 13.2 21H10.8C9.11984 21 8.27976 21 7.63803 20.673C7.07354 20.3854 6.6146 19.9265 6.32698 19.362C6 18.7202 6 17.8802 6 16.2V6M4 6H20M16 6L15.7294 5.18807C15.4671 4.40125 15.3359 4.00784 15.0927 3.71698C14.8779 3.46013 14.6021 3.26132 14.2905 3.13878C13.9376 3 13.516 3 12.6726 3H11.3274C10.484 3 10.0624 3 9.70951 3.13878C9.39792 3.26132 9.12208 3.46013 8.90729 3.71698C8.66405 4.00784 8.53292 4.40125 8.27064 5.18807L8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              删除
            </button>
          </div>
        `;
        recordList.appendChild(groupItem);
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

    if (type === 'delete') {
        // 询问是否删除
        if (!confirm('确定要删除这个记录组吗？')) return;
        recordsGroupList.splice(index, 1);
        // 删除展开状态
        if (expandedGroups[bvcode]) delete expandedGroups[bvcode];
        saveData();
        showNotification('记录组已删除！');
    } else if (type === 'expand') {
        // 切换展开状态
        expandedGroups[bvcode] = !expandedGroups[bvcode];
        // 重新渲染记录组列表（只更新变化的部分）
        renderRecordGroups();
    }
}
// 保存数据
function saveData() {
    chrome.storage.sync.set({ recordsGroupList }, () => {
        console.log('记录组已保存:', recordsGroupList);
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

// 添加新记录组
async function addNewRecordGroup() {

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
        const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${BVCode}`);
        if (!response.ok) {
            throw new Error('视频获取失败');
        }

        const data = await response.json();
        if (data.code !== 0) {
            throw new Error(data.message || '无法获取视频信息');
        }

        const title = data.data.title;

        recordsGroupList.push({
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

// 初始化和事件监听
document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // 保存按钮点击事件
    saveBtn.addEventListener('click', (event) => {
        event.preventDefault();
        hideError();
        addNewRecordGroup();
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
            addNewRecordGroup();
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
        // 更新所有现有记录组
        updateAllRecordGroups();
    });
}

// 更新所有记录组
function updateAllRecordGroups() {
    recordsGroupList.forEach(group => {
        if (group.records && group.records.length > recentlyViewedCount) {
            group.records = group.records.slice(0, recentlyViewedCount);
        }
    });
    saveData();
}

saveSettingBtn.addEventListener('click', saveSettings);
recordCountInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        saveSettings();
    }
});