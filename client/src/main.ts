import "./style.css";
import { api, type GameState } from "./api.ts";
import { getSpot, nearestSpot } from "./spots.ts";
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
import bowlFullSrc from "./assets/objects/bowl_full.png";
import bowlEmptySrc from "./assets/objects/bowl_empty.png";

// Fetch and decode every sprite as soon as the script runs, in parallel with the initial
// /api/state round-trip — otherwise the *first* time a given transition plays, swapping
// background-image to an unfetched URL renders nothing until it loads in, flashing the
// cat invisible for a frame or two.
for (const src of [
  catLyingdownSrc, catAsleepSrc, catDraggedSrc, catSittingSrc,
  pickedUpGif, releasedGif, startledGif, driftOffGif,
  situpGif, liedownGif, eatGif, nopeGif,
  bowlFullSrc, bowlEmptySrc,
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
// Chance he eats when he notices food, scaled by hunger — even well-fed, he'll often
// still take a bite; ravenous, it's a sure thing. Tune alongside design.md §3/§11.
const BASE_EAT_CHANCE = 0.3;
const HUNGER_EAT_CHANCE_WEIGHT = 0.7;

const sceneEl = document.querySelector<HTMLDivElement>("#scene")!;
const catEl = document.querySelector<HTMLDivElement>("#cat")!;
const thoughtBubbleEl = document.querySelector<HTMLDivElement>("#thought-bubble")!;
const traySourceEl = document.querySelector<HTMLDivElement>("#food-source")!;
const trayEl = document.querySelector<HTMLDivElement>("#tray")!;
const hungerFillEl = document.querySelector<HTMLDivElement>("#hunger-fill")!;
const weightFillEl = document.querySelector<HTMLDivElement>("#weight-fill")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const muteToggleEl = document.querySelector<HTMLButtonElement>("#mute-toggle")!;

let state: GameState | null = null;
let currentFoodEl: HTMLDivElement | null = null;
let dragging = false;
let muted = localStorage.getItem(MUTE_STORAGE_KEY) === "1";
let catGeneration = 0;
let transitionTimer: ReturnType<typeof setTimeout> | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let thoughtTimer: ReturnType<typeof setTimeout> | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let purrLoopAudio: HTMLAudioElement | null = null;

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

/** Resting, alert-ish — reached after being set down, fed, or startled awake. Settles into deep sleep after a bit. */
function showLyingDown() {
  catGeneration++;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${catLyingdownSrc})`;
  resetPoseClasses();
  catEl.title = "Pet him!";
  settleTimer = setTimeout(() => showDriftOffTransition(showAsleep), LYINGDOWN_HOLD_MS);
}

/** Deep sleep — ~99% of the game. Only exited by a tap (startled) or a drag (picked up). */
function showAsleep() {
  catGeneration++;
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
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${pickedUpGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(showDraggedCat, PICKUP_DURATION_MS);
}

/** Plays once as a held cat is set down without being fed; he ends up resting, then checks for food. */
function showReleaseTransition() {
  catGeneration++;
  clearTimeout(transitionTimer);
  catEl.style.backgroundImage = `url(${releasedGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(settleIntoLyingDown, RELEASE_DURATION_MS);
}

/** Plays once as he's startled awake by a tap; he ends up resting again, then checks for food. */
function showStartledTransition() {
  catGeneration++;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${startledGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(settleIntoLyingDown, STARTLE_DURATION_MS);
}

/** Plays once as he drifts off from resting into deep sleep. */
function showDriftOffTransition(onDone: () => void) {
  catGeneration++;
  clearTimeout(transitionTimer);
  catEl.style.backgroundImage = `url(${driftOffGif})`;
  transitionTimer = setTimeout(onDone, DRIFT_OFF_DURATION_MS);
}

/** Plays once as he sits up from lying down (a tap while resting); he ends up sitting. */
function showSitUpTransition() {
  catGeneration++;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${situpGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(showSitting, SITUP_DURATION_MS);
}

/** Plays once as he settles from sitting back down to lying down. */
function showSitDownTransition(onDone: () => void) {
  catGeneration++;
  clearTimeout(transitionTimer);
  catEl.style.backgroundImage = `url(${liedownGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(onDone, SITDOWN_DURATION_MS);
}

/** Plays once as he sits up upon noticing food next to him, then moves on to deciding whether to eat it. */
function showNoticeFoodTransition() {
  catGeneration++;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${situpGif})`;
  resetPoseClasses();
  transitionTimer = setTimeout(decideOnFood, SITUP_DURATION_MS);
}

/** Sitting and considering the food; after a beat, resolves to eating it or turning it down. */
function decideOnFood() {
  catGeneration++;
  clearTimeout(transitionTimer);
  clearTimeout(settleTimer);
  catEl.style.backgroundImage = `url(${catSittingSrc})`;
  resetPoseClasses();
  catEl.classList.add("sitting");
  transitionTimer = setTimeout(resolveFoodDecision, FOOD_DECISION_PAUSE_MS);
}

function resolveFoodDecision() {
  const hunger = state?.hunger ?? 0;
  const eatChance = BASE_EAT_CHANCE + (hunger / 100) * HUNGER_EAT_CHANCE_WEIGHT;
  if (Math.random() < eatChance) {
    void eatFood();
  } else {
    showNopeTransition();
  }
}

/** Plays once as he turns the food down; he ends up sitting, the bowl untouched. */
function showNopeTransition() {
  catGeneration++;
  clearTimeout(transitionTimer);
  catEl.style.backgroundImage = `url(${nopeGif})`;
  resetPoseClasses();
  showThought("He bah, weer kip");
  transitionTimer = setTimeout(showSitting, NOPE_DURATION_MS);
}

/**
 * Plays once as he eats. The server round-trip (which drops hunger and empties the bowl)
 * runs alongside the animation rather than after it, so a slow response can't stall the gif —
 * whichever finishes last, the two are joined before he settles back down.
 */
async function eatFood() {
  catGeneration++;
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
    setStatus("Toby ate! 😋");
  }
  showSitting();
}

/** Checks whether an awake cat is sitting next to a full bowl, and if so, has him notice it. */
function checkForFood() {
  if (!state || state.foodSpot !== state.catSpot || !state.foodFull) return;
  if (catEl.classList.contains("asleep")) return;
  if (catEl.classList.contains("sitting")) {
    decideOnFood();
  } else {
    showNoticeFoodTransition();
  }
}

/** Where a cat lands after being set down or startled awake — resting, then checking for food. */
function settleIntoLyingDown() {
  showLyingDown();
  checkForFood();
}

function handleCatTap() {
  if (catEl.classList.contains("asleep")) {
    showThought("He, wat? Waar ben ik? Wie ben jij?");
    playMeow();
    showStartledTransition();
  } else if (!catEl.classList.contains("sitting")) {
    showSitUpTransition();
  }
}

function renderStats(s: GameState) {
  hungerFillEl.style.width = `${s.hunger}%`;
  hungerFillEl.classList.toggle("warn", s.hunger > 40 && s.hunger <= 70);
  hungerFillEl.classList.toggle("bad", s.hunger > 70);

  weightFillEl.style.width = `${s.weight}%`;
  weightFillEl.classList.toggle("bad", s.weight < 25);
  weightFillEl.classList.toggle("warn", s.weight > 75);
}

function renderCat(s: GameState) {
  positionAtSpot(catEl, s.catSpot);
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
      placeFood,
      undefined,
      undefined,
      undefined,
      undefined,
      positionFoodAtSpot,
      refillFood
    );
  }
  currentFoodEl.style.backgroundImage = `url(${s.foodFull ? bowlFullSrc : bowlEmptySrc})`;
  positionFoodAtSpot(currentFoodEl, s.foodSpot);
}

function applyServerState(s: GameState) {
  state = s;
  renderCat(s);
  renderFood(s);
  renderStats(s);
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
 */
function attachSceneDrag(
  el: HTMLElement,
  onDrop: (spotId: string) => void,
  onTap?: () => void,
  onDragStart?: () => void,
  onPetStart?: () => void,
  onPetEnd?: () => void,
  positionForSpot: (el: HTMLElement, spotId: string) => void = positionAtSpot,
  onDropOnTray?: () => void
) {
  const dragThreshold = onPetStart ? PET_RADIUS : TAP_THRESHOLD;

  el.addEventListener("pointerdown", (e) => {
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

function startStirring() {
  setInterval(() => {
    if (dragging || !state || !catEl.classList.contains("asleep")) return;
    const chance = 0.05 + (state.hunger / 100) * 0.25;
    if (Math.random() < chance) {
      catEl.classList.add("stirring");
      showThought("Zzz...");
      setTimeout(() => catEl.classList.remove("stirring"), 400);
    }
  }, 4000);
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
        foodFull?: boolean;
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
  traySourceEl.style.backgroundImage = `url(${bowlFullSrc})`;
  attachSceneDrag(catEl, moveCat, handleCatTap, showPickupTransition, onCatPetStart, onCatPetEnd);
  attachTraySource(traySourceEl);
  muteToggleEl.addEventListener("click", toggleMute);
  renderMuteButton();

  applyServerState(await api.getState());
  showAsleep();

  startStirring();
  startPeriodicSync();
}

init().catch((err) => {
  console.error(err);
  setStatus("Couldn't reach the server — is it running?");
});
