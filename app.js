const CACHE_VERSION = 246;

const NATIONAL_DEX_RANGES = {
  1: [1, 151],
  2: [152, 251],
  3: [252, 386],
  4: [387, 493],
  5: [494, 649],
  6: [650, 721],
  7: [722, 809],
  8: [810, 905],
  9: [906, 1025],
};

const REGIONAL_FORM_KEYS = new Set(["alolan", "galarian", "hisuian", "paldean"]);
const COLUMN_STORAGE_KEYS = {
  desktop: "ptcg.index.desktopColumns",
  mobile: "ptcg.index.mobileColumns",
};

const state = {
  species: [],
  speciesCnByDex: new Map(),
  setsById: new Map(),
  cardsByDex: new Map(),
  query: "",
  generation: "all",
  viewMode: "all",
  shinyOnly: false,
  backgroundFilters: {
    content: true,
    simple: true,
  },
  imageDialogCards: [],
  imageDialogIndex: -1,
  imageDialogOnSelect: null,
  desktopColumns: 6,
  mobileColumns: 2,
};

const els = {
  grid: document.querySelector("#dexGrid"),
  template: document.querySelector("#dexCardTemplate"),
  status: document.querySelector("#status"),
  search: document.querySelector("#searchInput"),
  generation: document.querySelector("#generationSelect"),
  withImagesViewBtn: document.querySelector("#withImagesViewBtn"),
  allViewBtn: document.querySelector("#allViewBtn"),
  shinyOnly: document.querySelector("#shinyOnlyInput"),
  contentBackground: document.querySelector("#contentBackgroundInput"),
  simpleBackground: document.querySelector("#simpleBackgroundInput"),
  columnsInput: document.querySelector("#columnsInput"),
  columnsCount: document.querySelector("#columnsCount"),
  withImagesCount: document.querySelector("#withImagesCount"),
  totalSummaryCount: document.querySelector("#totalSummaryCount"),
  imageDialog: document.querySelector("#imageDialog"),
  dialogImage: document.querySelector("#dialogImage"),
  dialogCaption: document.querySelector("#dialogCaption"),
  closeDialogBtn: document.querySelector("#closeDialogBtn"),
  prevImageBtn: document.querySelector("#prevImageBtn"),
  nextImageBtn: document.querySelector("#nextImageBtn"),
  candidateDialog: document.querySelector("#candidateDialog"),
  candidateGrid: document.querySelector("#candidateGrid"),
  closeCandidateDialogBtn: document.querySelector("#closeCandidateDialogBtn"),
};

init();
registerServiceWorker();

async function init() {
  wireControls();

  if (restoreLocalData()) {
    render();
    setStatus(`本地 ${state.cardsByDex.size} / Local`);
    return;
  }

  render();
  setStatus("本地数据缺失 / Missing local data");
}

function wireControls() {
  configureColumnControl();

  els.search.addEventListener("input", () => {
    state.query = els.search.value.trim().toLowerCase();
    render();
  });

  els.generation.addEventListener("change", () => {
    state.generation = els.generation.value;
    render();
  });

  els.withImagesViewBtn.addEventListener("click", () => {
    state.viewMode = "with-images";
    render();
  });

  els.allViewBtn.addEventListener("click", () => {
    state.viewMode = "all";
    render();
  });

  els.shinyOnly.addEventListener("change", () => {
    state.shinyOnly = els.shinyOnly.checked;
    render();
  });

  els.contentBackground.addEventListener("change", () => {
    state.backgroundFilters.content = els.contentBackground.checked;
    render();
  });

  els.simpleBackground.addEventListener("change", () => {
    state.backgroundFilters.simple = els.simpleBackground.checked;
    render();
  });

  els.closeDialogBtn.addEventListener("click", () => {
    els.imageDialog.close();
  });

  els.prevImageBtn.addEventListener("click", () => {
    showAdjacentHighResImage(-1);
  });

  els.nextImageBtn.addEventListener("click", () => {
    showAdjacentHighResImage(1);
  });

  els.imageDialog.addEventListener("click", (event) => {
    if (event.target === els.imageDialog) els.imageDialog.close();
  });

  els.imageDialog.addEventListener("close", () => {
    state.imageDialogCards = [];
    state.imageDialogIndex = -1;
    state.imageDialogOnSelect = null;
  });

  document.addEventListener("keydown", (event) => {
    if (!els.imageDialog.open) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showAdjacentHighResImage(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      showAdjacentHighResImage(1);
    }
  });

  els.closeCandidateDialogBtn.addEventListener("click", () => {
    els.candidateDialog.close();
  });

  els.candidateDialog.addEventListener("click", (event) => {
    if (event.target === els.candidateDialog) els.candidateDialog.close();
  });
}

function configureColumnControl() {
  const mediaQuery = window.matchMedia("(max-width: 720px)");
  state.desktopColumns = readStoredColumns(COLUMN_STORAGE_KEYS.desktop, state.desktopColumns, 6, 55);
  state.mobileColumns = readStoredColumns(COLUMN_STORAGE_KEYS.mobile, state.mobileColumns, 1, 10);

  const applyColumnRange = () => {
    const isMobile = mediaQuery.matches;
    const min = isMobile ? 1 : 6;
    const max = isMobile ? 10 : 55;
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
  els.grid.style.setProperty("--grid-columns", String(columns));
  els.grid.classList.toggle("image-only", columns > getImageOnlyColumnThreshold());
}

function getImageOnlyColumnThreshold() {
  return window.matchMedia("(max-width: 720px)").matches ? 2 : 10;
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

  state.species = data.species || [];
  state.speciesCnByDex = new Map((data.species_cn || []).map(([id, name]) => [Number(id), name]));
  state.setsById = new Map(data.setsById || []);
  state.cardsByDex = buildCardsByDexIndex(data.cardsByDex || []);

  return state.species.length > 0 && state.cardsByDex.size > 0;
}

function buildCardsByDexIndex(cardsByDex) {
  const index = new Map();

  for (const [dexId, cards] of cardsByDex) {
    const fallbackDexId = Number(dexId);
    for (const card of cards || []) {
      for (const targetDexId of getCardDexIds(card, fallbackDexId)) {
        const bucket = index.get(targetDexId) || [];
        bucket.push(card);
        index.set(targetDexId, bucket);
      }
    }
  }

  return index;
}

function render() {
  const species = getRenderableSpecies();
  els.grid.replaceChildren();

  const fragment = document.createDocumentFragment();
  for (const mon of species) {
    fragment.appendChild(renderDexCard(mon));
  }

  els.grid.appendChild(fragment);
  updateSummary();
}

function updateSummary() {
  const scopedSpecies = getScopedSpecies();
  const withImages = scopedSpecies.filter((mon) => hasVisibleCardImage(mon.id)).length;
  els.withImagesCount.textContent = withImages;
  els.totalSummaryCount.textContent = scopedSpecies.length;
  els.withImagesViewBtn.classList.toggle("active", state.viewMode === "with-images");
  els.allViewBtn.classList.toggle("active", state.viewMode === "all");
  els.withImagesViewBtn.setAttribute("aria-pressed", String(state.viewMode === "with-images"));
  els.allViewBtn.setAttribute("aria-pressed", String(state.viewMode === "all"));
  els.shinyOnly.checked = state.shinyOnly;
  els.contentBackground.checked = state.backgroundFilters.content;
  els.simpleBackground.checked = state.backgroundFilters.simple;
  els.contentBackground.disabled = state.shinyOnly;
  els.simpleBackground.disabled = state.shinyOnly;
}

function getRenderableSpecies() {
  const scopedSpecies = getScopedSpecies();
  if (state.viewMode === "with-images") {
    return scopedSpecies.filter((mon) => hasVisibleCardImage(mon.id));
  }
  return scopedSpecies;
}

function getScopedSpecies() {
  const [start, end] = state.generation === "all" ? [1, 1025] : NATIONAL_DEX_RANGES[state.generation];
  const base = state.species.length
    ? state.species
    : Array.from(state.cardsByDex.keys(), (id) => ({ id, name: `#${String(id).padStart(4, "0")}` }));

  return base.filter((mon) => {
    const hasCards = state.cardsByDex.has(mon.id);
    const cnName = state.speciesCnByDex.get(mon.id) || "";
    const inRange = mon.id >= start && mon.id <= end;
    const queryText = getSpeciesSearchText(mon, cnName);
    const matchesQuery = !state.query || queryText.includes(state.query);
    return inRange && matchesQuery;
  });
}

function getSpeciesSearchText(mon, cnName) {
  const cards = state.cardsByDex.get(mon.id) || [];
  return [
    String(mon.id).padStart(4, "0"),
    mon.name,
    cnName,
    getSpeciesTagText(mon.id),
    ...cards.flatMap((card) => [card.cardName, getCardDexSearchText(card, mon.id)]),
  ]
    .join(" ")
    .toLowerCase();
}

function getCardDexIds(card, fallbackDexId) {
  const ids = Array.isArray(card.dexIds) && card.dexIds.length ? card.dexIds : [fallbackDexId];
  return Array.from(new Set(ids.map(Number).filter((id) => Number.isFinite(id) && id > 0)));
}

function getCardDexSearchText(card, fallbackDexId) {
  return getCardDexIds(card, fallbackDexId)
    .flatMap((dexId) => {
      const species = state.species.find((mon) => Number(mon.id) === dexId);
      return [String(dexId).padStart(4, "0"), species?.name || "", state.speciesCnByDex.get(dexId) || ""];
    })
    .join(" ");
}

function getSpeciesTagText(dexId) {
  return (state.cardsByDex.get(dexId) || [])
    .flatMap((card) => (Array.isArray(card.tags) ? card.tags : []))
    .join(" ");
}

function hasVisibleCardImage(dexId) {
  return state.shinyOnly ? hasShinyCardImage(dexId) : hasFilteredCardImage(dexId);
}

function hasFilteredCardImage(dexId) {
  return (state.cardsByDex.get(dexId) || []).some(
    (card) => isCardVisibleByBackground(card) && getImageUrls(card, "low").length > 0
  );
}

function hasShinyCardImage(dexId) {
  return (state.cardsByDex.get(dexId) || []).some((card) => card.isShiny && getImageUrls(card, "low").length > 0);
}

function isCardVisibleByBackground(card) {
  const backgroundType = getStoredBackgroundType(card);
  if (backgroundType === "content") return state.backgroundFilters.content;
  if (backgroundType === "simple") return state.backgroundFilters.simple;
  return false;
}

function getStoredBackgroundType(card) {
  if (card.backgroundType) return card.backgroundType;
  const label = String(card.label || "").toLowerCase();
  const rarity = String(card.rarity || "").toLowerCase();
  if (label === "fa" || rarity === "ultra rare") return "simple";
  if (["ir", "sir", "promo"].includes(label) || rarity.includes("illustration")) return "content";
  return "other";
}

function renderDexCard(mon) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const cards = state.cardsByDex.get(mon.id) || [];
  const zhName = state.speciesCnByDex.get(mon.id) || "";
  let activeFormKey = state.shinyOnly ? "shiny" : "base";

  node.querySelector(".dex-number").textContent = `#${String(mon.id).padStart(4, "0")}`;
  setCardTitle(node, mon.name, zhName);

  const image = node.querySelector("img");
  const select = node.querySelector("select");
  const galleryButton = node.querySelector(".card-gallery-button");
  const formButtons = node.querySelector(".form-buttons");
  const forms = getCandidateForms(cards, mon);
  let selectedCardId = "";

  if (forms.length) {
    for (const form of forms) {
      const button = document.createElement("button");
      button.className = "form-button";
      button.type = "button";
      button.textContent = form.label;
      button.title = form.label;
      button.dataset.formKey = form.key;
      button.setAttribute("aria-pressed", String(form.key === activeFormKey));
      if (form.key === activeFormKey) button.classList.add("active");
      button.addEventListener("click", () => {
        activeFormKey = activeFormKey === form.key ? "base" : form.key;
        selectedCardId = "";
        updateFormButtons();
        rebuildOptions();
      });
      formButtons.appendChild(button);
    }
  }

  const applyCard = (card) => {
    setCardTitle(node, mon.name, zhName);
    const imageUrls = getImageUrls(card, "low");
    if (!imageUrls.length) {
      node.classList.add("empty");
      image.removeAttribute("src");
      image.alt = "";
      image.onclick = null;
      return;
    }

    node.classList.remove("empty");
    selectedCardId = card.id;
    image.alt = `${card.cardName} ${getCardSourceLabel(card)}`;
    applyImageUrls(image, imageUrls, () => {
      node.classList.add("empty");
      image.removeAttribute("src");
      image.alt = "";
      image.onclick = null;
    });
    image.onclick = () =>
      openHighResImage(card, getActiveCards().filter((item) => getImageUrls(item, "high").length > 0), (nextCard) => {
        selectedCardId = nextCard.id;
        select.value = nextCard.id;
        applyCard(nextCard);
      });
  };

  const updateFormButtons = () => {
    for (const button of formButtons.querySelectorAll(".form-button")) {
      const form = forms.find((item) => item.key === button.dataset.formKey);
      const isActive = form?.key === activeFormKey;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  };

  const getCardsForForm = (formKey) => {
    if (state.shinyOnly) {
      return sortCardsForMenu(cards.filter((card) => card.isShiny));
    }

    if (formKey === "base") {
      return sortCardsForMenu(cards.filter((card) => !isRegionalForm(card.form) && isCardVisibleByBackground(card)));
    }

    if (formKey === "shiny") {
      return sortCardsForMenu(cards.filter((card) => card.isShiny));
    }

    return sortCardsForMenu(cards.filter((card) => card.form.key === formKey && isCardVisibleByBackground(card)));
  };

  const getFallbackRegionalFormKey = () => {
    return forms.find((form) => getCardsForForm(form.key).some((card) => getImageUrls(card, "low").length > 0))?.key || "";
  };

  const getActiveCards = () => {
    const activeCards = getCardsForForm(activeFormKey);
    if (activeFormKey !== "base" || state.shinyOnly || activeCards.some((card) => getImageUrls(card, "low").length > 0)) {
      return activeCards;
    }

    const fallbackFormKey = getFallbackRegionalFormKey();
    if (!fallbackFormKey) return activeCards;
    activeFormKey = fallbackFormKey;
    updateFormButtons();
    return getCardsForForm(activeFormKey);
  };

  const rebuildOptions = () => {
    const activeCards = getActiveCards();
    select.replaceChildren();
    galleryButton.disabled = activeCards.length < 2;

    if (!activeCards.length) {
      node.classList.add("empty");
      image.removeAttribute("src");
      image.onclick = null;
      const option = document.createElement("option");
      option.textContent = "暂无卡图 / No image";
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    node.classList.remove("empty");
    const selectedCard = activeCards.find((card) => card.id === selectedCardId) || activeCards[0];

    for (const card of activeCards) {
      const option = document.createElement("option");
      option.value = card.id;
      option.textContent = formatCardOptionLabel(card);
      select.appendChild(option);
    }

    select.disabled = activeCards.length < 2;
    select.value = selectedCard.id;
    applyCard(selectedCard);
  };

  rebuildOptions();
  select.addEventListener("change", () => {
    const activeCards = getActiveCards();
    const selected = activeCards.find((card) => card.id === select.value) || activeCards[0];
    applyCard(selected);
  });
  galleryButton.addEventListener("click", () => {
    const activeCards = getActiveCards();
    if (activeCards.length < 2) return;
    openCandidateDialog(activeCards, selectedCardId, (card) => {
      selectedCardId = card.id;
      select.value = card.id;
      applyCard(card);
    });
  });

  return node;
}

function openCandidateDialog(cards, selectedCardId, onSelect) {
  els.candidateGrid.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (const card of cards) {
    const imageUrls = getImageUrls(card, "low");
    if (!imageUrls.length) continue;

    const button = document.createElement("button");
    button.className = "candidate-card";
    button.type = "button";
    button.classList.toggle("active", card.id === selectedCardId);
    button.setAttribute("aria-label", formatCardOptionLabel(card));

    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    applyImageUrls(image, imageUrls);
    button.appendChild(image);

    button.addEventListener("click", () => {
      onSelect(card);
      els.candidateDialog.close();
    });

    fragment.appendChild(button);
  }

  els.candidateGrid.appendChild(fragment);
  els.candidateDialog.showModal();
}

function sortCardsForMenu(cards) {
  return [...cards].sort(compareCardsByRelease);
}

function compareCardsByRelease(a, b) {
  const releaseDiff = getCardReleaseTime(b) - getCardReleaseTime(a);
  if (releaseDiff) return releaseDiff;

  const numberDiff = getSortableCardNumber(b) - getSortableCardNumber(a);
  if (numberDiff) return numberDiff;

  return String(a.id || "").localeCompare(String(b.id || ""), undefined, { numeric: true });
}

function getCardReleaseTime(card) {
  const releaseDate = card.releaseDate || getSetMeta(card).releaseDate || "";
  const time = Date.parse(releaseDate);
  return Number.isFinite(time) ? time : 0;
}

function getSortableCardNumber(card) {
  const raw = String(card.number || getPrintedNumber(card) || "");
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : -1;
}

function openHighResImage(card, cards = [card], onSelect = null) {
  const imageCards = cards.length ? cards : [card];
  const selectedIndex = imageCards.findIndex((item) => item.id === card.id);
  state.imageDialogCards = imageCards;
  state.imageDialogIndex = selectedIndex >= 0 ? selectedIndex : 0;
  state.imageDialogOnSelect = onSelect;
  renderHighResImage(imageCards[state.imageDialogIndex]);
  els.imageDialog.showModal();
}

function renderHighResImage(card) {
  const imageUrls = getImageUrls(card, "high");
  applyImageUrls(els.dialogImage, imageUrls);
  els.dialogImage.alt = `${card.cardName} ${getCardSourceLabel(card)}`;
  els.dialogCaption.textContent = `${card.cardName} · ${getCardSourceLabel(card)}`;
  updateImageNavButtons();
}

function showAdjacentHighResImage(direction) {
  const cards = state.imageDialogCards;
  if (cards.length < 2) return;

  const nextIndex = (state.imageDialogIndex + direction + cards.length) % cards.length;
  state.imageDialogIndex = nextIndex;
  const card = cards[nextIndex];
  renderHighResImage(card);
  state.imageDialogOnSelect?.(card);
}

function updateImageNavButtons() {
  const canNavigate = state.imageDialogCards.length > 1;
  els.prevImageBtn.hidden = !canNavigate;
  els.nextImageBtn.hidden = !canNavigate;
  els.prevImageBtn.disabled = !canNavigate;
  els.nextImageBtn.disabled = !canNavigate;
}

function getCardSourceLabel(card) {
  if (card.source) return card.source;
  const printedNumber = getPrintedNumber(card);
  return [getSetName(card), printedNumber ? `#${printedNumber}` : "", card.rarity].filter(Boolean).join(" · ");
}

function formatCardOptionLabel(card) {
  const language = card.language || "EN";
  const era = getMenuEraCode(card);
  const setCode = getMenuSetCode(card);
  const number = getMenuCardNumber(card);
  return `[${language}] ${[era, setCode, number].filter(Boolean).join("-")}`;
}

function getMenuEraCode(card) {
  const id = String(card.setId || card.id || "").toLowerCase();
  const setMeta = getSetMeta(card);
  if (card.eraCode || setMeta.eraCode) return card.eraCode || setMeta.eraCode;
  if (id.startsWith("me")) return "ME";
  if (id.startsWith("sv")) return "SV";
  if (id.startsWith("swsh")) return "SWSH";
  if (id.startsWith("sm")) return "SM";
  if (id.startsWith("xy")) return "XY";
  if (id.startsWith("bw")) return "BW";
  if (id.startsWith("dp")) return "DP";
  if (id.startsWith("pl")) return "PL";
  if (id.startsWith("hgss")) return "HGSS";
  if (id.startsWith("ex")) return "EX";
  if (id.startsWith("base")) return "BASE";
  return getSetDisplayCode(card.setId);
}

function getMenuSetCode(card) {
  const setMeta = getSetMeta(card);
  const ptcgoCode = String(setMeta.ptcgoCode || "").trim();
  if (card.label === "Promo" || /^PR-/i.test(ptcgoCode)) return "PROMO";
  return ptcgoCode || getSetDisplayCode(card.setId) || card.setId || setMeta.name || "";
}

function getMenuCardNumber(card) {
  if (card.variant?.number) {
    return [card.number, card.variant.number].filter(Boolean).map(formatMenuNumberPart).join("-");
  }
  const number = String(card.number || getPrintedNumber(card) || "").split("/")[0];
  return formatMenuNumberPart(number);
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

function formatMenuNumberPart(number) {
  return /^\d+$/.test(number) ? String(Number(number)) : number;
}

function getSetDisplayCode(setId) {
  const swshMatch = String(setId || "").match(/^swsh(\d+)(?:\.(\d+))?$/i);
  if (swshMatch) return `SWSH${String(swshMatch[1]).padStart(2, "0")}${swshMatch[2] ? `.${swshMatch[2]}` : ""}`;
  return String(setId || "").toUpperCase();
}

function getImageUrls(card, size) {
  const sources = getLocalImageSources(card) || [];

  const urls = [];
  for (const source of sources) {
    if (size === "high") {
      urls.push(source.high, source.fallbackHigh, source.low, source.fallbackLow);
    } else {
      urls.push(source.low, source.fallbackLow);
    }
  }

  return Array.from(new Set(urls.filter(Boolean)));
}

function getLocalImageSources(card) {
  const localSources = (card.imageSources || []).filter((source) => {
    const urls = [source.low, source.fallbackLow, source.high, source.fallbackHigh].filter(Boolean);
    return urls.some((url) => String(url).startsWith("./assets/cards/"));
  });

  if (localSources.length) return localSources;

  const localUrls = [card.image, card.fallbackImage, card.highImage, card.highFallbackImage].filter((url) =>
    String(url || "").startsWith("./assets/cards/")
  );

  if (!localUrls.length) return null;

  const localUrl = localUrls[0];
  return [
    {
      low: localUrl,
      fallbackLow: localUrl,
      high: localUrl,
      fallbackHigh: localUrl,
    },
  ];
}

function applyImageUrls(image, urls, onExhausted) {
  let index = 0;
  image.onerror = () => {
    index += 1;
    if (urls[index]) {
      image.src = urls[index];
      return;
    }
    if (onExhausted) onExhausted();
  };
  image.src = urls[0] || "";
}

function setCardTitle(node, englishName, zhName) {
  const title = node.querySelector("h2");
  title.replaceChildren();

  const en = document.createElement("span");
  en.className = "name-en";
  en.textContent = englishName;
  title.appendChild(en);

  if (zhName) {
    const zh = document.createElement("span");
    zh.className = "name-zh";
    zh.textContent = zhName;
    title.appendChild(zh);
  }
}

function getCandidateForms(cards, mon) {
  const formsByKey = new Map();
  const indexedNames = window.POKEMON_FORM_NAMES?.[String(mon.id)] || [mon.name];

  for (const name of indexedNames) {
    const form = getIndexedForm(name, mon.name, mon.id);
    if (!isRegionalForm(form)) continue;
    formsByKey.set(form.key, form);
  }

  for (const card of cards) {
    if (!isRegionalForm(card.form)) continue;
    formsByKey.set(card.form.key, card.form);
  }

  const forms = Array.from(formsByKey.values());
  forms.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  return forms;
}

function isRegionalForm(form) {
  return REGIONAL_FORM_KEYS.has(form?.key);
}

function getIndexedForm(name, baseName, dexId) {
  const form = getCardForm(name, [dexId]);
  if (form.key !== "base" || normalizeCardName(name) === normalizeCardName(baseName)) {
    return form;
  }

  return {
    key: `form-${slugify(name)}`,
    label: name,
    rank: 40,
  };
}

function getCardForm(name, dexIds = []) {
  const normalized = String(name || "").toLowerCase();
  const dexIdSet = new Set((dexIds || []).map(Number));
  if (dexIdSet.has(6) && /\bm\s+charizard\b/.test(normalized) && !/\bx\b/.test(normalized)) {
    return { key: "mega-y", label: "Mega Y", rank: 21 };
  }

  const formMatchers = [
    { key: "alolan", label: "Alolan", rank: 10, pattern: /\balolan\b/ },
    { key: "galarian", label: "Galarian", rank: 11, pattern: /\bgalarian\b/ },
    { key: "hisuian", label: "Hisuian", rank: 12, pattern: /\bhisuian\b/ },
    { key: "paldean", label: "Paldean", rank: 13, pattern: /\bpaldean\b/ },
    { key: "mega-x", label: "Mega X", rank: 20, pattern: /\bmega\b.*\bx\b|\bm\s+[^,]+[- ]?ex\b.*\bx\b/ },
    { key: "mega-y", label: "Mega Y", rank: 21, pattern: /\bmega\b.*\by\b|\bm\s+[^,]+[- ]?ex\b.*\by\b/ },
    { key: "mega", label: "Mega", rank: 22, pattern: /\bmega\b|\bm\s+[a-z]/ },
    { key: "primal", label: "Primal", rank: 23, pattern: /\bprimal\b/ },
    { key: "origin", label: "Origin", rank: 30, pattern: /\borigin\b/ },
    { key: "therian", label: "Therian", rank: 31, pattern: /\btherian\b/ },
    { key: "sky", label: "Sky", rank: 32, pattern: /\bsky forme\b/ },
    { key: "crowned", label: "Crowned", rank: 33, pattern: /\bcrowned\b/ },
    { key: "dusk-mane", label: "Dusk Mane", rank: 34, pattern: /\bdusk mane\b/ },
    { key: "dawn-wings", label: "Dawn Wings", rank: 35, pattern: /\bdawn wings\b/ },
    { key: "black", label: "Black", rank: 36, pattern: /\bblack kyurem\b/ },
    { key: "white", label: "White", rank: 37, pattern: /\bwhite kyurem\b/ },
    { key: "partner", label: "Partner", rank: 38, pattern: /\bpartner\b/ },
  ];

  return (
    formMatchers.find((form) => form.pattern.test(normalized)) || {
      key: "base",
      label: "Base",
      rank: 0,
    }
  );
}

function normalizeCardName(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return normalizeCardName(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function setStatus() {
  if (!state.species.length) {
    els.withImagesCount.textContent = "0";
    els.totalSummaryCount.textContent = "0";
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
