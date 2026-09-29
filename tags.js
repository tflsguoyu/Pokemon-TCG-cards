const CACHE_VERSION = 339;

const FEATURED_TAGS = [
  "sleeping",
  "forest",
  "underwater",
  "bird",
  "pink",
  "simple",
  "partner",
  "flowers",
  "night",
  "fire",
  "city",
  "food",
  "snow",
  "ocean",
  "neon",
  "cute",
  "battle",
  "sky",
  "dragon",
  "music",
  "desert",
  "cozy",
  "ghost",
  "water",
  "group",
  "moon",
  "garden",
  "space",
  "crystal",
  "future",
  "ancient",
  "mask",
];

const TAG_CATEGORIES = [
  {
    key: "all",
    zh: "全部",
    en: "All",
    tags: FEATURED_TAGS,
  },
  {
    key: "scene",
    zh: "场景",
    en: "Scene",
    tags: ["forest", "underwater", "city", "snow", "ocean", "sky", "desert", "garden", "space", "outdoors", "indoors"],
  },
  {
    key: "mood",
    zh: "氛围",
    en: "Mood",
    tags: ["night", "moon", "cozy", "calm", "mysterious", "future", "ancient", "dark", "bright", "neon"],
  },
  {
    key: "color",
    zh: "颜色",
    en: "Color",
    tags: ["pink", "blue", "green", "orange", "yellow", "purple", "crystal"],
  },
  {
    key: "subject",
    zh: "主体",
    en: "Subject",
    tags: ["bird", "dragon", "ghost", "trainer", "partner", "group", "solo"],
  },
  {
    key: "action",
    zh: "动作",
    en: "Action",
    tags: ["sleeping", "battle", "dynamic pose", "playful", "cute"],
  },
  {
    key: "element",
    zh: "元素",
    en: "Element",
    tags: ["flowers", "fire", "food", "music", "mask", "water", "nature", "simple"],
  },
];

const TAG_LABELS = {
  sleeping: "睡眠",
  forest: "森林",
  underwater: "水下",
  bird: "鸟类",
  pink: "粉色",
  simple: "简洁",
  partner: "伙伴",
  flowers: "花朵",
  night: "夜晚",
  fire: "火焰",
  city: "城市",
  food: "食物",
  snow: "雪景",
  ocean: "海洋",
  neon: "霓虹",
  cute: "可爱",
  battle: "战斗",
  sky: "天空",
  dragon: "龙",
  music: "音乐",
  desert: "沙漠",
  cozy: "温馨",
  ghost: "幽灵",
  water: "水",
  group: "群像",
  moon: "月亮",
  garden: "庭园",
  space: "宇宙",
  crystal: "水晶",
  future: "未来",
  ancient: "古代",
  mask: "面具",
  solo: "单体",
  blue: "蓝色",
  green: "绿色",
  "dynamic pose": "动态",
  trainer: "训练家",
  bright: "明亮",
  calm: "平静",
  orange: "橙色",
  nature: "自然",
  yellow: "黄色",
  dark: "深色",
  mysterious: "神秘",
  outdoors: "户外",
  playful: "玩耍",
  indoors: "室内",
  purple: "紫色",
};

const COLUMN_STORAGE_KEYS = {
  desktop: "ptcg.tags.desktopColumns",
  mobile: "ptcg.tags.mobileColumns.v2",
};

const state = {
  cards: [],
  counts: new Map(),
  setsById: new Map(),
  selectedTags: new Set(),
  activeTagCategory: "all",
  desktopColumns: 7,
  mobileColumns: 3,
};

const els = {
  tagCategoryRail: document.querySelector("#tagCategoryRail"),
  tagRail: document.querySelector("#tagRail"),
  clearTagsBtn: document.querySelector("#clearTagsBtn"),
  cardGrid: document.querySelector("#cardGrid"),
  selectionSummary: document.querySelector("#selectionSummary"),
  columnsInput: document.querySelector("#columnsInput"),
  columnsCount: document.querySelector("#columnsCount"),
  tagButtonTemplate: document.querySelector("#tagButtonTemplate"),
  tagCardTemplate: document.querySelector("#tagCardTemplate"),
  imageDialog: document.querySelector("#imageDialog"),
  dialogImage: document.querySelector("#dialogImage"),
  dialogCaption: document.querySelector("#dialogCaption"),
  closeDialogBtn: document.querySelector("#closeDialogBtn"),
};

init();

function init() {
  if (!restoreLocalData()) return;
  configureColumnControl();
  wireDialog();
  renderTagCategoryRail();
  renderTagRail();
  render();
}

function configureColumnControl() {
  const mediaQuery = window.matchMedia("(max-width: 600px)");
  state.desktopColumns = readStoredColumns(COLUMN_STORAGE_KEYS.desktop, state.desktopColumns, 4, 40);
  state.mobileColumns = readStoredColumns(COLUMN_STORAGE_KEYS.mobile, state.mobileColumns, 1, 8);

  const applyColumnRange = () => {
    const isMobile = mediaQuery.matches;
    const min = isMobile ? 1 : 4;
    const max = isMobile ? 8 : 40;
    const value = isMobile ? state.mobileColumns : state.desktopColumns;
    els.columnsInput.min = String(min);
    els.columnsInput.max = String(max);
    els.columnsInput.value = String(clamp(value, min, max));
    updateGridColumns();
  };

  els.columnsInput.addEventListener("input", () => {
    const next = Number(els.columnsInput.value);
    if (mediaQuery.matches) {
      state.mobileColumns = next;
      localStorage.setItem(COLUMN_STORAGE_KEYS.mobile, String(next));
    } else {
      state.desktopColumns = next;
      localStorage.setItem(COLUMN_STORAGE_KEYS.desktop, String(next));
    }
    updateGridColumns();
  });

  mediaQuery.addEventListener("change", applyColumnRange);
  applyColumnRange();
}

function updateGridColumns() {
  const columns = Number(els.columnsInput.value);
  els.columnsCount.textContent = columns;
  els.cardGrid.style.setProperty("--grid-columns", String(columns));
  els.cardGrid.classList.toggle("image-only", columns > getImageOnlyColumnThreshold());
}

function getImageOnlyColumnThreshold() {
  return window.matchMedia("(max-width: 600px)").matches ? 3 : 10;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readStoredColumns(key, fallback, min, max) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const stored = Number(raw);
  return Number.isFinite(stored) ? clamp(stored, min, max) : fallback;
}

function restoreLocalData() {
  const data = window.PTCG_LOCAL_DATA;
  if (!data || data.version !== CACHE_VERSION) return false;

  const cards = [];
  const cardsById = new Map();
  const speciesCn = new Map((data.species_cn || []).map(([id, name]) => [Number(id), name]));
  state.setsById = new Map(data.setsById || []);

  for (const [dexId, dexCards] of data.cardsByDex || []) {
    for (const card of dexCards || []) {
      if (card.backgroundType !== "content" || !card.image) continue;
      if (cardsById.has(card.id)) continue;
      const normalizedTags = Array.isArray(card.tags)
        ? Array.from(new Set(card.tags.map((tag) => String(tag).trim()).filter(Boolean)))
        : [];
      const uniqueCard = {
        ...card,
        dexId: Number(dexId),
        dexIds: getCardDexIds(card, Number(dexId)),
        zhName: speciesCn.get(Number(dexId)) || "",
        tags: normalizedTags,
        releaseTime: getCardReleaseTime(card),
      };
      cardsById.set(card.id, uniqueCard);
      cards.push(uniqueCard);
      for (const tag of normalizedTags) {
        state.counts.set(tag, (state.counts.get(tag) || 0) + 1);
      }
    }
  }

  state.cards = cards.sort(compareCards);
  return state.cards.length > 0;
}

function wireDialog() {
  els.clearTagsBtn.addEventListener("click", () => {
    state.selectedTags.clear();
    render();
  });

  els.closeDialogBtn.addEventListener("click", () => {
    els.imageDialog.close();
  });

  els.imageDialog.addEventListener("click", (event) => {
    if (event.target === els.imageDialog) els.imageDialog.close();
  });
}

function renderTagRail() {
  const fragment = document.createDocumentFragment();

  for (const tag of getVisibleTags()) {
    const count = state.counts.get(tag) || 0;
    const button = els.tagButtonTemplate.content.firstElementChild.cloneNode(true);
    button.dataset.tag = tag;
    button.title = `${getTagLabel(tag)} · ${tag} · ${count}`;
    button.querySelector(".tag-name-zh").textContent = getTagLabel(tag);
    button.querySelector(".tag-name-en").textContent = tag;
    button.addEventListener("click", () => {
      if (state.selectedTags.has(tag)) state.selectedTags.delete(tag);
      else state.selectedTags.add(tag);
      render();
    });
    fragment.appendChild(button);
  }

  els.tagRail.replaceChildren(fragment);
}

function renderTagCategoryRail() {
  const fragment = document.createDocumentFragment();

  for (const category of TAG_CATEGORIES) {
    if (category.key !== "all" && !category.tags.some((tag) => state.counts.has(tag))) continue;
    const button = document.createElement("button");
    button.className = "tag-category-button";
    button.type = "button";
    button.dataset.category = category.key;
    button.setAttribute("aria-pressed", String(category.key === state.activeTagCategory));
    button.innerHTML = `<span>${category.zh}</span><span>${category.en}</span>`;
    button.addEventListener("click", () => {
      state.activeTagCategory = category.key;
      renderTagCategoryRail();
      renderTagRail();
      render();
    });
    fragment.appendChild(button);
  }

  els.tagCategoryRail.replaceChildren(fragment);
}

function getVisibleTags() {
  const category = getActiveTagCategory();
  const featured = category.tags.filter((tag) => state.counts.has(tag));
  const featuredNames = new Set(featured);
  const extras =
    category.key === "all"
      ? Array.from(state.counts.entries())
          .filter(([tag, count]) => count >= 20 && !featuredNames.has(tag))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 16)
          .map(([tag]) => tag)
      : [];
  return [...featured, ...extras];
}

function getActiveTagCategory() {
  return TAG_CATEGORIES.find((item) => item.key === state.activeTagCategory) || TAG_CATEGORIES[0];
}

function getTagLabel(tag) {
  return TAG_LABELS[tag] || tag;
}

function render() {
  const cards = getFilteredCards();
  updateTagButtons();
  updateSelectionSummary();
  renderCards(cards);
}

function getFilteredCards() {
  const selected = Array.from(state.selectedTags);
  if (!selected.length) return state.cards;
  return state.cards.filter((card) => selected.every((tag) => card.tags.includes(tag)));
}

function updateTagButtons() {
  const hasSelection = state.selectedTags.size > 0;
  els.clearTagsBtn.classList.toggle("active", !hasSelection);

  for (const button of els.tagRail.querySelectorAll(".tag-button")) {
    const tag = button.dataset.tag;
    const isActive = state.selectedTags.has(tag);
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function updateSelectionSummary() {
  const selected = Array.from(state.selectedTags);
  const tagLabel = selected.length ? selected.map((tag) => getTagLabel(tag)).join(" + ") : "全部";
  els.selectionSummary.textContent = tagLabel;
}

function renderCards(cards) {
  const fragment = document.createDocumentFragment();

  for (const card of cards) {
    const node = els.tagCardTemplate.content.firstElementChild.cloneNode(true);
    const image = node.querySelector("img");
    const imageButton = node.querySelector(".tag-card-image");
    const title = node.querySelector("h3");

    image.src = resolveCardImageUrl(card.image);
    image.alt = `${card.cardName} ${getCardSourceLabel(card)}`;
    node.querySelector(".tag-card-number").textContent = formatDexLabel(card);
    title.textContent = card.cardName;
    node.querySelector(".tag-card-source").textContent = getCardSourceLabel(card);
    imageButton.addEventListener("click", () => openImage(card));
    fragment.appendChild(node);
  }

  els.cardGrid.replaceChildren(fragment);
}

function getCardDexIds(card, fallbackDexId) {
  const ids = Array.isArray(card.dexIds) && card.dexIds.length ? card.dexIds : [fallbackDexId];
  return Array.from(new Set(ids.map(Number).filter((id) => Number.isFinite(id) && id > 0)));
}

function formatDexLabel(card) {
  return getCardDexIds(card, card.dexId)
    .map((dexId) => `#${String(dexId).padStart(4, "0")}`)
    .join(" / ");
}

function openImage(card) {
  els.dialogImage.src = resolveCardImageUrl(card.image);
  els.dialogImage.alt = `${card.cardName} ${getCardSourceLabel(card)}`;
  renderImageCaption(els.dialogCaption, card);
  els.imageDialog.showModal();
}

function renderImageCaption(caption, card) {
  caption.replaceChildren();

  const name = document.createElement("span");
  name.className = "caption-card-name";
  name.textContent = card.cardName;
  caption.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "caption-card-meta";
  meta.textContent = getCardSourceLabel(card);
  caption.appendChild(meta);
}

function resolveCardImageUrl(url) {
  return window.PTCG_ASSETS?.resolveCardImageUrl(url) || url;
}

function compareCards(a, b) {
  const releaseDiff = b.releaseTime - a.releaseTime;
  if (releaseDiff) return releaseDiff;
  return String(a.id || "").localeCompare(String(b.id || ""), undefined, { numeric: true });
}

function getCardReleaseTime(card) {
  const releaseDate = card.releaseDate || getSetMeta(card).releaseDate || "";
  const time = Date.parse(releaseDate);
  return Number.isFinite(time) ? time : 0;
}

function getCardSourceLabel(card) {
  const printedNumber = getCaptionCardNumber(card);
  return [getSetName(card), printedNumber ? `#${printedNumber}` : ""].filter(Boolean).join(" · ");
}

function getSetMeta(card) {
  return state.setsById.get(card.setId) || {};
}

function getSetName(card) {
  return getSetMeta(card).name || card.setId || "";
}

function getPrintedNumber(card) {
  const number = String(card.number || "");
  if (card.variant?.number) {
    const variantNumber = String(card.variant.number || "");
    const variantTotal = String(card.variant.total || "");
    return variantTotal ? `${number}${variantNumber}/${variantTotal}` : `${number}${variantNumber}`;
  }
  const total = getSetMeta(card).total;
  return number && total ? `${number}/${total}` : number;
}

function getCaptionCardNumber(card) {
  return String(getPrintedNumber(card) || "").split("/")[0];
}
