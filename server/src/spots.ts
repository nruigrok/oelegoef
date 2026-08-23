export const SPOT_IDS = [
  "windowsill",
  "couch",
  "footstool",
  "scales",
  "table",
  "floor-right",
] as const;

export type SpotId = (typeof SPOT_IDS)[number];

export function isValidSpotId(value: unknown): value is SpotId {
  return typeof value === "string" && (SPOT_IDS as readonly string[]).includes(value);
}

// Spots the cat can be walked to on his own (random wandering, or heading for food left
// there) — everything except the scales, which he only ever ends up on if the player
// drags him there directly. See design.md §6.
export const WANDERABLE_SPOT_IDS = SPOT_IDS.filter((id) => id !== "scales");
