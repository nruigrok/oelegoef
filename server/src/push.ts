import webpush from "web-push";
import { db } from "./db.js";
import { getDecayedState, VERY_HUNGRY_THRESHOLD } from "./state.js";

// How often the background scheduler checks hunger against the notification
// thresholds — independent of whether anyone has a tab open. See design.md §8/§12.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;
// Once very-hungry and unfed, how long to wait before nagging again — repeats on this
// cadence for as long as he stays hungry, rather than notifying once per episode.
const RENOTIFY_INTERVAL_MS = 4 * 60 * 60 * 1000;
// Quiet hours: no push is ever sent with an hour-of-day (server's local time — there's
// no per-subscription timezone) in [23:00, 9:00). A crossing that happens during this
// window is simply skipped rather than queued — the next check after quiet hours ends
// sends immediately, same as any other overdue notification. See design.md §12.
const QUIET_HOUR_START = 23;
const QUIET_HOUR_END = 9;

function isQuietHours(date: Date): boolean {
  const hour = date.getHours();
  return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
  notify_after: number;
}

function loadOrCreateVapidKeys(): { publicKey: string; privateKey: string } {
  const existing = db.prepare("SELECT public_key, private_key FROM vapid_keys WHERE id = 1").get() as
    | { public_key: string; private_key: string }
    | undefined;
  if (existing) return { publicKey: existing.public_key, privateKey: existing.private_key };

  const keys = webpush.generateVAPIDKeys();
  db.prepare("INSERT INTO vapid_keys (id, public_key, private_key) VALUES (1, ?, ?)").run(
    keys.publicKey,
    keys.privateKey
  );
  return keys;
}

const vapidKeys = loadOrCreateVapidKeys();
// Contact URI required by the push spec (identifies the sender to push services, not a
// live mailbox) — there's no user-account system to source a real address from.
webpush.setVapidDetails("mailto:toby-app@example.invalid", vapidKeys.publicKey, vapidKeys.privateKey);

export function getVapidPublicKey(): string {
  return vapidKeys.publicKey;
}

const upsertSubscription = db.prepare(`
  INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
  VALUES (@endpoint, @p256dh, @auth, @createdAt)
  ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
`);

export function subscribe(sub: PushSubscriptionJSON): void {
  upsertSubscription.run({
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    createdAt: Date.now(),
  });
}

const deleteSubscription = db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?");

export function unsubscribe(endpoint: string): void {
  deleteSubscription.run(endpoint);
}

const selectAllSubscriptions = db.prepare("SELECT * FROM push_subscriptions");
const selectNotifiedAt = db.prepare("SELECT last_hunger_notified_at FROM game_state WHERE id = 1");
const updateNotifiedAt = db.prepare("UPDATE game_state SET last_hunger_notified_at = @value WHERE id = 1");
const selectPaused = db.prepare("SELECT notifications_paused FROM game_state WHERE id = 1");
const updatePaused = db.prepare("UPDATE game_state SET notifications_paused = @value WHERE id = 1");

/** For scripts/push-pause.mjs — a manual kill switch for all subscribers, independent
 * of quiet hours and per-subscription notify_after. Never exposed to the client. */
export function areNotificationsPaused(): boolean {
  const row = selectPaused.get() as { notifications_paused: number };
  return row.notifications_paused !== 0;
}

export function setNotificationsPaused(paused: boolean): void {
  updatePaused.run({ value: paused ? 1 : 0 });
}

export interface SubscriptionSummary {
  endpoint: string;
  createdAt: number;
  notifyAfter: number;
}

/** For scripts/push-delay.mjs — never exposed to the client. */
export function listSubscriptions(): SubscriptionSummary[] {
  const rows = selectAllSubscriptions.all() as unknown as PushSubscriptionRow[];
  return rows.map((row) => ({ endpoint: row.endpoint, createdAt: row.created_at, notifyAfter: row.notify_after }));
}

const updateNotifyAfter = db.prepare("UPDATE push_subscriptions SET notify_after = @notifyAfter WHERE endpoint = @endpoint");

/** For scripts/push-delay.mjs — holds one subscription back from sends until notifyAfter. Returns whether a matching subscription was found. */
export function setNotifyAfter(endpoint: string, notifyAfter: number): boolean {
  const result = updateNotifyAfter.run({ endpoint, notifyAfter });
  return result.changes > 0;
}

async function sendToAll(payload: string): Promise<void> {
  const now = Date.now();
  const rows = (selectAllSubscriptions.all() as unknown as PushSubscriptionRow[]).filter(
    (row) => row.notify_after <= now
  );
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Gone/expired — the push service will never accept this endpoint again.
          unsubscribe(row.endpoint);
        } else {
          console.error(`Push send failed for ${row.endpoint}:`, err);
        }
      }
    })
  );
}

/**
 * Runs on CHECK_INTERVAL_MS. Applies decay via getDecayedState() (no duplicated hunger
 * math), then: notifies immediately on first crossing VERY_HUNGRY_THRESHOLD, renotifies
 * every RENOTIFY_INTERVAL_MS while he stays above it unfed, and clears the timer once
 * fed back down so the next episode notifies immediately again. Sending is further
 * gated by quiet hours (isQuietHours()) and the manual pause switch
 * (areNotificationsPaused()) — either simply skips the send; `last_hunger_notified_at`
 * is left untouched so the next eligible check sends right away rather than waiting out
 * a stale interval.
 */
export async function checkAndNotify(): Promise<void> {
  const state = getDecayedState();
  const row = selectNotifiedAt.get() as { last_hunger_notified_at: number | null };
  const now = Date.now();

  if (state.hunger > VERY_HUNGRY_THRESHOLD) {
    if (isQuietHours(new Date(now)) || areNotificationsPaused()) return;
    const due = row.last_hunger_notified_at === null || now - row.last_hunger_notified_at >= RENOTIFY_INTERVAL_MS;
    if (!due) return;

    updateNotifiedAt.run({ value: now });
    await sendToAll(
      JSON.stringify({
        title: "Toby heeft honger",
        body: "Hij is al een tijdje erg hongerig — misschien tijd voor een hapje?",
        tag: "toby-hungry",
      })
    );
  } else if (row.last_hunger_notified_at !== null) {
    updateNotifiedAt.run({ value: null });
  }
}

export function startPushNotificationScheduler(): void {
  setInterval(() => {
    checkAndNotify().catch((err) => console.error("checkAndNotify failed:", err));
  }, CHECK_INTERVAL_MS);
}
