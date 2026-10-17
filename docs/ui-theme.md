# 标题与界面外观配置

控制台的标题、副标题、字体、字号、颜色、透明度，以及页面底色和方格样式，都写在：

```text
public/ui-theme.json
```

修改后**刷新控制台**即可生效，不需要重启服务；如果仍显示旧样式，按 `Ctrl + F5` 强制刷新。这个文件只影响控制台，不控制叠加层里的频谱颜色。

## 快速修改

- 改标题文字、字号、颜色、渐隐：编辑 `title`。
- 改「Audio Visualizer Web」副标题：编辑 `subtitle`。
- 改页面基础字体和文字颜色：编辑 `interface`。
- 改奶白底色、方格大小和透明度：编辑 `background`。

## 字段说明

### 大标题 `title`

| 字段 | 作用 | 示例 |
| --- | --- | --- |
| `text` | 标题文字，同时更新浏览器标签页标题 | `"音频可视化网页推流"` |
| `fontFamily` | 字体或字体栈 | `"\"Microsoft YaHei\", sans-serif"` |
| `fontSize` | 字号，可写固定值或响应式 `clamp()` | `"72px"`、`"clamp(30px, 8.4vw, 84px)"` |
| `fontWeight` | 字重 | `700`、`800`、`900` |
| `color` | 颜色 | `"#0c1712"`、`"rgba(12,23,18,.9)"` |
| `opacity` | 整体透明度，`0`–`1` | `1` |
| `letterSpacing` | 字间距 | `"0.035em"` |
| `lineHeight` | 行高 | `1.02` |
| `fadeStart` | 从标题高度百分之几开始变透明 | `55` |
| `fadeEnd` | 到百分之几完全透明，需大于 `fadeStart` | `95` |

标题通过纵向遮罩实现下部渐隐。当前配置从 55% 开始变淡、到 95% 完全透明，副标题位于标题底部的渐隐区域。

标题默认单行显示。字号过大可能超出页面宽度，修改后请同时检查手机端。

### 副标题 `subtitle`

| 字段 | 作用 | 示例 |
| --- | --- | --- |
| `text` | 副标题文字 | `"Audio Visualizer Web"` |
| `fontFamily` | 副标题字体 | `"\"Segoe UI\", sans-serif"` |
| `fontSize` | 字号 | `"20px"`、`"clamp(12px, 1.35vw, 20px)"` |
| `fontWeight` | 字重 | `600` |
| `color` | 颜色 | `"#1b6b50"` |
| `opacity` | 透明度，`0`–`1` | `0.9` |
| `letterSpacing` | 字间距 | `"0.24em"` |

副标题固定在大标题底部，字号调得过大时可能与标题下缘重叠，建议边改边刷新查看。

### 页面字体与文字颜色 `interface`

| 字段 | 作用 |
| --- | --- |
| `fontFamily` | 页面基础字体，影响按钮、标签和说明文字 |
| `textColor` | 主要文字颜色 |
| `mutedColor` | 次要说明文字颜色 |

### 背景与方格 `background`

| 字段 | 作用 | 说明 |
| --- | --- | --- |
| `color` | 页面底色 | 默认 `#fffdf7` |
| `gridColor` | 方格颜色 | 默认 `#24ffc8` |
| `gridSize` | 方格边长 | 单位像素，写数字，例如 `38` |
| `gridMinOpacity` | 页面中间方格透明度 | `0`–`1`，默认 `0.05` |
| `gridMaxOpacity` | 左下 / 右上角方格最大透明度 | `0`–`1`，默认 `0.3` |

方格由两层组成：全页统一使用 `gridMinOpacity`，左下角和右上角再叠加一层，最高到 `gridMaxOpacity`。

## 修改示例

下面只列出常用字段，修改时请保留原文件中的其他字段：

```json
{
  "title": {
    "text": "音频可视化网页推流",
    "fontSize": "72px",
    "fontWeight": 900,
    "color": "#10251c",
    "opacity": 1,
    "fadeStart": 60,
    "fadeEnd": 96
  },
  "subtitle": {
    "fontSize": "18px",
    "color": "#1f7a5b",
    "opacity": 0.9
  },
  "background": {
    "color": "#fffdf7",
    "gridSize": 44,
    "gridMinOpacity": 0.05,
    "gridMaxOpacity": 0.28
  }
}
```

## 注意

- JSON 不支持注释，键名和字符串必须使用英文双引号 `"`，最后一项后不能多写逗号。
- 字体栈里的双引号需要转义，例如 `\"Microsoft YaHei\"`。
- `opacity` 使用 `0`–`1`，不是百分比。
- `fadeEnd` 应大于 `fadeStart`，否则脚本会自动把它调整为比 `fadeStart` 大 1。
- 如果改完没有变化，先检查 JSON 格式，再用 `Ctrl + F5` 刷新；浏览器控制台会提示读取失败原因。
- 想恢复默认外观，把各字段改回本文档中的示例值即可。
