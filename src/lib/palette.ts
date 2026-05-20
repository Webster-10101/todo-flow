// Stable per-task pastel palette. Hash the task id → index into a fixed list,
// so the same task keeps the same colour across renders and refreshes.

export type BlockPalette = {
  bg: string;
  accent: string;
};

const PALETTE: BlockPalette[] = [
  { bg: "rgba(254, 226, 226, 0.65)", accent: "rgba(225, 113, 113, 0.85)" }, // rose
  { bg: "rgba(254, 240, 200, 0.65)", accent: "rgba(217, 154, 60, 0.85)" }, // amber
  { bg: "rgba(220, 240, 215, 0.65)", accent: "rgba(99, 161, 110, 0.85)" }, // moss
  { bg: "rgba(207, 232, 247, 0.65)", accent: "rgba(78, 145, 197, 0.85)" }, // sky
  { bg: "rgba(229, 217, 247, 0.65)", accent: "rgba(141, 109, 196, 0.85)" }, // lilac
  { bg: "rgba(252, 220, 232, 0.65)", accent: "rgba(213, 102, 152, 0.85)" }, // pink
  { bg: "rgba(214, 240, 234, 0.65)", accent: "rgba(82, 158, 142, 0.85)" }, // teal
  { bg: "rgba(244, 224, 207, 0.65)", accent: "rgba(199, 129, 78, 0.85)" }, // peach
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function paletteForId(id: string): BlockPalette {
  return PALETTE[hashId(id) % PALETTE.length];
}
