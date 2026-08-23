export const SPOT_IDS = [
  "windowsill",
  "couch",
  "footstool",
  "floor-left",
  "table",
  "floor-right",
] as const;

export type SpotId = (typeof SPOT_IDS)[number];

export function isValidSpotId(value: unknown): value is SpotId {
  return typeof value === "string" && (SPOT_IDS as readonly string[]).includes(value);
}
