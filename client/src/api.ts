export type FoodLevel = "full" | "half" | "almostempty" | "empty";

export interface GameState {
  hunger: number;
  weight: number;
  catSpot: string;
  foodSpot: string | null;
  foodLevel: FoodLevel;
  gramsToday: number;
  gramsYesterday: number;
  updatedAt: number;
}

// Bounds how long a gesture (drag-drop, poke-to-eat, ...) can stay locked waiting on
// the server — without this, a stalled mobile connection never rejects on its own and
// the caller's in-progress animation state is stuck until the page is refreshed.
const REQUEST_TIMEOUT_MS = 10_000;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`${path} failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  // `fresh` should only be true for a brand-new page load — it lets the server roll a
  // chance the cat's wandered to a new spot while nobody was watching (see design.md
  // §4). Never pass it for a poll against a tab that's already open.
  getState: (fresh = false) => request<GameState>(fresh ? "/api/state?fresh=true" : "/api/state"),

  moveCat: (spotId: string) =>
    request<GameState>("/api/move-cat", {
      method: "POST",
      body: JSON.stringify({ spotId }),
    }),

  placeFood: (spotId: string) =>
    request<GameState>("/api/place-food", {
      method: "POST",
      body: JSON.stringify({ spotId }),
    }),

  moveFood: (spotId: string) =>
    request<GameState>("/api/move-food", {
      method: "POST",
      body: JSON.stringify({ spotId }),
    }),

  feed: () =>
    request<{ fed: boolean; state: GameState }>("/api/feed", {
      method: "POST",
    }),

  refillFood: () =>
    request<GameState>("/api/refill-food", {
      method: "POST",
    }),

  getPushPublicKey: () => request<{ publicKey: string }>("/api/push/vapid-public-key"),

  pushSubscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ ok: true }>("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription),
    }),

  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: true }>("/api/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    }),

  debugSet: (patch: {
    hunger?: number;
    weight?: number;
    catSpot?: string;
    foodSpot?: string | null;
    foodLevel?: FoodLevel;
    gramsToday?: number;
    gramsYesterday?: number;
    updatedAt?: number;
  }) =>
    request<GameState>("/api/debug", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
};
