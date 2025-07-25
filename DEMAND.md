# DEMAND 管理手册

**最后同步版本**：v1.8.3 (2025-07-22)  
**核心关注分支**：

- 🌱 `main`

## 📦 需求池 [总 4 条]

| ID  | 需求摘要                                 | 提出时间   | 所属分支 | 状态标签 | 负责人        |
| --- | ---------------------------------------- | ---------- | -------- | -------- | ------------- |
| D-1 | 记录组分为两种类型（可扩展）             | 2025-07-22 | main     | 完成     | @Luo-Yuanxing |
| D-2 | 增加自动跳转到上次播放位置               | 2025-07-22 | main     | 完成     | @Luo-Yuanxing |
| D-3 | 修复同一视频记录不覆盖的问题             | 2025-07-22 | main     | 完成     | @Luo-Yuanxing |
| D-4 | 完成普通合集类型记录                     | 2025-07-22 | main     | 完成     | @Luo-Yuanxing |
| D-5 | 防止重复添加卡片                         | 2025-07-22 | main     | 完成     | @Luo-Yuanxing |
| D-6 | 点击任意一个展开按钮，其余全部展开       | 2025-07-23 | main     | 完成     | @Luo-Yuanxing |
| D-7 | 首次安装无法获取设置中"最近观看记录数量" | 2025-07-23 | main     | 完成     | @Luo-Yuanxing |
| D-8 | B站视频切换不刷新页面，导致记录更新错误  | 2025-07-23 | main     | 完成     | @Luo-Yuanxing |

### 🔖 [D-1] 记录组分为两种类型（可扩展）

**提出背景**：  
根据实际，目前 B 站存在两种不同类型的合集，需要按不同数据结构存储，以方便后续开发

**技术方案**：

1. 将原 recordsGroupList 更名为 recordsGroupMap
2. recordsGroupMap 结构为 `{"recordsGroupListSpecial": [], "recordsGroupListNormal": []}`

### 🔖 [D-2] 增加自动跳转到上次播放位置

**提出背景**：  
点击链接后不会恢复到上次播放位置

**技术方案**：

1. 用户点击链接后，popup 负责记录用户点击的视频，存储于 chrome
2. content.js 在页面加载完毕后从 chrome 获取需要刷新的视频，比较当前页面视频，匹配成功则从 record 中获取时间数据进行跳转

### 🔖 [D-3] 修复同一视频记录不覆盖的问题

**提出背景**：  
在同一视频页面多次点击记录按钮，导致记录重复

**技术方案**：

1. 在记录视频时，先检查该视频是否已存在于记录中
2. 如果已存在，则更新该记录的时间戳和其他信息；如果不存在，则新增记录

### 🔖 [D-4] 完成普通合集类型记录

**提出背景**：  
目前仅支持特殊合集类型，需增加对普通合集的支持

### 🔖 [D-5] 防止重复添加卡片

**提出背景**：  
在添加记录时，可能会出现重复添加相同合集卡片的情况

**技术方案**：

1. 在添加记录前，检查当前记录组中是否已存在相同的合集卡片
2. 如果存在，则提示用户并阻止重复添加；如果不存在，则正常添加

### 🔖 [D-6] 点击任意一个展开按钮，其余全部展开

**提出背景**：  
发现在点击某个记录组的展开按钮时，其他记录组自动展开，导致界面混乱

**技术方案**：

1. 生成唯一标识键 `recordKey` （特殊合集用 BVCode，普通合集用 sid+spaceId）

### 🔖 [D-7] 首次安装无法获取设置中"最近观看记录数量"

**提出背景**：  
在首次安装扩展时，无法正确获取用户设置中的"最近观看记录数量"。

**技术方案**：

1. 初始化chrome.storage内容，在初始化时检查是否存在 `recentlyViewedCount`，如果不存在则设置默认值为 3。

### 🔖 [D-7] B站视频切换不刷新页面，导致记录更新错误
**提出背景**：  
在 B 站视频切换时，页面不会自动刷新，导致记录更新不正确