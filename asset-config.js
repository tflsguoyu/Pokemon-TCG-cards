(function () {
  const RELEASE_REPOSITORY = "tflsguoyu/Pokemon-TCG-cards";
  const RELEASE_TAGS = {
    sv: "card-assets-sv",
    "swsh-me": "card-assets-swsh-me",
    legacy: "card-assets-legacy",
  };

  const params = new URLSearchParams(window.location.search);
  const forcedMode = params.get("assets");
  const isGitHubPages = window.location.hostname.endsWith(".github.io");
  const useReleaseAssets = forcedMode === "release" || (forcedMode !== "local" && isGitHubPages);

  function resolveCardImageUrl(url) {
    const rawUrl = String(url || "");
    if (!rawUrl.startsWith("./assets/cards/") || !useReleaseAssets) return rawUrl;

    const fileName = rawUrl.split("/").pop();
    const group = getCardAssetGroup(fileName);
    const tag = RELEASE_TAGS[group];
    return `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/${encodeURIComponent(fileName)}`;
  }

  function getCardAssetGroup(fileName) {
    if (/^(sv|svp|csv|cs|cbb|151c)/i.test(fileName)) return "sv";
    if (/^(swsh|me|mep)/i.test(fileName)) return "swsh-me";
    return "legacy";
  }

  window.PTCG_ASSETS = {
    mode: useReleaseAssets ? "release" : "local",
    releaseRepository: RELEASE_REPOSITORY,
    releaseTags: RELEASE_TAGS,
    resolveCardImageUrl,
    getCardAssetGroup,
  };
})();
