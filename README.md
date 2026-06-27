# Pokemon TCG National Dex

静态 Pokemon TCG 全国图鉴。对外页面是 `index.html`，自用审核页面是 `review.html`。

页面只读取本地数据和本地图片，可以直接用 GitHub Pages 从 `main` 分支发布。

## 文件结构

```text
index.html                         对外展示页
app.js                             对外页逻辑
styles.css                         对外页样式
review.html                        自用审核页
review.js                          审核页逻辑
review.css                         审核页样式
local-data.js                      当前卡库数据
form-index.js                      宝可梦地区形态、Mega 等形态索引
assets/cards/                      本地卡图，统一高度 825px 的 WebP
assets/icons/                      PWA 图标
manifest.webmanifest               PWA manifest
sw.js                              Service Worker
```

## 常用脚本

```text
scripts/01-add-card-json.mjs                  主流程第 1 步：添加指定 TCGdex card id 的 JSON 信息，不下载图片
scripts/02-download-card-images.mjs           主流程第 2 步：按 JSON 里的 Scrydex 图源下载图片并转成本地 WebP
scripts/maintenance-refresh-all-json.mjs      维护：刷新全量本地卡牌 JSON 信息，不下载图片
scripts/maintenance-apply-review-results.mjs  维护：应用审核页保存的结果
scripts/tool-find-card.mjs                    工具：本地查卡
scripts/lib-version-utils.mjs                 公共库：写入 local-data.js 并同步缓存版本
```

## 添加新卡

添加新卡分两步。

第一步：生成或更新卡牌 JSON 信息。

```sh
node scripts/01-add-card-json.mjs swsh9-TG01 swsh12.5-GG01 sv10.5b-087
```

这个脚本只负责数据：

- 主要从 TCGdex API 获取卡牌 metadata
- 写入 `name`、`pokemonName`、`cardName`
- 写入 Scrydex 图片来源
- 不下载图片

第二步：按 JSON 里的图源下载图片。

```sh
REFRESH_IMAGE_IDS="swsh9-TG01,swsh12.5-GG01,sv10.5b-087" node scripts/02-download-card-images.mjs
```

如果要刷新全量 JSON：

```sh
node scripts/maintenance-refresh-all-json.mjs
```

如果要刷新全量图片：

```sh
node scripts/02-download-card-images.mjs
```

## 数据源规则

核心原则：

1. 本地卡牌 id 使用 TCGdex card id，例如 `me02.5-270`、`sv03.5-166`。
2. 卡牌 metadata 主要来自 TCGdex API。
3. 图片来源必须是 Scrydex。
4. 图片只拿 Scrydex 的 `/large`。
5. 不从其他网站兜底下载图片。
6. 禁止收录 Pokemon TCG Pocket。`A1/A2...`、`B1/B1a/B2...` 这类 Pocket 系列不属于实体卡。

TCGdex 查不到 metadata 的少量卡会使用已有本地 JSON 信息兜底，但图片规则仍然只用 Scrydex。

## 图片规则

本地图片统一保存为：

```text
assets/cards/{tcgdexCardId}.webp
```

尺寸和格式：

```text
height = 825px
width  = 按原图比例自动缩放
format = WebP
alpha  = 保留透明通道
```

每张卡必须记录图片来源：

```js
imageSource: {
  provider: "Scrydex",
  url: "https://images.scrydex.com/pokemon/swsh9tg-TG01/large"
}
```

允许的 `provider`：

```text
Scrydex
```

`02-download-card-images.mjs` 会：

- 只读取 `imageSource.url`
- 只尝试 Scrydex URL
- 自动尝试已知 Scrydex 路径修正规则
- 跳过 Scrydex 卡背占位图
- 下载后转成高度 825 的 WebP
- 保留 alpha
- 下载失败时保留已有本地图片，并在 summary 里汇报

运行 summary 会写到：

```text
tmp/02-download-card-images-summary.json
```

## Scrydex 路径规则

一般规则：

```text
三位数字卡号去掉首位 0: 046 -> 46
SV/TG/GG 子编号按对应子集规则保留大写前缀
SM 小数系列去掉点: sm7.5 -> sm75
非 SM 小数系列使用 pt: sv04.5 -> sv4pt5
```

已知特例：

```text
sv10.5b       -> zsv10pt5
sv10.5w       -> rsv10pt5
swsh4.5       -> swsh45
swsh4.5 SV    -> swsh45sv-SV001
swsh10.5      -> pgo-1
swsh9 TG      -> swsh9tg-TG01
swsh10 TG     -> swsh10tg-TG01
swsh11 TG     -> swsh11tg-TG01
swsh12 TG     -> swsh12tg-TG01
swsh12.5      -> swsh12pt5
swsh12.5 GG   -> swsh12pt5gg-GG01
```

示例：

```text
sv04.5-109     -> https://images.scrydex.com/pokemon/sv4pt5-109/large
me02.5-218     -> https://images.scrydex.com/pokemon/me2pt5-218/large
sm3.5-9        -> https://images.scrydex.com/pokemon/sm35-9/large
swsh4.5-SV001  -> https://images.scrydex.com/pokemon/swsh45sv-SV001/large
swsh12.5-GG70  -> https://images.scrydex.com/pokemon/swsh12pt5gg-GG70/large
```

## local-data.js

`local-data.js` 是当前项目的本地事实库。页面和审核页都只读它，不会自动联网更新。

顶层数据：

- `version`：本地数据版本，用来刷新浏览器缓存
- `generatedAt`：这份数据最初生成的时间
- `species`：全国图鉴 1-1025 的英文名
- `zhNames`：全国图鉴编号对应中文名
- `ptcgoCodesBySetName`：实体大系列名和 PTCGO code 的对应关系
- `setReleaseDates`：系列发行日，用来排序下拉菜单里的候选卡
- `cardsByDex`：按全国图鉴编号分组的卡片列表

每张卡保留这些字段：

```js
{
  id: "swsh9-TG01",
  name: "Flareon",
  pokemonName: "Flareon",
  cardName: "Flareon",
  image: "./assets/cards/swsh9-TG01.webp",
  form: { key: "base", label: "Base", shortLabel: "Std", rank: 0 },
  isShiny: false,
  backgroundType: "content",
  eraCode: "",
  setDisplayCode: "",
  ptcgoCode: "BRS",
  setId: "swsh9",
  setName: "Brilliant Stars",
  number: "TG01",
  printedNumber: "TG01/TG30",
  rarity: "Trainer Gallery Rare Holo",
  label: "TG",
  releaseDate: "2022-02-25",
  imageSource: {
    provider: "Scrydex",
    url: "https://images.scrydex.com/pokemon/swsh9tg-TG01/large"
  },
  rank: 1
}
```

`releaseDate` 是可选字段。普通大系列默认用 `setReleaseDates` 里的系列发行日，不需要每张卡都写。Promo 卡优先用价格记录里最早出现的日期作为单卡 `releaseDate`；查不到价格历史时，再用 promo 系列发行日兜底。

旧字段不要再写：

```text
fallbackImage
highImage
highFallbackImage
imageSources
updated
form.pattern
```

## 背景分类

每张卡都有：

```js
isShiny: true | false
backgroundType: "content" | "simple" | "other"
```

`backgroundType` 含义：

- `content`：背景有具体内容、场景、构图
- `simple`：背景是简单颜色、纹理、纯色或普通全图背景
- `other`：不是这两类，或者保留但不参与这两个背景分类

常见 label / rank：

```text
IR     Illustration rare             rank 1
SIR    Special Illustration Rare     rank 2
MAR    Mega Attack Rare              rank 2
TG     Trainer Gallery               rank 1
GG     Galarian Gallery              rank 1
FA     Ultra Rare                    rank 3
Promo  Promo                         rank 4
```

## 本地运行

直接打开：

```text
index.html
```

审核页面：

```text
review.html
```

如果想开本地服务：

```sh
python3 -m http.server 4178
```

然后访问：

```text
http://localhost:4178/
http://localhost:4178/review.html
```

## 查卡

先查本地库：

```sh
node scripts/tool-find-card.mjs "SV-JTG-184"
node scripts/tool-find-card.mjs "sv09-184"
node scripts/tool-find-card.mjs "Charizard"
node scripts/tool-find-card.mjs "MEW 166"
node scripts/tool-find-card.mjs "Ascended Heroes"
```

网页下拉里显示的格式：

```text
[EN] ME-ASC-270
[EN] SV-JTG-184
[EN] SWSH-BRS-154
[EN] SV-PROMO-129
```
