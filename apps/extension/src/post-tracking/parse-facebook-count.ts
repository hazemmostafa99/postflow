/** Parse the compact counters Facebook uses in labels and buttons. */
function parseFacebookCount(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[,٬]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  if (!normalized) return null;

  const match = normalized.match(/^(\d+(?:\.\d+)?)([KM]?)\+?$/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier = match[2] === 'K' ? 1_000 : match[2] === 'M' ? 1_000_000 : 1;
  return Math.round(amount * multiplier);
}
