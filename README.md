# Pokemon TCG National Dex

静态 Pokemon TCG 全国图鉴。对外页面是 `index.html`，自用审核页面是 `review.html`，标签浏览页是 `tags.html`。

页面只读取本地数据。开发时图片来自 `assets/cards`；GitHub Pages 上通过 `asset-config.js` 自动改用 GitHub Releases 里的卡图。

## 常用流程

### 添加英文实体卡

第一步：从 TCGdex 获取 metadata，写入 `local-data.js`。

```sh
node scripts/01-add-card-json.mjs swsh9-TG01 swsh12.5-GG01 sv10.5b-087
```

第二步：按 `imageSource` 下载图片并转成本地 WebP。

```sh
REFRESH_IMAGE_IDS="swsh9-TG01,swsh12.5-GG01,sv10.5b-087" node scripts/02-download-card-images.mjs
```

### 添加 Pocket 卡

Pocket 卡不走 TCGdex，不套实体卡 Scrydex 路径规则。

入口：

```text
https://scrydex.com/pokemon/tcg-pocket/expansions
```

规则：

- 项目简称写 `PTCGP`
- `language` 统一写 `PK`
- `setId` 使用 Scrydex Pocket 页面里的 `tcgp-*`，保留原大小写，例如 `tcgp-A1`
- 本地 `id` 使用小写格式，例如 `tcgp-a1-001`
- 图片来源使用 Scrydex Pocket 卡页或图片地址，不和实体卡路径混用

### Dex App 兜底拿图

当 TCGdex/Scrydex 暂未更新，或者 Scrydex 返回卡背占位图，但本机 Dex 已经能显示真实卡图时，可以用 Dex 本地缓存兜底。

Dex 已确认的数据入口：

```text
clients.dextcg.com
static.dextcg.com
```

Dex Kingfisher 图片缓存默认在：

```text
~/Library/Containers/pedrommcarrasco.Dex/Data/Library/Caches/com.onevcat.Kingfisher.ImageCache.default
```

推荐流程：

```sh
node scripts/tool-import-dex-cache-image.mjs --clear-cache --yes
```

然后在 Dex 里打开目标系列和目标卡，让它重新缓存大图。

列出最近缓存的大图：

```sh
node scripts/tool-import-dex-cache-image.mjs --list --minutes 0
```

生成对照图：

```sh
node scripts/tool-import-dex-cache-image.mjs --sheet --minutes 0
```

导入确认后的图片：

```sh
node scripts/tool-import-dex-cache-image.mjs mep-107=8e4c06d342193b5e6c5afefa9dab7ee4
```

一次导入多张：

```sh
node scripts/tool-import-dex-cache-image.mjs mep-107=缓存文件名 mep-108=缓存文件名
```

Dex 缓存文件名不能反推出原始 URL，所以来源写成：

```js
imageSource: {
  provider: "Dex local cache",
  url: "dex-cache:mep-107"
}
```

注意：Dex 兜底只解决图片。卡名、编号、全国编号、标签仍然要人工核对；不要把 release date 写进单卡。

### 上传图片到 GitHub Releases

本地卡图不进 Git，线上图通过 Releases 托管。

先看分组和缺失情况：

```sh
node scripts/03-upload-release-assets.mjs
```

确认后上传：

```sh
node scripts/03-upload-release-assets.mjs --execute
```

## 数据规则

核心规则：

1. 英文实体卡本地 `id` 使用 TCGdex card id，例如 `me02.5-270`、`sv03.5-166`、`mep-107`。
2. 简体中文独占卡使用自定义小写 id，例如 `cbb1c-07-09`、`151c-170`。
3. 繁中卡 `language` 写 `TW`。
4. 日文卡 `language` 写 `JP`，`cardName` 用日文名。
5. Pocket 卡 `language` 写 `PK`。
6. `cardName` 只写卡名，不写 `printedName`。
7. `number` 只保存卡面编号本身，不保存斜线后的总数。
8. `printedNumber` 不逐卡保存，显示时由 `number` 和 `setsById[setId].total` 派生。
9. `releaseDate` 默认只写在 `setsById` 系列信息里；不要把 release date 写进单卡。
10. 单卡 `releaseDate` 只在确实有精确日期且不同于系列日期时使用，不写 `YYYY-MM-01` 这种占位。

`dexIds` 只在一张卡对应多个全国图鉴编号时使用，比如 Tag Team。卡片实体只保留一份；页面加载时会动态挂到多个宝可梦下面。

```js
{
  id: "sm9-162",
  cardName: "Pikachu & Zekrom GX",
  dexIds: [25, 644]
}
```

简中变种编号例子：

```js
{
  id: "cbb1c-07-09",
  setId: "cbb1c",
  number: "07",
  variant: { number: "09", total: "09" }
}
```

显示时会派生成 `0709/09`；菜单和查找 code 会显示成 `7-9`。

## 图片规则

本地图片统一保存为：

```text
assets/cards/{cardId}.webp
```

尺寸和格式：

```text
height = 825px
width  = 按原图比例自动缩放
format = WebP
alpha  = 保留透明通道
```

允许的 `imageSource.provider`：

```text
Scrydex
Pokemon.cn
Pokemon Asia TW
PokiPair
Dex local cache
```

英文实体卡图片优先使用 Scrydex：

```js
imageSource: {
  provider: "Scrydex",
  url: "https://images.scrydex.com/pokemon/swsh9tg-TG01/large"
}
```

简中独占卡优先使用 Pokemon.cn，少量旧图可暂时保留 PokiPair。

```js
imageSource: {
  provider: "Pokemon.cn",
  url: "https://image.pokemon.com.cn/..."
}
```

`02-download-card-images.mjs` 会：

- 只读取 `imageSource.url`
- 只尝试允许来源的 URL
- 自动尝试已知 Scrydex 路径修正规则
- 跳过 Scrydex 卡背占位图
- 下载后转成高度 825 的 WebP
- 保留 alpha
- 下载失败时保留已有本地图片，并在 summary 里汇报

运行 summary 写到：

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

## 背景分类和标签

每张卡都有：

```js
isShiny: true | false
backgroundType: "content" | "simple" | "other"
tags: string[]
```

`backgroundType`：

- `content`：背景有具体内容、场景、构图
- `simple`：背景是简单颜色、纹理、纯色或普通全图背景
- `other`：不是这两类，或者保留但不参与这两个背景分类

`tags` 只给 `backgroundType: "content"` 的卡使用。标签用英文小写短词组，服务搜索和主题页浏览；不要重复写系列名、稀有度、卡牌编号这类 metadata。

常用标签类型：

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
1 Star Pokemon TCG Pocket 1 Star     rank 1
2 Star Pokemon TCG Pocket 2 Star     rank 2
3 Star Pokemon TCG Pocket 3 Star     rank 2
Crown  Pokemon TCG Pocket Crown      rank 2
Shiny  Pokemon TCG Pocket shiny      rank 1
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

当前 Release 分组：

```text
card-assets-sv        sv/svp/csv/cs/cbb/151c 开头的卡图
card-assets-swsh-me   swsh/me/mep 开头的卡图
card-assets-ptcgp     tcgp-a / tcgp-p 开头的 Pocket A / Promo 系列卡图
card-assets-ptcgp-b   tcgp-b 开头的 Pocket B 系列卡图
card-assets-legacy    其他旧系列卡图
```

本地预览默认继续使用 `assets/cards`。如果要本地强制测试 Release 图片，在 URL 后加：

```text
?assets=release
```

## local-data.js

`local-data.js` 是当前项目的本地事实库。页面和审核页都只读它，不会自动联网更新。

顶层数据：

- `version`：本地数据版本，用来刷新浏览器缓存
- `generatedAt`：最近一次写入 `local-data.js` 的时间
- `species`：全国图鉴 1-1025 的英文名
- `species_cn`：全国图鉴编号对应中文名；`9999` 用作简中独占训练家 / 物品卡的临时分组
- `species_ja`：全国图鉴编号对应日文名
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

单卡示例：

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
primaryDexId
updated
form.pattern
```

## 脚本索引

```text
scripts/01-add-card-json.mjs                  添加指定 TCGdex card id 的 JSON 信息，不下载图片
scripts/02-download-card-images.mjs           按 JSON 图源下载图片并转成本地 WebP
scripts/03-upload-release-assets.mjs          把本地卡图按分组上传到 GitHub Releases
scripts/maintenance-refresh-all-json.mjs      刷新全量本地卡牌 JSON 信息，不下载图片
scripts/maintenance-apply-review-results.mjs  应用审核页保存的结果
scripts/maintenance-apply-content-tags.mjs    批量应用内容标签
scripts/tool-find-card.mjs                    本地查卡
scripts/tool-import-dex-cache-image.mjs       从本机 Dex App 图片缓存导入兜底卡图
scripts/lib-version-utils.mjs                 写入 local-data.js 并同步缓存版本
```

更多脚本用法见 `scripts/README.md`。

## 本地运行

直接打开：

```text
index.html
tags.html
review.html
```

或者启动本地服务：

```sh
python3 -m http.server 4178
```

访问：

```text
http://localhost:4178/
http://localhost:4178/tags.html
http://localhost:4178/review.html
```

## 查卡

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
