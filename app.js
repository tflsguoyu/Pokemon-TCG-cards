const TCGDEX_BASE = "https://api.tcgdex.net/v2/en";
const POKEAPI_SPECIES = "https://pokeapi.co/api/v2/pokemon-species?limit=1300";
const CACHE_KEY = "ptcg-dex-cache-v2";
const CACHE_VERSION = 10;

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

const RARITY_GROUPS = [
  { rarity: "Illustration rare", rank: 1, label: "IR" },
  { rarity: "Special illustration rare", rank: 2, label: "SIR" },
];

const EXTRA_FULL_ART_PROMOS = [
  { id: "svp-044", rank: 4, label: "Promo" },
  { id: "svp-046", rank: 4, label: "Promo" },
  { id: "svp-048", rank: 4, label: "Promo" },
];

const SET_CODE_OVERRIDES = new Map([
  ["151", "MEW"],
  ["sv03.5", "MEW"],
  ["svp", "PR-SV"],
  ["SVP Black Star Promos", "PR-SV"],
]);

const state = {
  species: [],
  zhNamesByDex: new Map(),
  ptcgoCodesBySetName: new Map(),
  cardsByDex: new Map(),
  query: "",
  generation: "all",
};

const els = {
  grid: document.querySelector("#dexGrid"),
  template: document.querySelector("#dexCardTemplate"),
  status: document.querySelector("#status"),
  search: document.querySelector("#searchInput"),
  generation: document.querySelector("#generationSelect"),
  refreshDataBtn: document.querySelector("#refreshDataBtn"),
  shownCount: document.querySelector("#shownCount"),
  totalCount: document.querySelector("#totalCount"),
  imageDialog: document.querySelector("#imageDialog"),
  dialogImage: document.querySelector("#dialogImage"),
  dialogCaption: document.querySelector("#dialogCaption"),
  closeDialogBtn: document.querySelector("#closeDialogBtn"),
};

init();

async function init() {
  wireControls();

  if (restoreCache()) {
    render();
    setStatus(`缓存 ${state.cardsByDex.size}`);
    return;
  }

  setStatus("加载全国图鉴");

  const [species, ptcgoCodesBySetName] = await Promise.all([loadSpecies(), loadPtcgoCodes()]);
  state.species = species;
  state.ptcgoCodesBySetName = ptcgoCodesBySetName;
  await loadCardCandidates();

  render();
  setStatus(`已加载 ${state.cardsByDex.size}`);
  await loadChineseNames(species);
  saveCache();
}

function wireControls() {
  els.search.addEventListener("input", () => {
    state.query = els.search.value.trim().toLowerCase();
    render();
  });

  els.generation.addEventListener("change", () => {
    state.generation = els.generation.value;
    render();
  });

  els.refreshDataBtn.addEventListener("click", () => {
    localStorage.removeItem(CACHE_KEY);
    window.location.reload();
  });

  els.closeDialogBtn.addEventListener("click", () => {
    els.imageDialog.close();
  });

  els.imageDialog.addEventListener("click", (event) => {
    if (event.target === els.imageDialog) els.imageDialog.close();
  });
}

function restoreCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;

    const cache = JSON.parse(raw);
    if (cache.version !== CACHE_VERSION) return false;

    state.species = cache.species || [];
    state.zhNamesByDex = new Map((cache.zhNames || []).map(([id, name]) => [Number(id), name]));
    state.ptcgoCodesBySetName = new Map(cache.ptcgoCodesBySetName || []);
    state.cardsByDex = new Map(
      (cache.cardsByDex || []).map(([id, cards]) => [Number(id), cards])
    );

    return state.species.length > 0 && state.cardsByDex.size > 0;
  } catch {
    localStorage.removeItem(CACHE_KEY);
    return false;
  }
}

function saveCache() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        version: CACHE_VERSION,
        savedAt: new Date().toISOString(),
        species: state.species,
        zhNames: Array.from(state.zhNamesByDex.entries()),
        ptcgoCodesBySetName: Array.from(state.ptcgoCodesBySetName.entries()),
        cardsByDex: Array.from(state.cardsByDex.entries()),
      })
    );
  } catch {
    setStatus("已加载完成，但本地缓存空间不足");
  }
}

async function loadPtcgoCodes() {
  try {
    const response = await fetch("https://api.pokemontcg.io/v2/sets");
    if (!response.ok) return new Map();
    const payload = await response.json();
    return new Map(
      (payload.data || [])
        .filter((set) => set.name && set.ptcgoCode)
        .map((set) => [normalizeSetName(set.name), set.ptcgoCode])
    );
  } catch {
    return new Map();
  }
}

async function loadSpecies() {
  try {
    const response = await fetch(POKEAPI_SPECIES);
    const payload = await response.json();
    return payload.results
      .map((item) => {
        const id = Number(item.url.match(/pokemon-species\/(\d+)\//)?.[1]);
        return { id, name: titleCase(item.name) };
      })
      .filter((item) => item.id && item.id <= 1025)
      .sort((a, b) => a.id - b.id);
  } catch {
    return [];
  }
}

async function loadChineseNames(species) {
  if (!species.length) return;
  setStatus("补充中文名");

  let loaded = 0;
  await mapLimit(species, 18, async (mon) => {
    const zhName = await fetchChineseName(mon.id);
    loaded += 1;
    if (zhName) state.zhNamesByDex.set(mon.id, zhName);
    if (loaded % 80 === 0) {
      setStatus(`补充中文名 ${loaded}/${species.length}`);
      render();
    }
  });

  render();
  setStatus(`完成 ${state.cardsByDex.size}`);
}

async function fetchChineseName(id) {
  try {
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
    if (!response.ok) return "";
    const payload = await response.json();
    const names = payload.names || [];
    return (
      names.find((entry) => entry.language?.name === "zh-hans")?.name ||
      names.find((entry) => entry.language?.name === "zh-hant")?.name ||
      names.find((entry) => entry.language?.name === "zh-Hans")?.name ||
      names.find((entry) => entry.language?.name === "zh-Hant")?.name ||
      ""
    );
  } catch {
    return "";
  }
}

async function loadCardCandidates() {
  const seen = new Set();
  let loaded = 0;

  for (const group of RARITY_GROUPS) {
    setStatus(`加载 ${group.label}`);
    const cards = await fetchCardsByRarity(group.rarity);
    const pokemonCards = cards.filter((card) => card.image);

    await mapLimit(pokemonCards, 12, async (brief) => {
      if (seen.has(brief.id)) return;
      seen.add(brief.id);

      const detail = await fetchCardDetail(brief.id);
      loaded += 1;
      if (loaded % 40 === 0) setStatus(`整理候选卡 ${loaded}`);

      if (!detail || detail.category !== "Pokemon" || detail.rarity !== group.rarity || !Array.isArray(detail.dexId)) {
        return;
      }

      for (const dexId of detail.dexId) {
        if (!Number.isInteger(dexId) || dexId > 1025) continue;
        addCandidate(dexId, normalizeCandidate(detail, group));
      }
    });
  }

  await loadAlternateFullArtCandidates();

  for (const promo of EXTRA_FULL_ART_PROMOS) {
    const detail = await fetchCardDetail(promo.id);
    if (!detail || detail.category !== "Pokemon" || !Array.isArray(detail.dexId)) continue;

    for (const dexId of detail.dexId) {
      if (!Number.isInteger(dexId) || dexId > 1025) continue;
      addCandidate(dexId, normalizeCandidate(detail, promo));
    }
  }
}

async function loadAlternateFullArtCandidates() {
  setStatus("加载 Alt Art");
  const cards = await fetchCardsByRarity("Ultra Rare");
  const details = [];

  await mapLimit(cards.filter((card) => card.image), 12, async (brief) => {
    const detail = await fetchCardDetail(brief.id);
    if (
      detail?.category === "Pokemon" &&
      detail.rarity === "Ultra Rare" &&
      Array.isArray(detail.dexId) &&
      detail.set?.id?.startsWith("swsh") &&
      /^\d+$/.test(String(detail.localId || ""))
    ) {
      details.push(detail);
    }
  });

  const groups = new Map();
  for (const detail of details) {
    const key = `${detail.set?.id || ""}:${normalizeCardName(detail.name)}`;
    const group = groups.get(key) || [];
    group.push(detail);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => getCardNumber(a.localId) - getCardNumber(b.localId));
    for (const detail of group.slice(-1)) {
      for (const dexId of detail.dexId) {
        if (!Number.isInteger(dexId) || dexId > 1025) continue;
        addCandidate(dexId, normalizeCandidate(detail, { rank: 3, label: "Alt Art" }));
      }
    }
  }
}

function addCandidate(dexId, candidate) {
  const existing = state.cardsByDex.get(dexId) || [];
  if (!existing.some((card) => card.id === candidate.id)) {
    existing.push(candidate);
    existing.sort(compareCandidate);
    state.cardsByDex.set(dexId, existing);
  }
}

async function fetchCardsByRarity(rarity) {
  const url = `${TCGDEX_BASE}/cards?rarity=${encodeURIComponent(rarity)}`;
  const response = await fetch(url);
  if (!response.ok) return [];
  return response.json();
}

async function fetchCardDetail(id) {
  try {
    const response = await fetch(`${TCGDEX_BASE}/cards/${id}`);
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function normalizeCandidate(card, group) {
  const source = [
    card.set?.name,
    card.localId ? `#${card.localId}` : "",
    card.rarity,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    id: card.id,
    name: card.name,
    image: `${card.image}/low.webp`,
    fallbackImage: `${card.image}/low.png`,
    highImage: `${card.image}/high.webp`,
    highFallbackImage: `${card.image}/high.png`,
    source,
    eraCode: getEraCode(card.set),
    ptcgoCode: getPtcgoCode(card.set),
    setId: card.set?.id || "",
    setName: card.set?.name || "",
    number: card.localId || "",
    rarity: card.rarity || group.rarity,
    label: group.label,
    rank: group.rank,
    updated: card.updated || "",
  };
}

function compareCandidate(a, b) {
  return (
    a.rank - b.rank ||
    String(b.updated).localeCompare(String(a.updated)) ||
    a.setName.localeCompare(b.setName) ||
    String(a.number).localeCompare(String(b.number), undefined, { numeric: true })
  );
}

function render() {
  const species = getRenderableSpecies();
  els.grid.replaceChildren();

  const fragment = document.createDocumentFragment();
  for (const mon of species) {
    fragment.appendChild(renderDexCard(mon));
  }

  els.grid.appendChild(fragment);
  els.shownCount.textContent = species.length;
  els.totalCount.textContent = state.species.length;
}

function getRenderableSpecies() {
  const [start, end] = state.generation === "all" ? [1, 1025] : NATIONAL_DEX_RANGES[state.generation];
  const base = state.species.length
    ? state.species
    : Array.from(state.cardsByDex.keys(), (id) => ({ id, name: `#${String(id).padStart(4, "0")}` }));

  return base.filter((mon) => {
    const hasCards = state.cardsByDex.has(mon.id);
    const zhName = state.zhNamesByDex.get(mon.id) || "";
    const inRange = mon.id >= start && mon.id <= end;
    const queryText = `${mon.id} ${mon.name} ${zhName} ${(state.cardsByDex.get(mon.id) || [])
      .map((card) => `${card.name} ${card.source}`)
      .join(" ")}`.toLowerCase();
    const matchesQuery = !state.query || queryText.includes(state.query);
    return inRange && matchesQuery;
  });
}

function renderDexCard(mon) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const cards = state.cardsByDex.get(mon.id) || [];
  const zhName = state.zhNamesByDex.get(mon.id) || "";

  node.querySelector(".dex-number").textContent = `#${String(mon.id).padStart(4, "0")}`;
  setCardTitle(node, mon.name, zhName);

  if (!cards.length) {
    node.classList.add("empty");
    return node;
  }

  const image = node.querySelector("img");
  const rarity = node.querySelector(".rarity-chip");
  const select = node.querySelector("select");

  for (const card of cards) {
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = `${card.label} · ${card.ptcgoCode || card.setId || card.setName} #${card.number}`;
    select.appendChild(option);
  }

  const applyCard = (card) => {
    setCardTitle(node, mon.name, zhName);
    rarity.textContent = [card.eraCode, card.ptcgoCode || card.setId || card.setName]
      .filter(Boolean)
      .join(" ");
    image.src = card.image;
    image.alt = `${card.name} ${card.source}`;
    image.onerror = () => {
      if (image.src !== card.fallbackImage) image.src = card.fallbackImage;
    };
    image.onclick = () => openHighResImage(card);
  };

  applyCard(cards[0]);
  select.disabled = cards.length < 2;
  select.addEventListener("change", () => {
    const selected = cards.find((card) => card.id === select.value) || cards[0];
    applyCard(selected);
  });

  return node;
}

function openHighResImage(card) {
  els.dialogImage.src = card.highImage;
  els.dialogImage.alt = `${card.name} ${card.source}`;
  els.dialogImage.onerror = () => {
    if (els.dialogImage.src !== card.highFallbackImage) {
      els.dialogImage.src = card.highFallbackImage;
    }
  };
  els.dialogCaption.textContent = `${card.name} · ${card.source}`;
  els.imageDialog.showModal();
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

async function mapLimit(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function getPtcgoCode(set) {
  if (!set) return "";
  return (
    SET_CODE_OVERRIDES.get(set.id) ||
    SET_CODE_OVERRIDES.get(set.name) ||
    state.ptcgoCodesBySetName.get(normalizeSetName(set.name || "")) ||
    ""
  );
}

function getEraCode(set) {
  const id = set?.id || "";
  const name = set?.name || "";
  const normalized = normalizeSetName(name);

  if (id.startsWith("sv") || normalized.includes("scarletviolet")) return "SV";
  if (id.startsWith("swsh") || normalized.includes("swordshield")) return "SWSH";
  if (id.startsWith("sm") || normalized.includes("sunmoon")) return "SM";
  if (id.startsWith("xy")) return "XY";
  if (id.startsWith("bw") || normalized.includes("blackwhite")) return "BW";
  if (id.startsWith("dp") || normalized.includes("diamondpearl")) return "DP";
  if (id.startsWith("pl") || normalized.includes("platinum")) return "PL";
  if (id.startsWith("hgss") || normalized.includes("heartgoldsoulsilver")) return "HGSS";
  if (id.startsWith("ex")) return "EX";
  if (id.startsWith("base")) return "BASE";
  return "";
}

function titleCase(value) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeSetName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeCardName(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function getCardNumber(value) {
  const numeric = String(value || "").match(/\d+/)?.[0];
  return numeric ? Number(numeric) : 0;
}

function setStatus(message) {
  els.status.textContent = message;
}
