const CARD_DIR = "assets/cards";

export function getCardImageFileName(card) {
  const setId = String(card?.setId || getSetIdFromCardId(card?.id) || "").trim().toLowerCase();
  const number = String(card?.number || getNumberFromCardId(card?.id) || "").split("/")[0].trim();
  const variantNumber = String(card?.variant?.number || "").split("/")[0].trim();
  const parts = [setId, normalizeNumberToken(number)];
  if (variantNumber) parts.push(normalizeNumberToken(variantNumber));
  return `${parts.filter(Boolean).join("-")}.webp`;
}

export function getCardImagePath(card) {
  return `./${CARD_DIR}/${getCardImageFileName(card)}`;
}

export function getCardImageFsPath(card) {
  return `${CARD_DIR}/${getCardImageFileName(card)}`;
}

export function normalizeCardImageFileNameFromId(id) {
  const raw = String(id || "").trim();
  const lastDash = raw.lastIndexOf("-");
  if (lastDash < 0) return `${normalizeNumberToken(raw)}.webp`;
  return `${raw.slice(0, lastDash).toLowerCase()}-${normalizeNumberToken(raw.slice(lastDash + 1))}.webp`;
}

function normalizeNumberToken(value) {
  const token = String(value || "").trim();
  if (/^\d+$/.test(token)) return token.padStart(3, "0");
  return token.replace(/^([A-Za-z]+)(\d+)$/u, (_, prefix, digits) => `${prefix}${digits.padStart(3, "0")}`);
}

function getSetIdFromCardId(id) {
  const raw = String(id || "");
  const lastDash = raw.lastIndexOf("-");
  return lastDash > 0 ? raw.slice(0, lastDash) : raw;
}

function getNumberFromCardId(id) {
  const raw = String(id || "");
  const lastDash = raw.lastIndexOf("-");
  return lastDash > 0 ? raw.slice(lastDash + 1) : "";
}
