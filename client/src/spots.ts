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
  { id: "floor-left", label: "Floor", xPercent: 9.77, yPercent: 91.15 },
];

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
