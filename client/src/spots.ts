export interface Spot {
  id: string;
  label: string;
  xPercent: number;
  yPercent: number;
}

export const SPOTS: Spot[] = [
  { id: "windowsill", label: "Windowsill", xPercent: 9.77, yPercent: 39.71 },
  { id: "footstool", label: "Footstool", xPercent: 19.41, yPercent: 50.13 },
  { id: "table", label: "Table", xPercent: 70.31, yPercent: 39.71 },
  { id: "couch", label: "Couch", xPercent: 82.84, yPercent: 68.36 },
  { id: "floor-right", label: "Floor", xPercent: 41.99, yPercent: 69.01 },
  { id: "scales", label: "Scales", xPercent: 14.65, yPercent: 90 },
];

// Spots the cat can be walked to on his own (random wandering, or heading for food left
// there) — everything except the scales, which he only ever ends up on if the player
// drags him there directly. See design.md §6.
export const WANDERABLE_SPOTS: Spot[] = SPOTS.filter((s) => s.id !== "scales");

export function getSpot(id: string): Spot {
  const spot = SPOTS.find((s) => s.id === id);
  if (!spot) throw new Error(`Unknown spot: ${id}`);
  return spot;
}

export function nearestSpot(xPercent: number, yPercent: number): Spot {
  let best = SPOTS[0];
  let bestDistance = Infinity;
  for (const spot of SPOTS) {
    const distance = Math.hypot(spot.xPercent - xPercent, spot.yPercent - yPercent);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = spot;
    }
  }
  return best;
}
