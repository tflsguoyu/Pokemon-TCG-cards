const CACHE_VERSION = 200;

const FEATURED_TAGS = [
  ["sleeping", "💤"],
  ["forest", "🌲"],
  ["underwater", "🌊"],
  ["bird", "🪶"],
  ["pink", "●"],
  ["simple", "□"],
  ["partner", "♡"],
  ["flowers", "✿"],
  ["night", "☾"],
  ["fire", "◆"],
  ["city", "▦"],
  ["food", "◉"],
  ["snow", "✧"],
  ["ocean", "≈"],
  ["neon", "✦"],
  ["cute", "☺"],
  ["battle", "⚡"],
  ["sky", "☁"],
  ["dragon", "◇"],
  ["music", "♪"],
  ["desert", "△"],
  ["cozy", "⌂"],
  ["ghost", "◌"],
  ["water", "≈"],
  ["group", "●●"],
  ["moon", "☽"],
  ["garden", "✽"],
  ["space", "✶"],
  ["crystal", "◇"],
  ["future", "⌁"],
  ["ancient", "◫"],
  ["mask", "◈"]
];

const COLUMN_STORAGE_KEYS = {
  desktop: "ptcg.tags.desktopColumns",
  mobile: "ptcg.tags.mobileColumns.v2",
};

const state = {
  cards: [],
  counts: new Map(),
  selectedTags: new Set(),
  desktopColumns: 7,
  mobileColumns: 3,
};

const els = {
  tagRail: document.querySelector("#tagRail"),
  clearTagsBtn: document.querySelector("#clearTagsBtn"),
  cardGrid: document.querySelector("#cardGrid"),
  selectedTags: document.querySelector("#selectedTags"),
  resultTitle: document.querySelector("#resultTitle"),
  resultCount: document.querySelector("#resultCount"),
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
  const zhNames = new Map((data.zhNames || []).map(([id, name]) => [Number(id), name]));
  const setReleaseDates = new Map(data.setReleaseDates || []);

  for (const [dexId, dexCards] of data.cardsByDex || []) {
    for (const card of dexCards || []) {
      if (card.backgroundType !== "content" || !Array.isArray(card.tags) || !card.image) continue;
      const normalizedTags = Array.from(new Set(card.tags.map((tag) => String(tag).trim()).filter(Boolean)));
      if (!normalizedTags.length) continue;
      cards.push({
        ...card,
        dexId: Number(dexId),
        zhName: zhNames.get(Number(dexId)) || "",
        tags: normalizedTags,
        releaseTime: getCardReleaseTime(card, setReleaseDates),
      });
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

  for (const [tag, icon] of getVisibleTags()) {
    const count = state.counts.get(tag) || 0;
    const button = els.tagButtonTemplate.content.firstElementChild.cloneNode(true);
    button.dataset.tag = tag;
    button.title = `${tag} · ${count}`;
    button.querySelector(".tag-icon").textContent = icon;
    button.querySelector(".tag-name").textContent = tag;
    button.querySelector(".tag-count").textContent = count;
    button.addEventListener("click", () => {
      if (state.selectedTags.has(tag)) state.selectedTags.delete(tag);
      else state.selectedTags.add(tag);
      render();
    });
    fragment.appendChild(button);
  }

  els.tagRail.replaceChildren(fragment);
}

function getVisibleTags() {
  const featured = FEATURED_TAGS.filter(([tag]) => state.counts.has(tag));
  const featuredNames = new Set(featured.map(([tag]) => tag));
  const extras = Array.from(state.counts.entries())
    .filter(([tag, count]) => count >= 20 && !featuredNames.has(tag))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([tag]) => [tag, "•"]);
  return [...featured, ...extras];
}

function render() {
  const cards = getFilteredCards();
  updateTagButtons();
  updateSummary(cards);
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

function updateSummary(cards) {
  const selected = Array.from(state.selectedTags);
  els.selectedTags.textContent = selected.length ? selected.join(" + ") : "全部内容插画";
  els.resultTitle.textContent = selected.length ? "Matched Cards" : "Content Cards";
  els.resultCount.textContent = cards.length;
}

function renderCards(cards) {
  const fragment = document.createDocumentFragment();

  for (const card of cards) {
    const node = els.tagCardTemplate.content.firstElementChild.cloneNode(true);
    const image = node.querySelector("img");
    const imageButton = node.querySelector(".tag-card-image");
    const title = node.querySelector("h3");

    image.src = card.image;
    image.alt = `${card.name} ${getCardSourceLabel(card)}`;
    node.querySelector(".tag-card-number").textContent = `#${String(card.dexId).padStart(4, "0")}`;
    title.textContent = [card.name, card.zhName].filter(Boolean).join(" / ");
    node.querySelector(".tag-card-source").textContent = getCardSourceLabel(card);
    imageButton.addEventListener("click", () => openImage(card));
    fragment.appendChild(node);
  }

  els.cardGrid.replaceChildren(fragment);
}

function openImage(card) {
  els.dialogImage.src = card.image;
  els.dialogImage.alt = `${card.name} ${getCardSourceLabel(card)}`;
  els.dialogCaption.textContent = `${card.name} · ${getCardSourceLabel(card)}`;
  els.imageDialog.showModal();
}

function compareCards(a, b) {
  const releaseDiff = b.releaseTime - a.releaseTime;
  if (releaseDiff) return releaseDiff;
  return String(a.id || "").localeCompare(String(b.id || ""), undefined, { numeric: true });
}

function getCardReleaseTime(card, setReleaseDates) {
  const releaseDate = card.releaseDate || setReleaseDates.get(card.setId) || "";
  const time = Date.parse(releaseDate);
  return Number.isFinite(time) ? time : 0;
}

function getCardSourceLabel(card) {
  return [card.setName, card.printedNumber ? `#${card.printedNumber}` : "", card.rarity].filter(Boolean).join(" · ");
}
