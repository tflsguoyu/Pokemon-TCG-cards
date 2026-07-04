# Scripts

这些脚本都从项目根目录运行。

## 主流程

### 1. 添加英文实体卡 JSON

```sh
node scripts/01-add-card-json.mjs swsh9-TG01 swsh12.5-GG01
```

作用：

- 从 TCGdex 读取英文实体卡 metadata
- 写入 `local-data.js`
- 准备 Scrydex 图片来源
- 不下载图片

### 2. 下载或刷新图片

只刷新指定卡：

```sh
REFRESH_IMAGE_IDS="swsh9-TG01,swsh12.5-GG01" node scripts/02-download-card-images.mjs
```

刷新全部：

```sh
node scripts/02-download-card-images.mjs
```

输出：

```text
tmp/02-download-card-images-summary.json
```

### 3. 上传图片到 GitHub Releases

预览：

```sh
node scripts/03-upload-release-assets.mjs
```

上传：

```sh
node scripts/03-upload-release-assets.mjs --execute
```

## Dex 缓存图片工具

清空 Dex 图片缓存：

```sh
node scripts/tool-import-dex-cache-image.mjs --clear-cache --yes
```

然后在 Dex 里打开目标卡，让图片进入缓存。

列出缓存大图：

```sh
node scripts/tool-import-dex-cache-image.mjs --list --minutes 0
```

生成对照图：

```sh
node scripts/tool-import-dex-cache-image.mjs --sheet --minutes 0
```

导入图片：

```sh
node scripts/tool-import-dex-cache-image.mjs mep-107=8e4c06d342193b5e6c5afefa9dab7ee4
```

导入后还需要手动核对并写入 `local-data.js` 里的单卡 metadata。

## 维护脚本

刷新全量 JSON：

```sh
node scripts/maintenance-refresh-all-json.mjs
```

应用审核页导出的结果：

```sh
node scripts/maintenance-apply-review-results.mjs ptcg-review-2026-07-03.json
```

应用内容标签：

```sh
node scripts/maintenance-apply-content-tags.mjs tmp/content-tags-batch-001.json
```

## 查询工具

```sh
node scripts/tool-find-card.mjs "Charizard"
node scripts/tool-find-card.mjs "mep-107"
node scripts/tool-find-card.mjs "Ascended Heroes"
```

## 公共库

`scripts/lib-version-utils.mjs` 提供：

- `readLocalData()`
- `writeLocalData()`
- `syncProjectVersion()`

需要写入 `local-data.js` 的脚本优先使用 `writeLocalData()`，这样会自动同步 `app.js`、`tags.js`、`sw.js`、`index.html`、`tags.html`、`review.html` 的缓存版本。
