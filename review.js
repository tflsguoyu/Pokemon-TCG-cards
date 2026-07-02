const STORAGE_KEY = "ptcg-card-review-v1";
const BACKGROUND_TYPES = ["content", "simple", "other"];

const state = {
  cards: [],
  setsById: new Map(),
  decisions: new Map(),
  shinyDecisions: new Map(),
  query: "",
  type: "all",
  view: "all",
  activeSeriesIndex: -1,
  seriesNavRaf: 0,
};

const els = {
  grid: document.querySelector("#reviewGrid"),
  template: document.querySelector("#reviewCardTemplate"),
  search: document.querySelector("#searchInput"),
  type: document.querySelector("#typeSelect"),
  view: document.querySelector("#viewSelect"),
  summary: document.querySelector("#summary"),
  eraNav: document.querySelector("#eraNav"),
  seriesNav: document.querySelector("#seriesNav"),
  save: document.querySelector("#saveBtn"),
  imageDialog: document.querySelector("#imageDialog"),
  dialogImage: document.querySelector("#dialogImage"),
  dialogCaption: document.querySelector("#dialogCaption"),
  closeDialog: document.querySelector("#closeDialogBtn"),
};

init();

function init() {
  state.cards = loadCards();
  const saved = loadSavedReviewState();
  state.decisions = saved.decisions;
  state.shinyDecisions = saved.shinyDecisions;
  pruneStaleDecisions();
  wireControls();
  render();
}

function wireControls() {
  els.search.addEventListener("input", () => {
    state.query = els.search.value.trim().toLowerCase();
    render();
  });

  els.type.addEventListener("change", () => {
    state.type = els.type.value;
    render();
  });

  els.view.addEventListener("change", () => {
    state.view = els.view.value;
    render();
  });

  els.save.addEventListener("click", saveResults);
  els.closeDialog.addEventListener("click", () => els.imageDialog.close());
  els.imageDialog.addEventListener("click", (event) => {
    if (event.target === els.imageDialog) els.imageDialog.close();
  });

  document.querySelector("main").addEventListener("scroll", scheduleSeriesNavHighlight, { passive: true });
}

function loadCards() {
  const data = window.PTCG_LOCAL_DATA || {};
  const speciesCn = new Map((data.species_cn || []).map(([id, name]) => [Number(id), name]));
  state.setsById = new Map(data.setsById || []);
  const cardsById = new Map();

  for (const [dexId, cardList] of data.cardsByDex || []) {
    for (const card of cardList) {
      if (cardsById.has(card.id)) continue;
      const cardDexIds = getCardDexIds(card, Number(dexId));
      cardsById.set(card.id, {
        dexId: Number(dexId),
        dexIds: cardDexIds,
        zhName: speciesCn.get(Number(dexId)) || "",
        dexSearchText: getDexSearchText(cardDexIds, data.species || [], speciesCn),
        originalBackgroundType: normalizeBackgroundType(card.backgroundType),
        originalIsShiny: Boolean(card.isShiny),
        ...card,
      });
    }
  }

  const cards = Array.from(cardsById.values());
  cards.sort(
    (a, b) =>
      compareSetCode(a, b) ||
      compareCardNumber(a, b) ||
      a.dexId - b.dexId ||
      BACKGROUND_TYPES.indexOf(a.originalBackgroundType) - BACKGROUND_TYPES.indexOf(b.originalBackgroundType)
  );
  return cards;
}

function compareSetCode(a, b) {
  return (
    getEraRank(a) - getEraRank(b) ||
    getReviewEraCode(a).localeCompare(getReviewEraCode(b)) ||
    getSetNumber(a) - getSetNumber(b) ||
      String(getPtcgoCode(a) || a.setId || "").localeCompare(String(getPtcgoCode(b) || b.setId || ""), undefined, { numeric: true })
  );
}

function getEraRank(card) {
  const era = getReviewEraCode(card);
  const ranks = ["BASE", "EX", "DP", "PL", "HGSS", "BW", "XY", "SM", "SWSH", "SV", "ME", "简中"];
  const rank = ranks.indexOf(era);
  return rank === -1 ? 999 : rank;
}

function getSetNumber(card) {
  const id = String(card.setId || card.id || "").toLowerCase();
  const popMatch = id.match(/^pop(\d+(?:\.\d+)?)/);
  if (popMatch) return Number(popMatch[1]) / 10;
  const match = id.match(/(?:me|sv|swsh|sm|xy|bw|dp|pl|hgss|ex|base)(\d+(?:\.\d+)?)/);
  if (match) return Number(match[1]);
  if (/p$/.test(id) || /promo/i.test(getSetName(card)) || /^PR-/i.test(getPtcgoCode(card))) return 999;
  return 998;
}

function compareCardNumber(a, b) {
  return (
    getCardNumberPrefix(a).localeCompare(getCardNumberPrefix(b)) ||
    getCardNumberValue(a) - getCardNumberValue(b) ||
    String(a.number || "").localeCompare(String(b.number || ""), undefined, { numeric: true })
  );
}

function getCardNumberPrefix(card) {
  return String(card.number || getPrintedNumber(card) || "").split("/")[0].match(/^[A-Za-z]+/)?.[0] || "";
}

function getCardNumberValue(card) {
  const match = String(card.number || getPrintedNumber(card) || "").split("/")[0].match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function loadSavedReviewState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      decisions: new Map(Object.entries(saved.decisions || {})),
      shinyDecisions: new Map(Object.entries(saved.shinyDecisions || {}).map(([cardId, value]) => [cardId, Boolean(value)])),
    };
  } catch {
    return { decisions: new Map(), shinyDecisions: new Map() };
  }
}

function pruneStaleDecisions() {
  const cardById = new Map(state.cards.map((card) => [card.id, card]));
  for (const [cardId, decision] of state.decisions) {
    const card = cardById.get(cardId);
    if (!card || decision === card.originalBackgroundType) state.decisions.delete(cardId);
  }
  for (const [cardId, isShiny] of state.shinyDecisions) {
    const card = cardById.get(cardId);
    if (!card || isShiny === card.originalIsShiny) state.shinyDecisions.delete(cardId);
  }
  persistDecisions();
}

function persistDecisions() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      decisions: Object.fromEntries(state.decisions),
      shinyDecisions: Object.fromEntries(state.shinyDecisions),
    })
  );
}

function render() {
  const cards = getVisibleCards();
  const groups = groupCardsBySeries(cards);
  const fragment = document.createDocumentFragment();
  let currentEra = "";
  let seriesIndex = -1;

  for (const group of groups) {
    const firstCard = group[0];
    const era = getReviewEraCode(firstCard);
    const isEraStart = Boolean(currentEra && era !== currentEra);
    currentEra = era;
    seriesIndex += 1;
    fragment.appendChild(renderSeriesPanel(group, { isEraStart, seriesIndex }));
  }

  els.grid.replaceChildren(fragment);
  renderEraNav(groups);
  renderSeriesNav(groups);
  updateActiveSeriesFromScroll({ scrollNav: false });
  updateSummary(cards.length);
}

function renderSeriesPanel(group, options = {}) {
  const panel = document.createElement("section");
  panel.className = "series-panel";
  panel.id = getSeriesPanelId(options.seriesIndex);
  panel.dataset.seriesTone = String((options.seriesIndex || 0) % 6);
  panel.classList.toggle("era-start", Boolean(options.isEraStart));
  panel.setAttribute("aria-label", getSeriesCountLabel(group));

  const label = renderSeriesLabel(group);
  const cards = document.createElement("div");
  cards.className = "series-cards";

  for (let index = 0; index < group.length; index += 1) {
    cards.appendChild(renderCard(group[index], { seriesIndex: options.seriesIndex }));
  }

  if (group.length % 2 === 1) {
    cards.appendChild(renderEmptySlot());
  }

  panel.append(label, cards);
  return panel;
}

function renderSeriesNav(groups) {
  const fragment = document.createDocumentFragment();

  groups.forEach((group, index) => {
    const firstCard = group[0];
    const label = getSeriesLabel(firstCard);
    const button = document.createElement("button");
    button.className = "series-nav-button";
    button.type = "button";
    button.dataset.seriesTone = String(index % 6);
    button.dataset.seriesIndex = String(index);
    button.textContent = getSeriesNavLabel(firstCard);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => {
      setActiveSeriesIndex(index);
      scrollToSeries(index);
    });
    fragment.appendChild(button);
  });

  els.seriesNav.replaceChildren(fragment);
}

function renderEraNav(groups) {
  const fragment = document.createDocumentFragment();
  const eraItems = getEraItems(groups);

  for (const item of eraItems) {
    const button = document.createElement("button");
    button.className = "era-nav-button";
    button.type = "button";
    button.textContent = `${item.era} ${item.count}`;
    button.title = `${item.era} · ${item.count} 个系列`;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", () => scrollToEra(item.firstSeriesIndex));
    fragment.appendChild(button);
  }

  els.eraNav.replaceChildren(fragment);
}

function getEraItems(groups) {
  const items = [];
  const itemByEra = new Map();

  groups.forEach((group, index) => {
    const era = getReviewEraCode(group[0]) || "其他";
    const existing = itemByEra.get(era);
    if (existing) {
      existing.count += 1;
      return;
    }

    const item = { era, firstSeriesIndex: index, count: 1 };
    itemByEra.set(era, item);
    items.push(item);
  });

  return items;
}

function scrollToEra(firstSeriesIndex) {
  scrollSeriesNavButtonIntoView(firstSeriesIndex, "auto");
  scrollToSeries(firstSeriesIndex, "auto");
}

function scrollSeriesNavButtonIntoView(index, behavior = "smooth") {
  const button = els.seriesNav.querySelector(`[data-series-index="${index}"]`);
  if (!button) return;
  const navLeft = els.seriesNav.scrollLeft;
  const navRight = navLeft + els.seriesNav.clientWidth;
  const buttonLeft = button.offsetLeft;
  const buttonRight = buttonLeft + button.offsetWidth;

  if (buttonLeft < navLeft + 8) {
    els.seriesNav.scrollTo({ left: Math.max(0, buttonLeft - 8), behavior });
  } else if (buttonRight > navRight - 8) {
    els.seriesNav.scrollTo({ left: Math.max(0, buttonRight - els.seriesNav.clientWidth + 8), behavior });
  }
}

function scrollToSeries(index, behavior = "smooth") {
  const panel = document.querySelector(`#${getSeriesPanelId(index)}`);
  if (!panel) return;

  const main = document.querySelector("main");
  const panelLeft = panel.offsetLeft;
  const targetLeft = Math.max(0, panelLeft - 16);
  main.scrollTo({ left: targetLeft, behavior });
}

function scheduleSeriesNavHighlight() {
  if (state.seriesNavRaf) return;
  state.seriesNavRaf = requestAnimationFrame(() => {
    state.seriesNavRaf = 0;
    updateActiveSeriesFromScroll();
  });
}

function updateActiveSeriesFromScroll(options = {}) {
  const main = document.querySelector("main");
  const panels = Array.from(els.grid.querySelectorAll(".series-panel"));
  if (!main || panels.length === 0) {
    setActiveSeriesIndex(-1, options);
    return;
  }

  const marker = main.scrollLeft + Math.min(120, main.clientWidth * 0.25);
  let activeIndex = 0;
  let closestDistance = Infinity;

  panels.forEach((panel, index) => {
    const left = panel.offsetLeft;
    const right = left + panel.offsetWidth;
    const containsMarker = marker >= left && marker < right;
    const distance = containsMarker ? 0 : Math.min(Math.abs(marker - left), Math.abs(marker - right));

    if (distance < closestDistance) {
      closestDistance = distance;
      activeIndex = index;
    }
  });

  setActiveSeriesIndex(activeIndex, options);
}

function setActiveSeriesIndex(index, options = {}) {
  if (state.activeSeriesIndex === index && index !== -1) return;
  state.activeSeriesIndex = index;

  for (const button of els.seriesNav.querySelectorAll(".series-nav-button")) {
    const isActive = Number(button.dataset.seriesIndex) === index;
    button.classList.toggle("active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "true");
    } else {
      button.removeAttribute("aria-current");
    }
  }

  if (index !== -1 && options.scrollNav !== false) {
    scrollSeriesNavButtonIntoView(index, "auto");
  }
}

function getSeriesPanelId(index) {
  return `series-panel-${index}`;
}

function groupCardsBySeries(cards) {
  const groups = [];
  let currentKey = "";
  let currentGroup = null;

  for (const card of cards) {
    const key = getSeriesKey(card);
    if (key !== currentKey) {
      currentKey = key;
      currentGroup = [];
      groups.push(currentGroup);
    }
    currentGroup.push(card);
  }

  return groups;
}

function renderSeriesLabel(group) {
  const label = document.createElement("div");
  label.className = "series-label";
  label.textContent = getSeriesCountLabel(group);
  label.title = getSeriesCountLabel(group);
  return label;
}

function renderEmptySlot() {
  const slot = document.createElement("div");
  slot.className = "empty-slot";
  slot.setAttribute("aria-hidden", "true");
  return slot;
}

function getSeriesKey(card) {
  return `${getEraRank(card)}-${getSetNumber(card)}-${card.setId || ""}-${getPtcgoCode(card)}`;
}

function getSeriesLabel(card) {
  const era = getReviewEraCode(card);
  const code = getMenuSetCode(card);
  const setName = getSetName(card);
  return [era, code, setName].filter(Boolean).join(" · ");
}

function getSeriesCountLabel(group) {
  const firstCard = group[0];
  return `${getSeriesLabel(firstCard)} (${group.length})`;
}

function getSeriesNavLabel(card) {
  const era = getReviewEraCode(card);
  const code = getMenuSetCode(card);
  return [era, code].filter(Boolean).join(" ");
}

function getVisibleCards() {
  return state.cards.filter((card) => {
    const decision = getDecision(card);
    const shinyChanged = hasShinyChange(card);
    if (state.type !== "all" && card.originalBackgroundType !== state.type) return false;
    if (state.view === "changed" && decision === card.originalBackgroundType && !shinyChanged) return false;
    if (state.view === "deleted" && decision !== "delete") return false;

    if (!state.query) return true;
    const text = [
      card.dexId,
      card.dexSearchText,
      card.cardName,
      card.zhName,
      card.id,
      getSetName(card),
      getPtcgoCode(card),
      card.setId,
      getPrintedNumber(card),
      card.label,
      card.rarity,
      card.originalBackgroundType,
      card.originalIsShiny ? "shiny" : "non shiny",
    ]
      .join(" ")
      .toLowerCase();
    return text.includes(state.query);
  });
}

function renderCard(card, options = {}) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const decision = getDecision(card);
  const isShiny = getShinyDecision(card);

  node.dataset.cardId = card.id;
  node.dataset.seriesTone = String((options.seriesIndex || 0) % 6);
  node.classList.toggle("series-start", Boolean(options.isSeriesStart));
  node.classList.toggle("era-start", Boolean(options.isEraStart));
  if (options.isSeriesStart) {
    node.title = getSeriesLabel(card);
  }
  node.classList.toggle("marked-content", decision === "content");
  node.classList.toggle("marked-simple", decision === "simple");
  node.classList.toggle("marked-other", decision === "other");
  node.classList.toggle("marked-delete", decision === "delete");
  node.classList.toggle("marked-shiny", isShiny);
  node.classList.toggle("shiny-changed", hasShinyChange(card));
  node.querySelector(".dex-number").textContent = formatDexLabel(card);
  node.querySelector("h2").textContent = card.cardName;
  node.querySelector(".card-code").textContent = formatCardCode(card);
  node.querySelector(".status-pill").textContent = getDecisionLabel(decision);

  const imageButton = node.querySelector(".image-button");
  const image = node.querySelector("img");
  const imageUrl = getImageUrl(card);
  if (imageUrl) {
    image.src = imageUrl;
    image.alt = `${card.cardName} ${formatCardCode(card)}`;
    imageButton.addEventListener("click", () => openImage(card));
  } else {
    imageButton.classList.add("empty");
  }

  for (const button of node.querySelectorAll(".choice")) {
    const action = button.dataset.action;
    button.classList.toggle("active", decision === action);
    button.addEventListener("click", () => setDecision(card, action));
  }

  for (const button of node.querySelectorAll(".shiny-choice")) {
    const value = button.dataset.shiny === "true";
    button.classList.toggle("active", isShiny === value);
    button.addEventListener("click", () => setShinyDecision(card, value));
  }

  return node;
}

function setDecision(card, action) {
  if (action === card.originalBackgroundType) {
    state.decisions.delete(card.id);
  } else {
    state.decisions.set(card.id, action);
  }
  persistDecisions();
  render();
}

function getDecision(card) {
  return state.decisions.get(card.id) || card.originalBackgroundType;
}

function setShinyDecision(card, isShiny) {
  if (isShiny === card.originalIsShiny) {
    state.shinyDecisions.delete(card.id);
  } else {
    state.shinyDecisions.set(card.id, isShiny);
  }
  persistDecisions();
  render();
}

function getShinyDecision(card) {
  return state.shinyDecisions.has(card.id) ? state.shinyDecisions.get(card.id) : card.originalIsShiny;
}

function hasShinyChange(card) {
  return state.shinyDecisions.has(card.id) && state.shinyDecisions.get(card.id) !== card.originalIsShiny;
}

function getDecisionLabel(decision) {
  if (decision === "content") return "内容";
  if (decision === "simple") return "简单";
  if (decision === "other") return "其他";
  if (decision === "delete") return "删除";
  return decision;
}

function updateSummary(visibleCount) {
  const counts = countCards(state.cards, (card) => card.originalBackgroundType);
  const decisionCounts = countCards(Array.from(state.decisions.values()), (value) => value);
  const shinyChanges = state.shinyDecisions.size;
  els.summary.textContent =
    `显示 ${visibleCount} / 全部 ${state.cards.length}` +
    ` / C ${counts.content || 0}` +
    ` / S ${counts.simple || 0}` +
    ` / O ${counts.other || 0}` +
    ` / 已改 ${state.decisions.size}` +
    ` / Shiny ${shinyChanges}` +
    ` / 删除 ${decisionCounts.delete || 0}`;
}

function countCards(items, getKey) {
  const counts = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function saveResults() {
  const payload = buildResultsPayload();
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const filename = `ptcg-review-${new Date().toISOString().slice(0, 10)}.json`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildResultsPayload() {
  const decisions = Object.fromEntries(state.decisions);
  const shinyDecisions = Object.fromEntries(state.shinyDecisions);
  return {
    source: "unified-card-review",
    generatedAt: new Date().toISOString(),
    totalCards: state.cards.length,
    decisions,
    shinyDecisions,
    contentIds: filterDecisionIds(decisions, "content"),
    simpleIds: filterDecisionIds(decisions, "simple"),
    otherIds: filterDecisionIds(decisions, "other"),
    deleteIds: filterDecisionIds(decisions, "delete"),
    shinyIds: filterShinyIds(shinyDecisions, true),
    nonShinyIds: filterShinyIds(shinyDecisions, false),
  };
}

function filterDecisionIds(decisions, action) {
  return Object.entries(decisions)
    .filter(([, value]) => value === action)
    .map(([cardId]) => cardId);
}

function filterShinyIds(decisions, isShiny) {
  return Object.entries(decisions)
    .filter(([, value]) => Boolean(value) === isShiny)
    .map(([cardId]) => cardId);
}

function openImage(card) {
  const imageUrl = getImageUrl(card);
  if (!imageUrl) return;
  els.dialogImage.src = imageUrl;
  els.dialogImage.alt = `${card.cardName} ${formatCardCode(card)}`;
  els.dialogCaption.textContent = `${card.cardName} · ${formatCardCode(card)}`;
  els.imageDialog.showModal();
}

function getImageUrl(card) {
  const source = (card.imageSources || []).find((item) => item.low || item.high);
  return source?.low || source?.high || card.image || "";
}

function isSimplifiedChineseCard(card) {
  const language = String(card.language || "").trim().toUpperCase();
  return language === "CN";
}

function getReviewEraCode(card) {
  return isSimplifiedChineseCard(card) ? "简中" : getMenuEraCode(card);
}

function formatCardCode(card) {
  const language = card.language || "EN";
  const era = getMenuEraCode(card);
  const setCode = getMenuSetCode(card);
  const number = getMenuCardNumber(card);
  const shiny = getShinyDecision(card) ? "Shiny" : "Non-shiny";
  return `[${language}] ${[era, setCode, number].filter(Boolean).join("-")} · ${card.label} · ${card.originalBackgroundType} · ${shiny}`;
}

function getMenuEraCode(card) {
  const id = String(card.setId || card.id || "").toLowerCase();
  const setMeta = getSetMeta(card);
  if (card.eraCode || setMeta.eraCode) return card.eraCode || setMeta.eraCode;
  if (id.startsWith("pop")) return "DP";
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
  const ptcgoCode = getPtcgoCode(card);
  if (card.label === "Promo" || /^PR-/i.test(ptcgoCode)) return "PROMO";
  const setMeta = getSetMeta(card);
  const code = ptcgoCode || getSetDisplayCode(card.setId) || card.setId || setMeta.name || "";
  return String(code).toUpperCase();
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

function getPtcgoCode(card) {
  return String(getSetMeta(card).ptcgoCode || "").trim();
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

function normalizeBackgroundType(value) {
  return BACKGROUND_TYPES.includes(value) ? value : "other";
}

function getCardDexIds(card, fallbackDexId) {
  const ids = Array.isArray(card.dexIds) && card.dexIds.length ? card.dexIds : [fallbackDexId];
  return Array.from(new Set(ids.map(Number).filter((id) => Number.isFinite(id) && id > 0)));
}

function getDexSearchText(dexIds, species, speciesCn) {
  const speciesById = new Map(species.map((mon) => [Number(mon.id), mon.name]));
  return dexIds
    .flatMap((dexId) => [String(dexId).padStart(4, "0"), speciesById.get(dexId) || "", speciesCn.get(dexId) || ""])
    .join(" ");
}

function formatDexLabel(card) {
  return getCardDexIds(card, card.dexId)
    .map((dexId) => `#${String(dexId).padStart(4, "0")}`)
    .join(" / ");
}
