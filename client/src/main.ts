import "./style.css";
import { api, type GameState, type FoodLevel } from "./api.ts";
import { getSpot, nearestSpot, WANDERABLE_SPOTS } from "./spots.ts";
import catLyingdownSrc from "./assets/cat/lyingdown-southeast.png";
import catAsleepSrc from "./assets/cat/asleep-southeast.png";
import catDraggedSrc from "./assets/cat/dragged-southeast.png";
import catSittingSrc from "./assets/cat/sitting-southeast.png";
import meowSound1 from "./assets/sounds/meow-1.mp3";
import meowSound2 from "./assets/sounds/meow-2.mp3";
import meowSound3 from "./assets/sounds/meow-3.mp3";
import purrSound from "./assets/sounds/purr.mp3";
import eatingSound from "./assets/sounds/eating.mp3";
import pickedUpGif from "./assets/cat/picked-up-southeast.gif";
import releasedGif from "./assets/cat/released-southeast.gif";
import startledGif from "./assets/cat/startled-southeast.gif";
import driftOffGif from "./assets/cat/driftoff-southeast.gif";
import situpGif from "./assets/cat/situp-southeast.gif";
import liedownGif from "./assets/cat/liedown-southeast.gif";
import eatGif from "./assets/cat/eat-southeast.gif";
import nopeGif from "./assets/cat/nope-southeast.gif";
import startWalkingGif from "./assets/cat/startwalking-southeast.gif";
import stopWalkingGif from "./assets/cat/stopwalking-southeast.gif";
import walkingEastGif from "./assets/cat/walking-southeast.gif";
import turningGif from "./assets/cat/turning-southeast.gif";
import stopTurningGif from "./assets/cat/stopturning-southeast.gif";
import walkingWestGif from "./assets/cat/walking-southwest.gif";
import bowlFullSrc from "./assets/objects/bowl_full.png";
import bowlHalfSrc from "./assets/objects/bowl_half.png";
import bowlAlmostEmptySrc from "./assets/objects/bowl_almostempty.png";
import bowlEmptySrc from "./assets/objects/bowl_empty.png";

const FOOD_LEVEL_SPRITES: Record<FoodLevel, string> = {
  full: bowlFullSrc,
  half: bowlHalfSrc,
  almostempty: bowlAlmostEmptySrc,
  empty: bowlEmptySrc,
};

// Fetch and decode every sprite as soon as the script runs, in parallel with the initial
// /api/state round-trip — otherwise the *first* time a given transition plays, swapping
// background-image to an unfetched URL renders nothing until it loads in, flashing the
// cat invisible for a frame or two.
for (const src of [
  catLyingdownSrc, catAsleepSrc, catDraggedSrc, catSittingSrc,
  pickedUpGif, releasedGif, startledGif, driftOffGif,
  situpGif, liedownGif, eatGif, nopeGif,
  startWalkingGif, stopWalkingGif, walkingEastGif,
  turningGif, stopTurningGif, walkingWestGif,
  bowlFullSrc, bowlHalfSrc, bowlAlmostEmptySrc, bowlEmptySrc,
]) {
  new Image().src = src;
}

const MEOW_SOUNDS = [meowSound1, meowSound2, meowSound3];
const SOUND_VOLUME = 0.6;
const MUTE_STORAGE_KEY = "toby-muted";
// Frozen to southeast for now — alternating with a southwest/flip was popping at odd
// moments (transition vs. static facing not always agreeing). Revisit later (design.md §7).
const PICKUP_DURATION_MS = 340;
const RELEASE_DURATION_MS = 1700;
const STARTLE_DURATION_MS = 340;
const DRIFT_OFF_DURATION_MS = 1700;
const SITUP_DURATION_MS = 340;
const SITDOWN_DURATION_MS = 3400; // liedown-southeast.gif: 17 frames @ 200ms
const LYINGDOWN_HOLD_MS = 2500;
const SITTING_HOLD_MS = 3000;
const FOOD_DECISION_PAUSE_MS = 600;
const EAT_LOOP_MS = 1800; // eat-southeast.gif: 9 frames @ 200ms, loops forever on its own
const EAT_REPEAT_COUNT = 3;
const EAT_DURATION_MS = EAT_LOOP_MS * EAT_REPEAT_COUNT;
const NOPE_DURATION_MS = 3400; // nope-southeast.gif: 17 frames @ 200ms
const START_WALKING_DURATION_MS = 1800; // startwalking-southeast.gif: 9 frames @ 200ms
const TURNING_DURATION_MS = 1700; // turning-southeast.gif: 17 frames @ 100ms (2x walking speed)
// walking-southeast.gif and walking-southwest.gif: 8 frames @ 200ms each, loop forever
// on their own (like eat-southeast.gif) — WALK_GLIDE_MS cuts away after exactly one
// loop, timed to land on a clean frame boundary rather than freezing mid-stride.
const WALK_GLIDE_MS = 1600;

// Ambient behavior tick — see startAmbientBehavior(). Chances below are per-tick.
const AMBIENT_TICK_MS = 4000;
// Cosmetic-only twitch while asleep — doesn't wake him.
const STIR_BASE_CHANCE = 0.05;
const STIR_HUNGER_WEIGHT = 0.25;
// Waking up on his own, straight into LYINGDOWN (silently — no meow/thought, unlike a
// poke) — followed by the usual notice-food check, so a hungry-enough cat left alone
// long enough will get up and find the bowl himself. Rolled before STIR so the two
// don't fire on the same tick.
const SELF_WAKE_BASE_CHANCE = 0.01;
const SELF_WAKE_HUNGER_WEIGHT = 0.05;
// A purr or meow to himself while resting awake (LYINGDOWN/SITTING, not mid-transition)
// — flavor only, doesn't affect any stat.
const AMBIENT_SOUND_CHANCE = 0.04;
// Chance a poke that isn't otherwise about food (see tryPokeToEat) instead makes him
// get up and relocate to a different spot — see showWanderTransition().
const WANDER_ON_POKE_CHANCE = 0.33;
// Chance a hungry-enough cat waking up with food elsewhere goes and finds it instead
// of just settling — see tryWanderTowardFood().
const WANDER_TO_FOOD_CHANCE = 0.4;
// While veryHungry, the ordinary ambient rolls (STIR/SELF_WAKE/AMBIENT_SOUND above) are
// bypassed in favor of these much higher, hunger-tier-gated ones — see startAmbientBehavior().
// The game wants to be naggy about a cat left very hungry and unattended (design.md §4).
const VERY_HUNGRY_STIR_CHANCE = 0.3;
const VERY_HUNGRY_MEOW_CHANCE = 0.25;
// Chance a very hungry cat, having just eaten one bite on noticing food unprompted,
// goes for a second one on his own — never a third; eating the whole bowl unprompted
// should be the exception, not the routine. Beyond this, only a poke or a fresh drag
// gets him to eat more. See eatFood()/design.md §4.
const VERY_HUNGRY_SECOND_BITE_CHANCE = 0.3;
// Sound on pickup (showPickupTransition): always one of meow/purr, weighted by whether
// he was asleep — mostly startled meows off a nap, an even split while already awake.
const PICKUP_AWAKE_MEOW_CHANCE = 0.5;
const PICKUP_ASLEEP_MEOW_CHANCE = 0.85;

// Hunger tiers driving eating behavior — see design.md §3/§4. Boundaries match the
// hunger-bar warn/bad colors in renderStats() so the bar always reflects the tier.
const HUNGRY_THRESHOLD = 40;
const VERY_HUNGRY_THRESHOLD = 70;
const NOT_HUNGRY_THRESHOLD = 15;

type HungerTier = "veryHungry" | "hungry" | "notVeryHungry" | "notHungry";

// Where the scale's built-in LED readout sits in the background art (assets_raw/objects/
// background.png) — separate from the "scales" spot's own coordinate (where the cat
// himself lands, on the plate just above this).
const SCALE_READOUT_X_PERCENT = 14.2;
const SCALE_READOUT_Y_PERCENT = 96.6;
// The 0-100 weight stat displayed as a plausible cat weight range rather than a raw
// percentage — see design.md §3/§6.
const SCALE_KG_MIN = 2;
const SCALE_KG_MAX = 5;
const SCALES_SPOT_ID = "scales";
// How long the readout (and the verdict thought bubble) stays up once he's weighed,
// regardless of whether he's already wandered off — long enough to actually read it.
const SCALE_READOUT_HOLD_MS = 5000;
// Beat between settling on the scale and heading off on his own — see settleIntoLyingDown().
const SCALE_WANDER_DELAY_MS = 1000;

function weightToKg(weight: number): number {
  return SCALE_KG_MIN + (weight / 100) * (SCALE_KG_MAX - SCALE_KG_MIN);
}

/** Flavor verdict on the reading, per the kg thresholds design.md §6 pins down. */
function weightVerdict(weight: number): string {
  const kg = weightToKg(weight);
  if (kg < 3) return "Help, hij kwijnt weg!";
  if (kg < 4) return "Hmm, daar kan nog wel meer kip bij";
  if (kg < 4.5) return "Kijk hem toch blij zijn";
  return "Zo, dat is best veel kat!";
}

function hungerTier(hunger: number): HungerTier {
  if (hunger > VERY_HUNGRY_THRESHOLD) return "veryHungry";
  if (hunger > HUNGRY_THRESHOLD) return "hungry";
  if (hunger >= NOT_HUNGRY_THRESHOLD) return "notVeryHungry";
  return "notHungry";
}

const sceneEl = document.querySelector<HTMLDivElement>("#scene")!;
const catEl = document.querySelector<HTMLDivElement>("#cat")!;
const thoughtBubbleEl = document.querySelector<HTMLDivElement>("#thought-bubble")!;
const traySourceEl = document.querySelector<HTMLDivElement>("#food-source")!;
const trayEl = document.querySelector<HTMLDivElement>("#tray")!;
const hungerFillEl = document.querySelector<HTMLDivElement>("#hunger-fill")!;
const gramsInfoEl = document.querySelector<HTMLDivElement>("#grams-info")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const weightReadoutEl = document.querySelector<HTMLDivElement>("#weight-readout")!;
const muteToggleEl = document.querySelector<HTMLButtonElement>("#mute-toggle")!;
const notifyToggleEl = document.querySelector<HTMLButtonElement>("#notify-toggle")!;

const PUSH_SUPPORTED = "serviceWorker" in navigator && "PushManager" in window;

let state: GameState | null = null;
let currentFoodEl: HTMLDivElement | null = null;
let dragging = false;
let muted = localStorage.getItem(MUTE_STORAGE_KEY) === "1";
let swRegistration: ServiceWorkerRegistration | null = null;
let pushSubscription: PushSubscription | null = null;
let catGeneration = 0;
let transitionTimer: ReturnType<typeof setTimeout> | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let thoughtTimer: ReturnType<typeof setTimeout> | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let weightReadoutHideTimer: ReturnType<typeof setTimeout> | undefined;
let purrLoopAudio: HTMLAudioElement | null = null;
// True from the moment any one-shot cat transition/sequence starts until it settles
// into a stable pose (asleep/lying down/sitting) — gates new taps/drags on the cat so
// a mid-flight animation (e.g. drifting off) can't get interrupted by a fresh one
// (e.g. sitting up) landing on top of it.
let animating = false;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Mutually exclusive pose modifiers on #cat — cleared before every transition/state entry so
// a class from one state can't linger into an unrelated one.
const POSE_CLASSES = ["asleep", "sitting"];
function resetPoseClasses() {
  catEl.classList.remove(...POSE_CLASSES);
}

function isOverElement(el: HTMLElement, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function clientToScenePercent(clientX: number, clientY: number) {
  const rect = sceneEl.getBoundingClientRect();
  return {
    x: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((clientY - rect.top) / rect.height) * 100, 0, 100),
  };
}

function positionAt(el: HTMLElement, xPercent: number, yPercent: number) {
  el.style.left = `${xPercent}%`;
  el.style.top = `${yPercent}%`;
}

function positionAtSpot(el: HTMLElement, spotId: string) {
  const spot = getSpot(spotId);
  positionAt(el, spot.xPercent, spot.yPercent);
}

const FOOD_NEXT_TO_CAT_PX = 32;
// #cat is 80px, .food is 30px — both centered via translate(-50%, -50%), so nudging the
// food down by half the size difference lines up their bottom edges instead of their centers.
// Pulled back up a bit from a dead-on bottom alignment so it reads as being eaten from,
// not just parked next to him.
const CAT_SIZE_PX = 80;
const FOOD_SIZE_PX = 30;
const FOOD_EATING_HEIGHT_NUDGE_PX = 10;
const FOOD_BOTTOM_ALIGN_PX = (CAT_SIZE_PX - FOOD_SIZE_PX) / 2 - FOOD_EATING_HEIGHT_NUDGE_PX;

/** Positions the food offset to the cat's right and bottom-aligned with it, as if the cat were sitting there — independent of where the cat actually is. */
function positionFoodAtSpot(el: HTMLElement, spotId: string) {
  const spot = getSpot(spotId);
  const rect = sceneEl.getBoundingClientRect();
  const offsetXPercent = (FOOD_NEXT_TO_CAT_PX / rect.width) * 100;
  const offsetYPercent = (FOOD_BOTTOM_ALIGN_PX / rect.height) * 100;
  positionAt(el, spot.xPercent + offsetXPercent, spot.yPercent + offsetYPercent);
}

function setStatus(text: string) {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ""), 3000);
}

const THOUGHT_DURATION_MS = 2200;

/** Shows a thought balloon in the top-right corner with the given text, auto-hiding after durationMs (or staying up indefinitely if omitted — pair with hideThought()). */
function showThought(text: string, durationMs: number | null = THOUGHT_DURATION_MS) {
  thoughtBubbleEl.textContent = text;
  thoughtBubbleEl.classList.remove("hidden");
  clearTimeout(thoughtTimer);
  if (durationMs !== null) {
    thoughtTimer = setTimeout(() => thoughtBubbleEl.classList.add("hidden"), durationMs);
  }
}

function hideThought() {
  clearTimeout(thoughtTimer);
  thoughtBubbleEl.classList.add("hidden");
}

function playSound(src: string) {
  if (muted) return;
  const audio = new Audio(src);
  audio.volume = SOUND_VOLUME;
  void audio.play().catch(() => {});
}

function playMeow() {
  playSound(MEOW_SOUNDS[Math.floor(Math.random() * MEOW_SOUNDS.length)]);
}

function startPurrLoop() {
  stopPurrLoop();
  if (muted) return;
  purrLoopAudio = new Audio(purrSound);
  purrLoopAudio.loop = true;
  purrLoopAudio.volume = SOUND_VOLUME;
  void purrLoopAudio.play().catch(() => {});
}

function stopPurrLoop() {
  purrLoopAudio?.pause();
  purrLoopAudio = null;
}

function onCatPetStart() {
  startPurrLoop();
  showThought("Prrrrrr", null);
}

function onCatPetEnd() {
  stopPurrLoop();
  hideThought();
}

function renderMuteButton() {
  muteToggleEl.textContent = muted ? "🔇" : "🔊";
  muteToggleEl.setAttribute("aria-label", muted ? "Unmute sounds" : "Mute sounds");
}

function toggleMute() {
  muted = !muted;
  localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
  renderMuteButton();
}

/** Push's applicationServerKey wants raw bytes, not the base64url string the server hands back. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/**
 * Unlike the mute toggle, this button's state isn't cached in localStorage — permission
 * can be revoked from outside the page (browser/OS settings), so the render always
 * reflects the live pushSubscription/Notification.permission rather than a stale flag.
 */
function renderNotifyButton() {
  if (!PUSH_SUPPORTED) {
    notifyToggleEl.classList.add("hidden");
    return;
  }
  if (Notification.permission === "denied") {
    notifyToggleEl.textContent = "🔕";
    notifyToggleEl.title = "Notifications are blocked — enable them in your browser's site settings";
    notifyToggleEl.setAttribute("aria-label", notifyToggleEl.title);
    return;
  }
  const on = pushSubscription !== null;
  notifyToggleEl.textContent = on ? "🔔" : "🔕";
  notifyToggleEl.title = on ? "Turn off hunger notifications" : "Get notified when Toby's very hungry";
  notifyToggleEl.setAttribute("aria-label", notifyToggleEl.title);
}

async function initPushUI() {
  if (!PUSH_SUPPORTED) {
    renderNotifyButton();
    return;
  }
  await navigator.serviceWorker.register("/sw.js");
  // .ready (not the raw register() result) — subscribe()/getSubscription() need an
  // active worker, and register() can resolve before installation finishes.
  swRegistration = await navigator.serviceWorker.ready;
  pushSubscription = await swRegistration.pushManager.getSubscription();
  renderNotifyButton();
}

async function toggleNotify() {
  if (!PUSH_SUPPORTED || !swRegistration) return;

  if (pushSubscription) {
    const endpoint = pushSubscription.endpoint;
    await pushSubscription.unsubscribe();
    pushSubscription = null;
    renderNotifyButton();
    api.pushUnsubscribe(endpoint).catch((err) => console.error(err));
    return;
  }

  if (Notification.permission === "denied") {
    renderNotifyButton();
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    renderNotifyButton();
    return;
  }

  try {
    const { publicKey } = await api.getPushPublicKey();
    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
    pushSubscription = subscription;
    renderNotifyButton();
    const json = subscription.toJSON();
    await api.pushSubscribe({ endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } });
  } catch (err) {
    console.error("Push subscribe failed:", err);
    setStatus("Couldn't enable notifications — see console for details");
    renderNotifyButton();
  }
}

/** Resting, alert-ish — reached after being set down, fed, or startled awake. Settles into deep sleep after a bit, unless he's very hungry, in which case he stays resting (design.md §4) — see scheduleDriftOff(). */
function showLyingDown() {
  catGeneration++;
  animating = false;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${catLyingdownSrc})`;
  resetPoseClasses();
  catEl.title = "Pet him!";
  scheduleDriftOff();
}

/** Re-checked every LYINGDOWN_HOLD_MS rather than firing once: a very hungry cat keeps
 * deferring the drift-off-to-sleep indefinitely instead of ever reaching ASLEEP. */
function scheduleDriftOff() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    if (hungerTier(state?.hunger ?? 0) === "veryHungry") {
      scheduleDriftOff();
      return;
    }
    showDriftOffTransition(showAsleep);
  }, LYINGDOWN_HOLD_MS);
}

/** Deep sleep — ~99% of the game. Only exited by a tap (startled) or a drag (picked up). */
function showAsleep() {
  catGeneration++;
  animating = false;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${catAsleepSrc})`;
  resetPoseClasses();
  catEl.classList.add("asleep");
  catEl.title = "Tap to wake him";
}

/** Sitting up, alert — reached by tapping a lying-down cat. Settles back to lying down after a bit. */
function showSitting() {
  catGeneration++;
  animating = false;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${catSittingSrc})`;
  resetPoseClasses();
  catEl.classList.add("sitting");
  catEl.title = "Pet him!";
  settleTimer = setTimeout(() => showSitDownTransition(showLyingDown), SITTING_HOLD_MS);
}

function showDraggedCat() {
  catGeneration++;
  clearTimeout(transitionTimer);
  catEl.style.backgroundImage = `url(${catDraggedSrc})`;
  resetPoseClasses();
}

/** Plays once when he's picked up (resting, sitting, or asleep), then hands off to the static dragged sprite. */
function showPickupTransition() {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  const meowChance = catEl.classList.contains("asleep") ? PICKUP_ASLEEP_MEOW_CHANCE : PICKUP_AWAKE_MEOW_CHANCE;
  if (Math.random() < meowChance) {
    playMeow();
  } else {
    playSound(purrSound);
  }
  catEl.style.backgroundImage = `url(${pickedUpGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(showDraggedCat, PICKUP_DURATION_MS);
}

/** Plays once as a held cat is set down without being fed; he ends up resting, then checks for food. */
function showReleaseTransition() {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  catEl.style.backgroundImage = `url(${releasedGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(settleIntoLyingDown, RELEASE_DURATION_MS);
}

/** Plays once as he's startled awake by a tap; he ends up resting again, then checks for food. */
function showStartledTransition() {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${startledGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(settleIntoLyingDown, STARTLE_DURATION_MS);
}

/** Plays once as he drifts off from resting into deep sleep. */
function showDriftOffTransition(onDone: () => void) {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  catEl.style.backgroundImage = `url(${driftOffGif})`;
  transitionTimer = setTimeout(onDone, DRIFT_OFF_DURATION_MS);
}

/** Plays once as he sits up from lying down (a tap while resting); he ends up sitting. */
function showSitUpTransition() {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${situpGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(showSitting, SITUP_DURATION_MS);
}

/** Plays once as he settles from sitting back down to lying down. */
function showSitDownTransition(onDone: () => void) {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  catEl.style.backgroundImage = `url(${liedownGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(onDone, SITDOWN_DURATION_MS);
}

/** Plays once as he sits up upon noticing food next to him, then moves on to deciding whether to eat it. */
function showNoticeFoodTransition() {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${situpGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(decideOnFood, SITUP_DURATION_MS);
}

/** Sitting and considering the food; after a beat, resolves to eating it or turning it down. */
function decideOnFood() {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${catSittingSrc})`;
  resetPoseClasses();
  catEl.classList.add("sitting");
  transitionTimer = setTimeout(resolveFoodDecision, FOOD_DECISION_PAUSE_MS);
}

/** Whether noticing the food on his own is enough to make him eat, per design.md §4. */
function selfFeedsAtTier(tier: HungerTier) {
  return tier === "veryHungry" || tier === "hungry";
}

function resolveFoodDecision() {
  const tier = hungerTier(state?.hunger ?? 0);
  if (selfFeedsAtTier(tier)) {
    void eatFood({ auto: true });
  } else {
    showNopeTransition();
  }
}

/** Plays once as he turns the food down; he ends up sitting, the bowl untouched. */
function showNopeTransition() {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  catEl.style.backgroundImage = `url(${nopeGif})`;
  resetPoseClasses();
  showThought("He bah, weer kip");
  transitionTimer = setTimeout(settleOrWander, NOPE_DURATION_MS);
}

/**
 * Plays once as he eats one bite (one bowl level). The server round-trip (which drops
 * hunger and empties one level of the bowl) runs alongside the animation rather than
 * after it, so a slow response can't stall the gif — whichever finishes last, the two
 * are joined before he settles back down.
 *
 * `auto` marks a bite that happened without a poke (i.e. he noticed the food himself,
 * see resolveFoodDecision()) — only that path ever chains into a second bite on its
 * own (VERY_HUNGRY_SECOND_BITE_CHANCE, and never a third), so eating the whole bowl
 * unprompted stays rare; a poke (tryPokeToEat(), auto unset) always eats exactly one
 * bite per tap, same as before — poking or dragging is how you get more into him. See
 * design.md §4/§5.
 */
async function eatFood(opts: { auto?: boolean; isSecondAutoBite?: boolean } = {}) {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  catEl.style.backgroundImage = `url(${eatGif})`;
  resetPoseClasses();
  showThought("Hey, kip! Lekker!");
  playSound(eatingSound);
  const myGeneration = catGeneration;
  const [result] = await Promise.all([api.feed(), delay(EAT_DURATION_MS)]);
  if (myGeneration !== catGeneration) return;
  applyServerState(result.state);
  if (result.fed) {
    playSound(purrSound);
  }
  if (
    opts.auto &&
    !opts.isSecondAutoBite &&
    hungerTier(result.state.hunger) === "veryHungry" &&
    result.state.foodLevel !== "empty" &&
    Math.random() < VERY_HUNGRY_SECOND_BITE_CHANCE
  ) {
    void eatFood({ auto: true, isSecondAutoBite: true });
    return;
  }
  settleOrWander();
}

/** Checks whether an awake cat is sitting next to a non-empty bowl, and if so, has him notice it. */
function checkForFood() {
  if (!state || state.foodSpot !== state.catSpot || state.foodLevel === "empty") return;
  if (animating || catEl.classList.contains("asleep")) return;
  if (catEl.classList.contains("sitting")) {
    decideOnFood();
  } else {
    showNoticeFoodTransition();
  }
}

/** Where a cat lands after being set down or startled awake — resting, then either
 * weighing in (if he's on the scale), heading for food elsewhere (tryWanderTowardFood),
 * or checking for food right here. */
function settleIntoLyingDown() {
  showLyingDown();
  if (state?.catSpot === SCALES_SPOT_ID) {
    handleWeighIn();
  } else if (!tryWanderTowardFood()) {
    checkForFood();
  }
}

/**
 * He's just settled on the scale: react to the reading with a verdict thought bubble,
 * then head off on his own after a beat — he never lingers on the scale (design.md §6).
 */
function handleWeighIn() {
  showThought(weightVerdict(state?.weight ?? 0), SCALE_READOUT_HOLD_MS);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => showWanderTransition(), SCALE_WANDER_DELAY_MS);
}

/**
 * A poke while he's sitting right next to non-empty food: not-very-hungry and hungry
 * cats won't take a bite on their own but will for a poke (an extra bite, in the
 * hungry case, on top of the one he already helped himself to); not-hungry cats still
 * turn it down. Returns whether the tap was consumed this way — see design.md §4.
 */
function tryPokeToEat(): boolean {
  if (!state || state.foodSpot !== state.catSpot || state.foodLevel === "empty") return false;
  if (hungerTier(state.hunger) === "notHungry") {
    showNopeTransition();
  } else {
    void eatFood();
  }
  return true;
}

/**
 * Sits up, then relocates to a different spot instead of settling back down in place —
 * a random one by default, or `targetSpotId` if given (used to send him straight to
 * food he's just noticed elsewhere — see tryWanderTowardFood()). See design.md §4.
 */
function showWanderTransition(targetSpotId?: string) {
  catGeneration++;
  animating = true;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${situpGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(() => wanderToNewSpot(targetSpotId), SITUP_DURATION_MS);
}

/**
 * Plays the lead-in (facing the direction of travel) then loops the matching walk
 * cycle while gliding to the new spot, joined with the persisting network call the
 * same way eatFood() joins its animation with api.feed() — whichever finishes last,
 * both are done before he settles. See design.md §4.
 */
async function wanderToNewSpot(targetSpotId?: string) {
  const fromSpot = state?.catSpot;
  if (!fromSpot) {
    showSitting();
    return;
  }
  let spotId = targetSpotId;
  if (!spotId) {
    const destinations = WANDERABLE_SPOTS.map((s) => s.id).filter((id) => id !== fromSpot);
    if (destinations.length === 0) {
      showSitting();
      return;
    }
    spotId = destinations[Math.floor(Math.random() * destinations.length)];
  }
  const goingEast = getSpot(spotId).xPercent >= getSpot(fromSpot).xPercent;

  const myGeneration = catGeneration;

  catEl.style.backgroundImage = `url(${goingEast ? startWalkingGif : turningGif})`;
  await delay(goingEast ? START_WALKING_DURATION_MS : TURNING_DURATION_MS);
  if (myGeneration !== catGeneration) return;

  catEl.classList.add("walking-glide");
  catEl.style.backgroundImage = `url(${goingEast ? walkingEastGif : walkingWestGif})`;
  positionAtSpot(catEl, spotId);
  const [result] = await Promise.all([api.moveCat(spotId), delay(WALK_GLIDE_MS)]);
  if (myGeneration !== catGeneration) return;
  applyServerState(result);

  // Reversed lead-in clips (see assets_raw/reverse_gif.py) — settles him back down
  // the same way he got going, rather than cutting straight to the static pose.
  catEl.style.backgroundImage = `url(${goingEast ? stopWalkingGif : stopTurningGif})`;
  await delay(goingEast ? START_WALKING_DURATION_MS : TURNING_DURATION_MS);
  if (myGeneration !== catGeneration) return;

  showSitting();
  checkForFood();
}

/** A chance to send him wandering to a random spot instead — used after a poke that
 * isn't about food (see tryPokeToEat; a poke while `SITTING` finally does something,
 * design.md §4 used to note it didn't) and after he settles from eating or declining
 * food (see settleOrWander()). */
function tryWander(): boolean {
  if (Math.random() >= WANDER_ON_POKE_CHANCE) return false;
  showWanderTransition();
  return true;
}

/** After settling from eating or declining food, the same chance that sends a poke
 * wandering can just as easily send him off on his own. See design.md §4/§5. */
function settleOrWander() {
  if (!tryWander()) showSitting();
}

/**
 * On waking, food waiting at a different spot isn't walked to automatically — but a
 * hungry-enough cat (the same tiers that'd self-feed if it were already at his spot,
 * per selfFeedsAtTier) has a chance to go find it instead of just settling in place.
 * See design.md §4.
 */
function tryWanderTowardFood(): boolean {
  const s = state;
  if (!s || s.foodSpot === null || s.foodSpot === s.catSpot || s.foodLevel === "empty") return false;
  // He never walks onto the scales on his own, even chasing food someone left there —
  // see design.md §6.
  if (!WANDERABLE_SPOTS.some((spot) => spot.id === s.foodSpot)) return false;
  if (!selfFeedsAtTier(hungerTier(s.hunger))) return false;
  if (Math.random() >= WANDER_TO_FOOD_CHANCE) return false;
  showWanderTransition(s.foodSpot);
  return true;
}

function handleCatTap() {
  if (catEl.classList.contains("asleep")) {
    showThought("He, wat? Waar ben ik? Wie ben jij?");
    playMeow();
    showStartledTransition();
  } else if (!tryPokeToEat() && !tryWander() && !catEl.classList.contains("sitting")) {
    showSitUpTransition();
  }
}

function gramsSpan(grams: number): string {
  const color = grams <= 120 ? "red" : grams < 200 ? "orange" : "green";
  return `<span class="gram-amount ${color}">${grams}g</span>`;
}

function renderStats(s: GameState) {
  hungerFillEl.style.width = `${s.hunger}%`;
  hungerFillEl.classList.toggle("warn", s.hunger > HUNGRY_THRESHOLD && s.hunger <= VERY_HUNGRY_THRESHOLD);
  hungerFillEl.classList.toggle("bad", s.hunger > VERY_HUNGRY_THRESHOLD);
  gramsInfoEl.innerHTML =
    `Vandaag: ${gramsSpan(s.gramsToday)}; gisteren: ${gramsSpan(s.gramsYesterday)}`;
}

function renderCat(s: GameState) {
  positionAtSpot(catEl, s.catSpot);
}

/**
 * Shows Toby's current weight over the scale's LED readout while he's on it, and keeps
 * it up for a bit after he's wandered off (see handleWeighIn()) so there's time to
 * actually read it — see design.md §6.
 */
function renderWeightReadout(s: GameState) {
  if (s.catSpot === SCALES_SPOT_ID) {
    clearTimeout(weightReadoutHideTimer);
    weightReadoutHideTimer = undefined;
    weightReadoutEl.classList.remove("hidden");
    weightReadoutEl.textContent = `${weightToKg(s.weight).toFixed(2)} kg`;
    return;
  }
  if (!weightReadoutEl.classList.contains("hidden") && weightReadoutHideTimer === undefined) {
    weightReadoutHideTimer = setTimeout(() => {
      weightReadoutEl.classList.add("hidden");
      weightReadoutHideTimer = undefined;
    }, SCALE_READOUT_HOLD_MS);
  }
}

function renderFood(s: GameState) {
  traySourceEl.classList.toggle("hidden", s.foodSpot !== null);

  if (s.foodSpot === null) {
    currentFoodEl?.remove();
    currentFoodEl = null;
    return;
  }
  if (!currentFoodEl) {
    currentFoodEl = document.createElement("div");
    currentFoodEl.className = "food";
    sceneEl.appendChild(currentFoodEl);
    attachSceneDrag(
      currentFoodEl,
      moveFood,
      undefined,
      undefined,
      undefined,
      undefined,
      positionFoodAtSpot,
      refillFood
    );
  }
  currentFoodEl.style.backgroundImage = `url(${FOOD_LEVEL_SPRITES[s.foodLevel]})`;
  positionFoodAtSpot(currentFoodEl, s.foodSpot);
}

function applyServerState(s: GameState) {
  state = s;
  renderCat(s);
  renderFood(s);
  renderStats(s);
  renderWeightReadout(s);
}

async function moveCat(spotId: string) {
  // Captured before the round-trip: if a newer drag/tap has changed the cat's state
  // by the time this resolves, this response is stale and shouldn't animate over it.
  const myGeneration = catGeneration;
  applyServerState(await api.moveCat(spotId));
  if (myGeneration !== catGeneration) return;
  showReleaseTransition();
}

async function placeFood(spotId: string) {
  applyServerState(await api.placeFood(spotId));
  checkForFood();
}

async function moveFood(spotId: string) {
  applyServerState(await api.moveFood(spotId));
  checkForFood();
}

async function refillFood() {
  applyServerState(await api.refillFood());
}

const TAP_THRESHOLD = 6;
const PET_RADIUS = 40;

/**
 * Drags an element that already lives inside #scene (the cat, or a placed food item).
 * The element follows the pointer directly while dragging; on drop it resolves to
 * the nearest spot and glides there via positionForSpot (the "settling" class enables
 * a CSS transition that's otherwise off, so live dragging itself stays perfectly 1:1
 * with the pointer).
 *
 * When onPetStart/onPetEnd are given, movement past the tap threshold doesn't start a
 * drag right away — it's a "pet" (element doesn't move, onPetStart fires live) until
 * the pointer travels past PET_RADIUS, at which point onPetEnd fires and it escalates
 * into a real drag from there. onPetEnd also fires on release or if the gesture is
 * cancelled mid-pet, so a caller using it to start a looping sound always gets a
 * matching stop.
 *
 * When onDropOnTray is given, releasing over #tray skips the spot-snap entirely and
 * fires that instead — used to let the food bowl be dragged back to the tray.
 *
 * When isBlocked is given and returns true, the whole gesture is ignored from
 * pointerdown on — used to keep a mid-animation cat from being tapped or dragged
 * until it settles into a stable pose (see the `animating` flag).
 */
function attachSceneDrag(
  el: HTMLElement,
  onDrop: (spotId: string) => void,
  onTap?: () => void,
  onDragStart?: () => void,
  onPetStart?: () => void,
  onPetEnd?: () => void,
  positionForSpot: (el: HTMLElement, spotId: string) => void = positionAtSpot,
  onDropOnTray?: () => void,
  isBlocked?: () => boolean
) {
  const dragThreshold = onPetStart ? PET_RADIUS : TAP_THRESHOLD;

  el.addEventListener("pointerdown", (e) => {
    if (isBlocked?.()) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.remove("settling");
    el.classList.add("dragging");
    dragging = true;
    const startX = e.clientX;
    const startY = e.clientY;
    let confirmedDrag = false;
    let petting = false;
    let wasPet = false;

    const onMove = (ev: PointerEvent) => {
      const distance = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (!confirmedDrag && distance > dragThreshold) {
        confirmedDrag = true;
        if (petting) {
          petting = false;
          onPetEnd?.();
        }
        onDragStart?.();
      } else if (!confirmedDrag && !petting && onPetStart && distance > TAP_THRESHOLD) {
        petting = true;
        wasPet = true;
        onPetStart();
      }
      if (!confirmedDrag) return;
      const { x, y } = clientToScenePercent(ev.clientX, ev.clientY);
      positionAt(el, x, y);
    };

    const onEnd = (ev: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onEnd);
      el.removeEventListener("pointercancel", onEnd);
      el.classList.remove("dragging");
      dragging = false;

      if (petting) {
        petting = false;
        onPetEnd?.();
      }

      if (confirmedDrag) {
        if (onDropOnTray && isOverElement(trayEl, ev.clientX, ev.clientY)) {
          onDropOnTray();
          return;
        }
        const { x, y } = clientToScenePercent(ev.clientX, ev.clientY);
        const spot = nearestSpot(x, y);
        el.classList.add("settling");
        positionForSpot(el, spot.id);
        onDrop(spot.id);
        return;
      }

      if (!wasPet) onTap?.();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onEnd);
    el.addEventListener("pointercancel", onEnd);
  });
}

/** Drags the always-available food bowl out of the tray to place a new food item in the scene. */
function attachTraySource(el: HTMLElement) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    dragging = true;

    const ghost = document.createElement("div");
    Object.assign(ghost.style, {
      position: "fixed",
      width: "30px",
      height: "30px",
      backgroundImage: `url(${bowlFullSrc})`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      backgroundSize: "contain",
      imageRendering: "pixelated",
      pointerEvents: "none",
      transform: "translate(-50%, -50%)",
      zIndex: "1000",
      left: `${e.clientX}px`,
      top: `${e.clientY}px`,
    });
    document.body.appendChild(ghost);

    const onMove = (ev: PointerEvent) => {
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
    };

    const onUp = (ev: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.classList.remove("dragging");
      dragging = false;
      ghost.remove();

      if (!isOverElement(sceneEl, ev.clientX, ev.clientY)) return;

      const { x, y } = clientToScenePercent(ev.clientX, ev.clientY);
      void placeFood(nearestSpot(x, y).id);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  });
}

/**
 * Runs the cat's unprompted idle behavior on one shared tick — self-directed waking
 * and cosmetic stirring while asleep, and an occasional purr/meow while resting awake.
 * See design.md §4.
 */
function startAmbientBehavior() {
  setInterval(() => {
    if (dragging || !state || animating) return;

    const veryHungry = hungerTier(state.hunger) === "veryHungry";

    if (catEl.classList.contains("asleep")) {
      // A very hungry cat doesn't get to roll for it — he's forced awake outright, per
      // design.md §4.
      if (veryHungry) {
        showStartledTransition();
        return;
      }
      const wakeChance = SELF_WAKE_BASE_CHANCE + (state.hunger / 100) * SELF_WAKE_HUNGER_WEIGHT;
      if (Math.random() < wakeChance) {
        showStartledTransition();
        return;
      }
      const stirChance = STIR_BASE_CHANCE + (state.hunger / 100) * STIR_HUNGER_WEIGHT;
      if (Math.random() < stirChance) {
        catEl.classList.add("stirring");
        showThought("Zzz...");
        setTimeout(() => catEl.classList.remove("stirring"), 400);
      }
      return;
    }

    // Resting awake: a very hungry cat is restless (frequent wiggle) and meows with
    // some regularity instead of the low-frequency ordinary ambient roll below.
    if (veryHungry) {
      if (Math.random() < VERY_HUNGRY_STIR_CHANCE) {
        catEl.classList.add("stirring");
        setTimeout(() => catEl.classList.remove("stirring"), 400);
      }
      if (Math.random() < VERY_HUNGRY_MEOW_CHANCE) {
        playMeow();
        showThought("Ik heb honger!");
      }
      return;
    }

    if (Math.random() < AMBIENT_SOUND_CHANCE) {
      if (Math.random() < 0.5) {
        playSound(purrSound);
        showThought("Prrrrrr");
      } else {
        playMeow();
        showThought("Meow.");
      }
    }
  }, AMBIENT_TICK_MS);
}

function startPeriodicSync() {
  setInterval(async () => {
    if (dragging) return;
    applyServerState(await api.getState());
  }, 2 * 60 * 1000);
}

declare global {
  interface Window {
    tobyDebug: {
      set(patch: {
        hunger?: number;
        weight?: number;
        catSpot?: string;
        foodSpot?: string | null;
        foodLevel?: FoodLevel;
        gramsToday?: number;
        gramsYesterday?: number;
        updatedAt?: number;
      }): Promise<GameState>;
    };
  }
}

// Testing helper: from the browser console, e.g. `await tobyDebug.set({ hunger: 90 })`.
window.tobyDebug = {
  async set(patch) {
    const result = await api.debugSet(patch);
    applyServerState(result);
    return result;
  },
};

async function init() {
  positionAt(weightReadoutEl, SCALE_READOUT_X_PERCENT, SCALE_READOUT_Y_PERCENT);
  traySourceEl.style.backgroundImage = `url(${bowlFullSrc})`;
  attachSceneDrag(
    catEl,
    moveCat,
    handleCatTap,
    showPickupTransition,
    onCatPetStart,
    onCatPetEnd,
    positionAtSpot,
    undefined,
    () => animating
  );
  attachTraySource(traySourceEl);
  muteToggleEl.addEventListener("click", toggleMute);
  renderMuteButton();
  notifyToggleEl.addEventListener("click", toggleNotify);
  void initPushUI();

  applyServerState(await api.getState(true));
  // A very hungry cat is never found ASLEEP (design.md §4) — greet the player with an
  // immediate meow instead of the usual silent asleep start.
  if (hungerTier(state?.hunger ?? 0) === "veryHungry") {
    settleIntoLyingDown();
    playMeow();
    showThought("Eindelijk! Ik heb honger!");
  } else {
    showAsleep();
  }

  startAmbientBehavior();
  startPeriodicSync();
}

init().catch((err) => {
  console.error(err);
  setStatus("Couldn't reach the server — is it running?");
});
