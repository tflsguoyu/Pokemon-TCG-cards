# Pokemon TCG National Dex

静态 Pokemon TCG 全国图鉴。对外页面是 `index.html`，自用审核页面是 `review.html`。

页面只读取本地数据；本地开发时读取 `assets/cards`，GitHub Pages 上会自动从 GitHub Releases 读取卡图。

## 文件结构

```text
index.html                         对外展示页
app.js                             对外页逻辑
styles.css                         对外页样式
tags.html                          内容标签浏览页
tags.js                            内容标签页逻辑
tags.css                           内容标签页样式
review.html                        自用审核页
review.js                          审核页逻辑
review.css                         审核页样式
local-data.js                      当前卡库数据
form-index.js                      宝可梦地区形态、Mega 等形态索引
assets/cards/                      本地卡图，统一高度 825px 的 WebP
asset-config.js                    线上卡图地址配置，把本地卡图路径映射到 GitHub Releases
assets/icons/                      PWA 图标
manifest.webmanifest               PWA manifest
sw.js                              Service Worker
```

## 常用脚本

```text
scripts/01-add-card-json.mjs                  主流程第 1 步：添加指定 TCGdex card id 的 JSON 信息，不下载图片
scripts/02-download-card-images.mjs           主流程第 2 步：按 JSON 里的图片图源下载图片并转成本地 WebP
scripts/03-upload-release-assets.mjs          把本地卡图按分组上传到 GitHub Releases
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
- 写入 `cardName`
- 写入英文实体卡的 Scrydex 图片来源
- 不下载图片

简体中文独占卡目前以手动整理为主，图片来源优先使用 Pokemon.cn。

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

1. 英文卡本地 id 使用 TCGdex card id，例如 `me02.5-270`、`sv03.5-166`。
2. 简体中文独占卡使用自定义小写 id，例如 `cbb1c-07-09`、`151c-170`。
3. 英文卡 metadata 主要来自 TCGdex API；简体中文独占卡以本地整理为准。
4. 英文实体卡图片来源必须是 Scrydex。
5. 简体中文独占卡图片来源优先使用 Pokemon.cn；少量尚未替换的旧图可暂时保留 PokiPair。
6. Scrydex 图片只拿 `/large`；Pokemon.cn 和 PokiPair 图片只拿记录的原始 URL。
7. 不从其他网站兜底下载图片。
8. 禁止收录 Pokemon TCG Pocket。`A1/A2...`、`B1/B1a/B2...` 这类 Pocket 系列不属于实体卡。

TCGdex 查不到 metadata 的少量卡会使用已有本地 JSON 信息兜底，但图片规则仍然只允许 Scrydex、Pokemon.cn 或 PokiPair。

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

## GitHub Releases 卡图托管

GitHub Pages 站点大小建议控制在 1GB 以内，所以卡图不要跟页面一起发布。线上页面会通过 `asset-config.js` 把：

```text
./assets/cards/sv04.5-127.webp
```

映射成：

```text
https://github.com/tflsguoyu/Pokemon-TCG-cards/releases/download/card-assets-sv/sv04.5-127.webp
```

当前分 3 个 Release，保证每个 release 附件数低于 GitHub 的 1000 个上限：

```text
card-assets-sv        sv/svp/csv/cs/cbb/151c 开头的卡图
card-assets-swsh-me   swsh/me/mep 开头的卡图
card-assets-legacy    其他旧系列卡图
```

先确认分组数量：

```sh
node scripts/03-upload-release-assets.mjs
```

登录 GitHub CLI 后上传：

```sh
node scripts/03-upload-release-assets.mjs --execute
```

本地预览默认继续使用 `assets/cards`。如果要在本地强制测试 Release 图片，在 URL 后加：

```text
?assets=release
```

允许的 `provider`：

```text
Scrydex
Pokemon.cn
PokiPair
```

简体中文独占卡优先使用 Pokemon.cn 图源：

```js
imageSource: {
  provider: "Pokemon.cn",
  url: "https://image.pokemon.com.cn/..."
}
```

`02-download-card-images.mjs` 会：

- 只读取 `imageSource.url`
- 只尝试允许来源的 URL
- 简体中文卡只允许 Pokemon.cn 或 PokiPair URL，拿不到就汇报缺图，不自动尝试其他网站
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
- `generatedAt`：最近一次写入 `local-data.js` 的时间
- `species`：全国图鉴 1-1025 的英文名
- `species_cn`：全国图鉴编号对应中文名；`9999` 用作简中独占训练家 / 物品卡的临时分组
- `setsById`：按 `setId` 存放系列级信息，包括英文系列名、PTCGO code、总张数和发行日
- `cardsByDex`：按全国图鉴编号分组的卡片列表

系列信息集中写在 `setsById`：

```js
[
  [
    "swsh9",
    {
      eraCode: "SWSH",
      ptcgoCode: "BRS",
      name: "Brilliant Stars",
      total: "172",
      releaseDate: "2022-02-25"
    }
  ]
]
```

每张卡保留这些字段：

```js
{
  id: "swsh9-TG01",
  language: "EN",
  cardName: "Flareon",
  image: "./assets/cards/swsh9-TG01.webp",
  form: { key: "base", label: "Base", rank: 0 },
  isShiny: false,
  backgroundType: "content",
  tags: ["forest", "trees", "flowers", "solo", "peaceful", "green"],
  setId: "swsh9",
  number: "TG01",
  rarity: "Trainer Gallery Rare Holo",
  label: "TG",
  imageSource: {
    provider: "Scrydex",
    url: "https://images.scrydex.com/pokemon/swsh9tg-TG01/large"
  },
  rank: 1
}
```

`dexIds` 和 `primaryDexId` 只在一张卡对应多个全国图鉴编号时使用，比如 Tag Team。卡片实体只保留一份；页面加载时会用 `dexIds` 动态挂到多个宝可梦下面。

```js
{
  id: "sm9-162",
  cardName: "Pikachu & Zekrom GX",
  dexIds: [25, 644],
  primaryDexId: 25
}
```

`releaseDate` 是可选的单卡发行日，只在有精确到日且不同于系列发行日时才写。默认排序使用 `setsById` 里的系列发行日；不要写 `YYYY-MM-01` 这类月度占位日期。

`printedNumber` 不再逐卡保存；显示时由 `number` 和 `setsById[setId].total` 组合出来。没有 `total` 的系列只显示 `number`。

部分简中卡面会用类似 `0709/09` 的变种编号。这里 `07` 是主编号，`09/09` 是这张主卡的第 9 个变种 / 共 9 个变种。这类卡写成：

```js
{
  id: "cbb1c-07-09",
  setId: "cbb1c",
  number: "07",
  variant: { number: "09", total: "09" }
}
```

显示时会派生成 `0709/09`；菜单和查找 code 会显示成 `7-9`。

这些字段不要写在单张卡里；系列级信息统一放在 `setsById`，显示字段运行时派生：

```text
eraCode
ptcgoCode
setName
setDisplayCode
printedNumber
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
tags: string[]
```

`backgroundType` 含义：

- `content`：背景有具体内容、场景、构图
- `simple`：背景是简单颜色、纹理、纯色或普通全图背景
- `other`：不是这两类，或者保留但不参与这两个背景分类

`tags` 只给 `backgroundType: "content"` 的卡使用，用来描述图面内容。标签使用英文小写短词组，优先服务搜索和主题页浏览；不要重复写已有 metadata，例如系列名、稀有度、卡牌编号。

标签类型包括：

```text
场景地点        forest, beach, underwater, city, room, garden, mountain
自然元素        trees, leaves, flowers, water, clouds, moon, stars, snow
人造物 / 道具   window, bed, books, food, table, bridge, train, lamp
动作状态        sleeping, eating, flying, swimming, playing, resting
关系构图        solo, pair, group, partner, trainer, close-up, wide shot
情绪氛围        cute, cozy, peaceful, playful, lonely, mysterious, epic
视觉风格        simple, minimal, colorful, pastel, dark, soft, graphic
颜色            pink, blue, green, yellow, purple, red, white, warm colors
时间 / 光线     day, night, sunset, moonlight, sunlight, glowing, shadow
生物主题        bird, fish, cat, dog, dragon, bug, mouse, turtle
```

不要使用收藏主题标签，例如 `starter`、`eeveelution`、`legendary`、`tag team`、`trainer gallery`。

分批应用 tags：

```sh
node scripts/maintenance-apply-content-tags.mjs tmp/content-tags-batch-001.json
```

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
