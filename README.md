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
scripts/apply-review-results.mjs   应用审核页保存的结果
scripts/find-card.mjs              本地查卡工具
scripts/refresh-card-images.mjs    按图片规则重抓并转成本地 WebP
```

## 数据源规则

核心原则：

1. **最终本地卡牌 id 优先用 TCGdex id**，例如 `me02.5-270`、`sv03.5-166`。
2. **图片优先从 TCGdex 拿**。
3. **TCGdex 没有图时，只用 Scrydex 兜底**。
4. **PokemonTCG API 只用于查卡表、rarity、set、supertype、nationalPokedexNumbers 等元数据，不作为图片来源**。
5. 公开网页只用于人工核对卡面，不作为常规图片下载源。

常见来源分工：

```text
TCGdex          最终 id、单卡详情、首选图片
PokemonTCG API  卡表筛选、rarity、全国图鉴编号、发行日、PTCGO code
Scrydex         TCGdex 缺图时的唯一图片兜底
```

不同 API 的 set id 可能不同。导入时必须映射到 TCGdex id：

```text
Ascended Heroes:
PokemonTCG API set id = me2pt5
TCGdex set id         = me02.5
```

禁止收录 Pokemon TCG Pocket。`A1/A2...`、`B1/B1a/B2...` 这类 Pocket 系列不属于实体卡。

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
alpha  = 尽量保留；来源没有透明图时允许不透明
```

下载优先级：

1. TCGdex `{image}/high.webp`
2. TCGdex `{image}/low.webp`
3. Scrydex `https://images.scrydex.com/pokemon/{cardId}/large`
4. Scrydex `https://images.scrydex.com/pokemon/{cardId}/small`

Scrydex 缺图时可能返回 Pokemon 卡背占位图，不能当作有效卡图保存。

每张卡必须记录图片来源：

```js
imageSource: {
  provider: "TCGdex",
  url: "https://assets.tcgdex.net/en/me/me02.5/270/high.webp"
}
```

允许的 `provider`：

```text
TCGdex
Scrydex
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
  id: "me02.5-270",
  name: "Mega Scrafty",
  image: "./assets/cards/me02.5-270.webp",
  form: { key: "mega", label: "Mega", shortLabel: "Mega", rank: 22 },
  isShiny: false,
  backgroundType: "content",
  eraCode: "",
  setDisplayCode: "",
  ptcgoCode: "ASC",
  setId: "me02.5",
  setName: "Ascended Heroes",
  number: "270",
  printedNumber: "270/217",
  rarity: "Mega Attack Rare",
  label: "MAR",
  releaseDate: "2026-01-30",
  imageSource: {
    provider: "TCGdex",
    url: "https://assets.tcgdex.net/en/me/me02.5/270/high.webp"
  },
  rank: 2
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
IR   Illustration rare           rank 1
SIR  Special Illustration Rare   rank 2
MAR  Mega Attack Rare            rank 2
FA   Ultra Rare                  rank 3
Promo                            rank 4
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
node scripts/find-card.mjs "SV-JTG-184"
node scripts/find-card.mjs "sv09-184"
node scripts/find-card.mjs "Charizard"
node scripts/find-card.mjs "MEW 166"
node scripts/find-card.mjs "Ascended Heroes"
```

网页下拉里显示的格式：

```text
[EN] ME-ASC-270
[EN] SV-JTG-184
[EN] SWSH-BRS-154
[EN] SV-PROMO-129
```

含义：

```text
[语言] 大时代-PTCGO代码-系列内编号
```

## 补卡流程

### 1. 查卡表

先用 PokemonTCG API 快速找目标卡表、rarity、supertype 和全国图鉴编号。

例子：

```text
https://api.pokemontcg.io/v2/cards?q=set.id:me2pt5 rarity:"Illustration Rare"
```

只收录实体宝可梦卡时，必须排除：

```text
supertype != "Pokémon"
```

PokemonTCG API 返回的 `nationalPokedexNumbers` 可用于归入 `cardsByDex`。

### 2. 映射 TCGdex id

最终本地 `id` 必须优先用 TCGdex id。

例子：

```text
PokemonTCG API: me2pt5-270
TCGdex:         me02.5-270
```

查 TCGdex：

```text
https://api.tcgdex.net/v2/en/cards/me02.5-270
https://api.tcgdex.net/v2/en/sets/me02.5
```

需要确认字段：

- `id`
- `name`
- `localId`
- `rarity`
- `image`
- `set.id`
- `set.name`

### 3. 下载图片

优先 TCGdex：

```text
{image}/high.webp
{image}/low.webp
```

TCGdex 没有图时，只用 Scrydex 兜底：

```text
https://images.scrydex.com/pokemon/{tcgdexCardId}/large
https://images.scrydex.com/pokemon/{tcgdexCardId}/small
```

不要使用 PokemonTCG API 的图片 URL 作为兜底。

### 4. 转成本地 WebP

```sh
magick input.png -resize x825 -background none -define webp:lossless=true assets/cards/{tcgdexCardId}.webp
```

如果输入已经是 WebP，也照样统一转一遍，确保高度和格式一致。

### 5. 写入数据

把卡加入 `local-data.js`：

- `id` 使用 TCGdex id
- `image` 指向本地 WebP
- `setId` 使用 TCGdex set id
- `ptcgoCode` 使用实体系列 code
- `imageSource` 写真实下载来源
- `setReleaseDates` 补系列发行日
- `ptcgoCodesBySetName` 补系列名到 PTCGO code 的映射

更新数据后同步版本：

- `local-data.js` 顶层 `version`
- `app.js` 的 `CACHE_VERSION`
- `index.html` 里的 `local-data.js?v=...` 和 `app.js?v=...`
- `review.html` 里的 `local-data.js?v=...`

## 审核分类

打开：

```text
review.html
```

顶部可以筛选：

- 全部
- content
- simple
- other

每张卡有四个按钮：

- 内容
- 简单
- 其他
- 删除

当前分类会默认选中。只有手动改过的卡会被保存。

保存后会生成：

```text
ptcg-review-YYYY-MM-DD.json
```

应用审核结果：

```sh
node scripts/apply-review-results.mjs ptcg-review-YYYY-MM-DD.json
```

这个脚本会：

- 更新 `local-data.js`
- 删除被标记为删除的本地图片

保存 review 文件本身不会自动修改卡库。

## 发布

GitHub Pages 使用 `main` 分支根目录。

必须保留：

- `index.html`
- `app.js`
- `styles.css`
- `form-index.js`
- `local-data.js`
- `assets/cards/`

自用审核页可以留在仓库里：

- `review.html`
- `review.js`
- `review.css`

## 常用检查

检查脚本语法：

```sh
node --check app.js
node --check review.js
node --check scripts/apply-review-results.mjs
node --check scripts/find-card.mjs
node --check scripts/refresh-card-images.mjs
```

检查图片高度：

```sh
find assets/cards -type f -name '*.webp' -print0 \
  | xargs -0 magick identify -format '%h %m %i\n' \
  | awk '$1 != 825 || $2 != "WEBP" { print }'
```

检查数据统计：

```sh
node - <<'NODE'
const fs = require("fs");
const data = JSON.parse(fs.readFileSync("local-data.js", "utf8")
  .replace(/^window\.PTCG_LOCAL_DATA = /, "")
  .replace(/;\s*$/, ""));
const counts = { content: 0, simple: 0, other: 0 };
let cards = 0;
for (const [, list] of data.cardsByDex) {
  for (const card of list) {
    cards += 1;
    counts[card.backgroundType] += 1;
  }
}
console.log({ cards, dexWithCards: data.cardsByDex.length, counts });
NODE
```

检查某个系列来源：

```sh
node - <<'NODE'
const fs = require("fs");
const data = JSON.parse(fs.readFileSync("local-data.js", "utf8")
  .replace(/^window\.PTCG_LOCAL_DATA = /, "")
  .replace(/;\s*$/, ""));
const cards = [];
for (const [, list] of data.cardsByDex) {
  for (const card of list) {
    if (card.setId === "me02.5") cards.push(card);
  }
}
const providers = {};
for (const card of cards) {
  providers[card.imageSource?.provider || "missing"] =
    (providers[card.imageSource?.provider || "missing"] || 0) + 1;
}
console.log({ cards: cards.length, providers });
NODE
```
