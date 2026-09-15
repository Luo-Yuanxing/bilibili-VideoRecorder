const POPUP_WINDOW_WIDTH = 450;
let popupWindowId = null;

chrome.windows.onFocusChanged.addListener(async windowId => {
    if (popupWindowId === null || windowId === popupWindowId) return;

    try {
        await chrome.windows.remove(popupWindowId);
    } catch (error) {
        console.debug('弹窗已关闭:', error);
    } finally {
        popupWindowId = null;
    }
});

chrome.windows.onRemoved.addListener(windowId => {
    if (windowId === popupWindowId) popupWindowId = null;
});

chrome.action.onClicked.addListener(async () => {
    if (popupWindowId !== null) {
        await chrome.windows.remove(popupWindowId).catch(() => {});
        popupWindowId = null;
    }

    const displays = await chrome.system.display.getInfo();
    const display = displays.find(item => item.isPrimary) || displays[0];
    const { workArea } = display;

    const popupWindow = await chrome.windows.create({
        url: 'popup.html',
        type: 'popup',
        width: POPUP_WINDOW_WIDTH,
        height: workArea.height,
        left: workArea.left + workArea.width - POPUP_WINDOW_WIDTH,
        top: workArea.top
    });
    popupWindowId = popupWindow.id;
});