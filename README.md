# Pokemon TCG National Dex

这是一个静态的 Pokemon TCG 全国图鉴页面。对外页面是 `index.html`，自用审核页面是 `review.html`。

页面只读取本地数据和本地图片，可以直接用 GitHub Pages 从 `main` 分支发布。

## 文件结构

```text
index.html                 对外展示页
app.js                     对外页逻辑
styles.css                 对外页样式
review.html                自用审核页
review.js                  审核页逻辑
review.css                 审核页样式
local-data.js              当前卡库数据
form-index.js              宝可梦地区形态、Mega 等形态索引
assets/cards/              本地卡图，统一 600 x 825 WebP
scripts/apply-review-results.mjs    应用审核页保存的结果
scripts/find-card.mjs               本地查卡工具
```

## 数据规则

每张卡用 `id` 作为唯一编号，例如：

```text
sv03.5-166
sv09-184
swsh9-154
mep-037
xyp-XY121
```

每张卡都有这两个核心字段：

```js
isShiny: true | false
backgroundType: "content" | "simple" | "other"
```

`backgroundType` 的含义：

- `content`：背景有具体内容、场景、构图
- `simple`：背景是简单颜色、纹理、纯色或普通全图背景
- `other`：不是这两类，或者保留但不参与这两个背景分类

当前卡图都应是：

```text
600 x 825 WebP
```

## local-data.js 存什么

`local-data.js` 是当前项目的本地事实库。页面和审核页都只读它，不会自动联网更新。

顶层数据：

- `version`：本地数据版本，用来刷新浏览器缓存
- `generatedAt`：这份数据最初生成的时间
- `species`：全国图鉴 1-1025 的英文名
- `zhNames`：全国图鉴编号对应中文名
- `ptcgoCodesBySetName`：实体大系列名和 PTCGO code 的对应关系
- `setReleaseDates`：系列发行日，用来排序下拉菜单里的候选卡
- `cardsByDex`：按全国图鉴编号分组的卡片列表

每张卡只保留这些字段：

```js
{
  id: "sv03.5-166",
  name: "Bulbasaur",
  image: "./assets/cards/sv03.5-166.webp",
  form: { key: "base", label: "Base", shortLabel: "Std", rank: 0 },
  isShiny: false,
  backgroundType: "content",
  eraCode: "SV",
  setDisplayCode: "SV03",
  ptcgoCode: "MEW",
  setId: "sv03.5",
  setName: "151",
  number: "166",
  printedNumber: "166/165",
  rarity: "Illustration rare",
  label: "IR",
  releaseDate: "2023-09-22",
  rank: 1
}
```

`releaseDate` 是可选字段。普通大系列默认用 `setReleaseDates` 里的系列发行日，不需要每张卡都写。Promo 卡优先用价格记录里最早出现的日期作为单卡 `releaseDate`；当前按 PriceCharting 历史价格图里最早的非零价格点记录。如果暂时查不到价格历史，再用 promo 系列的发行日兜底。

已经整理掉的旧字段：

- `fallbackImage`
- `highImage`
- `highFallbackImage`
- `imageSources`
- `source`
- `updated`
- `form.pattern`

原因是页面现在只读本地 `600 x 825 WebP`，不再需要同时保存在线图、低清图、高清图和 fallback 图。需要显示的出处文字会从 `setName`、`printedNumber`、`rarity` 自动拼出来。

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

## 我说一张卡时，去哪儿找

先在本地库查：

```sh
node scripts/find-card.mjs "SV-JTG-184"
node scripts/find-card.mjs "sv09-184"
node scripts/find-card.mjs "Charizard"
node scripts/find-card.mjs "MEW 166"
```

网页下拉里显示的格式是：

```text
[EN] SV-JTG-184
[EN] SV-MEW-166
[EN] SWSH-BRS-154
[EN] SV-PROMO-129
```

含义：

```text
[语言] 大时代-PTCGO代码-系列内编号
```

如果本地没有，再按下面顺序查公开来源。先拿卡信息，再拿图片；图片最终都要保存成本地 `600 x 825 WebP`。

1. TCGdex，优先拿卡信息和图片  
   API: `https://api.tcgdex.net/v2/en/cards/{cardId}`  
   Set: `https://api.tcgdex.net/v2/en/sets/{setId}`

2. Pokemon TCG API，TCGdex 没图或图不可用时拿图片  
   低清图：`https://images.pokemontcg.io/{setId}/{number}.png`  
   高清图：`https://images.pokemontcg.io/{setId}/{number}_hires.png`

3. 其他公开网页，前两个来源都拿不到时人工核对  
   只用来确认卡面和下载可用图片。不要把外链写进页面，必须保存到 `assets/cards/` 后再写入 `local-data.js`。

注意：不要收录 Pokemon TCG Pocket。`A1/A2...`、`B1/B1a/B2...` 这类 Pocket 系列不属于实体卡。

## 补一张卡的流程

### 1. 确认卡 ID

优先用 TCGdex card id。通常格式是：

```text
setId-localId
```

例子：

```text
sv03.5-166
svp-044
xyp-XY121
```

### 2. 优先从 TCGdex 查卡信息

如果知道 ID：

```text
https://api.tcgdex.net/v2/en/cards/sv03.5-166
```

需要确认这些字段：

- `id`
- `name`
- `dexId`
- `set.id`
- `set.name`
- `localId`
- `rarity`
- `image`

这些字段对应 `local-data.js`：

```text
id             <- id
name           <- name，去掉 ex/GX/V 等后缀后保留宝可梦名
setId          <- set.id
setName        <- set.name
number         <- localId
rarity         <- rarity
printedNumber  <- localId/官方系列张数
```

如果 TCGdex 返回 `dexId`，用它决定这张卡放进哪个全国图鉴编号。没有 `dexId` 时，先人工确认对应宝可梦编号。

### 3. 优先从 TCGdex 拿图

TCGdex 如果有 `image` 字段，优先用它：

```text
{image}/high.webp
{image}/low.webp
```

优先下载 `high.webp`。如果只有 `low.webp` 能打开，也可以先用低清图，但最终仍要转成 `600 x 825 WebP` 存本地。

### 4. TCGdex 没图时查 Pokemon TCG API

把 TCGdex 的 `set.id` 和 `localId` 转成 Pokemon TCG API 图片地址。常见例子：

```text
sv03.5 + 166 -> https://images.pokemontcg.io/sv3pt5/166_hires.png
sv09 + 184   -> https://images.pokemontcg.io/sv9/184_hires.png
swsh9 + 154  -> https://images.pokemontcg.io/swsh9/154_hires.png
xyp + XY121  -> https://images.pokemontcg.io/xyp/XY121_hires.png
```

优先试高清：

```text
https://images.pokemontcg.io/{pokemonTcgSetId}/{number}_hires.png
```

高清打不开，再试普通图：

```text
https://images.pokemontcg.io/{pokemonTcgSetId}/{number}.png
```

### 5. 公开网页只做最后兜底

如果 TCGdex 和 Pokemon TCG API 都没有图，再去公开网站人工找图。可用来源包括卡牌数据库、百科页面、图片搜索结果等。

要求：

- 必须确认是同一张实体卡
- 必须符合当前收录要求
- 不要收录 Pokemon TCG Pocket
- 不保存外链，只保存本地 WebP

### 6. 存到本地图片

最终图片统一放到：

```text
assets/cards/{cardId}.webp
```

尺寸统一：

```text
600 x 825 WebP
```

如果手动处理图片，可以用 ImageMagick：

```sh
magick input.png -resize 600x825! -strip -quality 82 assets/cards/{cardId}.webp
```

### 7. 加入或更新数据

这个项目以当前的 `local-data.js` 和 `assets/cards/` 为准，不会自动改已经存好的数据。

如果只是卡有了、图缺了，直接把图片保存到 `assets/cards/{cardId}.webp`，然后把这张卡的 `image` 字段改成 `./assets/cards/{cardId}.webp`。

如果本地完全没有这张卡，按上面的来源顺序查到卡信息和图片，再手动把这张卡加入 `local-data.js`，并把图片保存到 `assets/cards/{cardId}.webp`。

候选卡下拉菜单按发行时间排序：日期新的排前面；同一天通常是同一个系列，系列内编号大的排前面。Promo 卡优先看单卡 `releaseDate`，这个日期取价格记录里最早出现的时间；没有时才用对应 promo 系列的日期。

Promo 的单卡 `releaseDate` 维护方式：

- 先用本地 `id`、卡名、promo 编号确认卡
- 去 PriceCharting 搜 `{卡名} {promo编号}`
- 打开匹配的 Pokemon Promo 页面
- 取历史价格图里最早的非零价格月份，写成 `YYYY-MM-DD`
- 如果没有价格图或没有非零价格点，不写单卡 `releaseDate`

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

这个脚本只会在你明确运行它时更新数据。保存 review 文件本身不会自动修改卡库。

## 发布到 GitHub Pages

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
```

检查图片尺寸：

```sh
find assets/cards -type f -name '*.webp' -print0 \
  | xargs -0 magick identify -format '%w %h %m %i\n' \
  | awk '$1 != 600 || $2 != 825 || $3 != "WEBP" { print }'
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
