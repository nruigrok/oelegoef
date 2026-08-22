import "./style.css";
import { api, type GameState } from "./api.ts";

const sceneEl = document.querySelector<HTMLDivElement>("#scene")!;
const catEl = document.querySelector<HTMLDivElement>("#cat")!;
const meowBubbleEl = document.querySelector<HTMLDivElement>("#meow-bubble")!;
const traySourceEl = document.querySelector<HTMLDivElement>("#food-source")!;
const hungerFillEl = document.querySelector<HTMLDivElement>("#hunger-fill")!;
const weightFillEl = document.querySelector<HTMLDivElement>("#weight-fill")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;

let state: GameState | null = null;
let currentFoodEl: HTMLDivElement | null = null;
let dragging = false;
let awakeTimer: ReturnType<typeof setTimeout> | undefined;
let meowTimer: ReturnType<typeof setTimeout> | undefined;
let statusTimer: ReturnType<typeof setTimeout> | undefined;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function clientToScenePercent(clientX: number, clientY: number) {
  const rect = sceneEl.getBoundingClientRect();
  return {
    x: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((clientY - rect.top) / rect.height) * 100, 0, 100),
  };
}

function positionEl(el: HTMLElement, xPercent: number, yPercent: number) {
  el.style.left = `${xPercent}%`;
  el.style.top = `${yPercent}%`;
}

function setStatus(text: string) {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ""), 3000);
}

function showMeow() {
  const x = parseFloat(catEl.style.left) || 50;
  const y = parseFloat(catEl.style.top) || 50;
  positionEl(meowBubbleEl, x, y);
  meowBubbleEl.classList.remove("hidden");
  clearTimeout(meowTimer);
  meowTimer = setTimeout(() => meowBubbleEl.classList.add("hidden"), 1500);
}

function handleCatTap() {
  showMeow();
  catEl.classList.remove("asleep");
  clearTimeout(awakeTimer);
  awakeTimer = setTimeout(() => catEl.classList.add("asleep"), 3000);
}

function celebrateFeed() {
  setStatus("Toby ate! 😋");
  catEl.classList.remove("asleep");
  clearTimeout(awakeTimer);
  awakeTimer = setTimeout(() => catEl.classList.add("asleep"), 3000);
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
  positionEl(catEl, s.catX, s.catY);
}

function renderFood(s: GameState) {
  if (s.foodX === null || s.foodY === null) {
    currentFoodEl?.remove();
    currentFoodEl = null;
    return;
  }
  if (!currentFoodEl) {
    currentFoodEl = document.createElement("div");
    currentFoodEl.className = "food";
    currentFoodEl.textContent = "🍗";
    sceneEl.appendChild(currentFoodEl);
    attachSceneDrag(currentFoodEl, placeFoodAndMaybeFeed);
  }
  positionEl(currentFoodEl, s.foodX, s.foodY);
}

function applyServerState(s: GameState) {
  state = s;
  renderCat(s);
  renderFood(s);
  renderStats(s);
}

async function moveCatAndMaybeFeed(x: number, y: number) {
  await api.moveCat(x, y);
  const result = await api.feed();
  applyServerState(result.state);
  if (result.fed) celebrateFeed();
}

async function placeFoodAndMaybeFeed(x: number, y: number) {
  await api.placeFood(x, y);
  const result = await api.feed();
  applyServerState(result.state);
  if (result.fed) celebrateFeed();
}

/** Drags an element that already lives inside #scene (the cat, or a placed food item). */
function attachSceneDrag(
  el: HTMLElement,
  onDrop: (xPercent: number, yPercent: number) => void,
  onTap?: () => void
) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    dragging = true;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) moved = true;
      const { x, y } = clientToScenePercent(ev.clientX, ev.clientY);
      positionEl(el, x, y);
    };

    const onUp = (ev: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.classList.remove("dragging");
      dragging = false;

      if (moved) {
        const { x, y } = clientToScenePercent(ev.clientX, ev.clientY);
        onDrop(x, y);
      } else {
        onTap?.();
      }
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  });
}

/** Drags the always-available chicken icon out of the tray to place a new food item in the scene. */
function attachTraySource(el: HTMLElement) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    dragging = true;

    const ghost = document.createElement("div");
    ghost.textContent = "🍗";
    Object.assign(ghost.style, {
      position: "fixed",
      fontSize: "2rem",
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

      const rect = sceneEl.getBoundingClientRect();
      const insideScene =
        ev.clientX >= rect.left &&
        ev.clientX <= rect.right &&
        ev.clientY >= rect.top &&
        ev.clientY <= rect.bottom;
      if (!insideScene) return;

      const { x, y } = clientToScenePercent(ev.clientX, ev.clientY);
      void placeFoodAndMaybeFeed(x, y);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  });
}

function startStirring() {
  setInterval(() => {
    if (dragging || !state) return;
    const chance = 0.05 + (state.hunger / 100) * 0.25;
    if (Math.random() < chance) {
      catEl.classList.add("stirring");
      showMeow();
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

async function init() {
  attachSceneDrag(catEl, moveCatAndMaybeFeed, handleCatTap);
  attachTraySource(traySourceEl);

  applyServerState(await api.getState());
  catEl.classList.add("asleep");

  startStirring();
  startPeriodicSync();
}

init().catch((err) => {
  console.error(err);
  setStatus("Couldn't reach the server — is it running?");
});
