import { createScore } from "./audio.ts";
import { DURATION, STEPS, clockLabel } from "./recipe.ts";
import { render } from "./scene.ts";
import "./style.css";

function required<T extends Element>(node: T | null, name: string): T {
  if (!node) throw new Error(`${name} is missing.`);
  return node;
}

const canvas = required(document.querySelector<HTMLCanvasElement>("#frame"), "Canvas");
const playButton = required(document.querySelector<HTMLButtonElement>("#play"), "Play button");
const restartButton = required(document.querySelector<HTMLButtonElement>("#restart"), "Restart button");
const muteButton = required(document.querySelector<HTMLButtonElement>("#mute"), "Mute button");
const saveButton = required(document.querySelector<HTMLButtonElement>("#save"), "Save button");
const scrub = required(document.querySelector<HTMLInputElement>("#scrub"), "Seek bar");
const clock = required(document.querySelector<HTMLElement>("#clock"), "Clock");
const status = required(document.querySelector<HTMLElement>("#status"), "Status");
const curtain = required(document.querySelector<HTMLButtonElement>("#curtain"), "Play curtain");
const chapters = required(document.querySelector<HTMLElement>("#chapters"), "Chapters");

const context = canvas.getContext("2d", { alpha: false });
if (!context) throw new Error("Canvas is unavailable.");
const ctx: CanvasRenderingContext2D = context;

const score = createScore();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const params = new URLSearchParams(location.search);

let time = 0;
let playing = false;
let recording = false;
let lastStamp = performance.now();

const queryTime = params.get("t");
if (queryTime !== null && Number.isFinite(Number(queryTime))) {
  time = clampTime(Number(queryTime));
} else if (reducedMotion) {
  time = DURATION;
  curtain.querySelector(".curtain-title")!.textContent = "Play the build";
  curtain.querySelector(".curtain-sub")!.textContent = "Motion is reduced. The frame is the finished drink.";
}

scrub.max = String(DURATION);
scrub.step = "0.01";

for (const step of STEPS) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = step.chip;
  button.dataset.from = String(step.from);
  button.addEventListener("click", () => {
    if (recording) return;
    seek(step.from);
  });
  chapters.append(button);
}

function clampTime(value: number): number {
  return Math.max(0, Math.min(DURATION, value));
}

function cssAspect(): number {
  const rect = canvas.getBoundingClientRect();
  return rect.height > 0 ? rect.width / rect.height : 16 / 9;
}

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function draw(at: number): void {
  resize();
  render(ctx, at, canvas.width, canvas.height, cssAspect());
}

function seek(next: number): void {
  score.stop();
  score.reset();
  time = clampTime(next);
  playing = false;
  syncControls();
  draw(time);
}

function togglePlay(): void {
  if (recording) return;
  if (!playing && time >= DURATION) {
    score.reset();
    time = 0;
  }
  playing = !playing;
  lastStamp = performance.now();
  if (!playing) score.stop();
  else score.unlock();
  curtain.hidden = true;
  syncControls();
}

function syncControls(): void {
  const ended = !playing && time >= DURATION;
  playButton.textContent = playing ? "Pause" : ended ? "Replay" : "Play";
  playButton.setAttribute("aria-label", playButton.textContent);
  scrub.value = time.toFixed(2);
  scrub.style.setProperty("--p", `${(time / DURATION) * 100}%`);
  clock.textContent = `${clockLabel(time)} / 0:30`;
  const step = [...STEPS].reverse().find((item) => time >= item.from) ?? STEPS[0];
  for (const button of chapters.querySelectorAll("button")) {
    button.setAttribute("aria-current", button.dataset.from === String(step.from) ? "true" : "false");
  }
}

playButton.addEventListener("click", togglePlay);
curtain.addEventListener("click", togglePlay);
restartButton.addEventListener("click", () => {
  if (recording) return;
  score.reset();
  time = 0;
  playing = false;
  curtain.hidden = false;
  syncControls();
  draw(time);
});

muteButton.addEventListener("click", () => {
  const next = !score.muted;
  score.setMuted(next);
  muteButton.setAttribute("aria-pressed", String(next));
  muteButton.textContent = next ? "Sound off" : "Sound on";
  if (!next) score.unlock();
});

scrub.addEventListener("input", () => {
  if (recording) return;
  playing = false;
  score.stop();
  time = clampTime(Number(scrub.value));
  syncControls();
  draw(time);
});

window.addEventListener("keydown", (event) => {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlay();
  } else if (event.code === "ArrowRight") {
    playing = false;
    score.stop();
    time = clampTime(time + 1);
    syncControls();
    draw(time);
  } else if (event.code === "ArrowLeft") {
    playing = false;
    score.stop();
    time = clampTime(time - 1);
    syncControls();
    draw(time);
  }
});

saveButton.addEventListener("click", () => {
  void exportWebm();
});

async function exportWebm(): Promise<void> {
  if (recording) return;
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mime || typeof canvas!.captureStream !== "function") {
    status.textContent = "This browser cannot record a WebM from the canvas.";
    return;
  }

  recording = true;
  playing = false;
  score.stop();
  curtain.hidden = true;
  saveButton.disabled = true;
  time = 0;
  draw(0);
  status.textContent = "Recording 0:00";

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    recorder.onerror = () => reject(new Error("Recording failed."));
  });

  recorder.start();
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      time = Math.min(DURATION, elapsed);
      draw(time);
      syncControls();
      status.textContent = `Recording ${clockLabel(time)}`;
      if (time >= DURATION) {
        window.clearInterval(timer);
        resolve();
      }
    }, 1000 / 30);
  });

  recorder.requestData();
  recorder.stop();
  try {
    const blob = await stopped;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "moscow-mule-30s.webm";
    link.click();
    URL.revokeObjectURL(url);
    status.textContent = "Saved moscow-mule-30s.webm";
  } catch {
    status.textContent = "Recording failed before the file was ready.";
  }
  recording = false;
  saveButton.disabled = false;
  playing = false;
  syncControls();
}

function frame(now: number): void {
  const delta = Math.min(0.05, (now - lastStamp) / 1000);
  lastStamp = now;
  if (playing && !recording) {
    const previous = time;
    time = Math.min(DURATION, time + delta);
    score.sync(previous, time);
    if (time >= DURATION) {
      playing = false;
      score.stop();
    }
  }
  if (!recording) {
    draw(time);
    syncControls();
  }
  requestAnimationFrame(frame);
}

async function loadFonts(): Promise<void> {
  const faces = [
    new FontFace("Fraunces", "url(/fonts/fraunces-500.woff2)", { weight: "500" }),
    new FontFace("Fraunces", "url(/fonts/fraunces-600.woff2)", { weight: "600" }),
    new FontFace("Outfit", "url(/fonts/outfit-400.woff2)", { weight: "400" }),
    new FontFace("Outfit", "url(/fonts/outfit-500.woff2)", { weight: "500" }),
    new FontFace("Outfit", "url(/fonts/outfit-600.woff2)", { weight: "600" }),
  ];
  await Promise.all(faces.map(async (face) => document.fonts.add(await face.load())));
}

declare global {
  interface Window {
    __mule?: {
      seek: (time: number) => void;
      play: () => void;
      pause: () => void;
      getTime: () => number;
    };
  }
}

window.__mule = {
  seek,
  play: () => {
    if (!playing) togglePlay();
  },
  pause: () => {
    playing = false;
    score.stop();
    syncControls();
  },
  getTime: () => time,
};

const observer = new ResizeObserver(() => draw(time));
observer.observe(canvas);

loadFonts()
  .catch(() => undefined)
  .finally(() => {
    if (params.get("play") === "1" || params.get("shot") === "1") {
      curtain.hidden = true;
    }
    if (params.get("play") === "1") {
      playing = true;
      score.unlock();
    }
    syncControls();
    requestAnimationFrame(frame);
  });
