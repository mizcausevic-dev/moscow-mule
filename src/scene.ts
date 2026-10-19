import { clamp, easeInOutCubic, easeOutBounce, easeOutCubic, hash, invLerp, lerp } from "./ease.ts";
import { DURATION, ICE_TIMES, MEASURES, POUR, STEPS, clockLabel, stepAt, type Step } from "./recipe.ts";

interface Layout {
  mode: "land" | "port";
  w: number;
  h: number;
  mugCx: number;
  mugTop: number;
  mugBot: number;
  mugTopR: number;
  mugBotR: number;
  wall: number;
  cardX: number;
  cardY: number;
  cardW: number;
  cardH: number;
}

interface Model {
  vodka: number;
  lime: number;
  ginger: number;
  fill: number;
  surfaceY: number;
  totalMl: number;
}

const LAND: Layout = {
  mode: "land",
  w: 1600,
  h: 900,
  mugCx: 600,
  mugTop: 236,
  mugBot: 700,
  mugTopR: 178,
  mugBotR: 126,
  wall: 22,
  cardX: 988,
  cardY: 148,
  cardW: 540,
  cardH: 560,
};

const PORT: Layout = {
  mode: "port",
  w: 900,
  h: 1400,
  mugCx: 450,
  mugTop: 176,
  mugBot: 628,
  mugTopR: 214,
  mugBotR: 156,
  wall: 24,
  cardX: 36,
  cardY: 688,
  cardW: 828,
  cardH: 640,
};

const CUBES = [
  { ox: -0.78, oy: 0.08, rot: -0.22, size: 76 },
  { ox: 0.72, oy: 0.07, rot: 0.16, size: 82 },
  { ox: -0.04, oy: 0.1, rot: 0.04, size: 74 },
  { ox: -0.58, oy: 0.3, rot: 0.24, size: 72 },
  { ox: 0.52, oy: 0.32, rot: -0.18, size: 76 },
  { ox: -0.12, oy: 0.52, rot: 0.1, size: 68 },
  { ox: 0.34, oy: 0.74, rot: -0.12, size: 64 },
] as const;

const CREAM = "#f6f0e7";
const CREAM_DIM = "rgba(246, 240, 231, 0.66)";
const COPPER = "#e0a36a";
const INK = "#140e0b";

let grain: HTMLCanvasElement | null = null;

function layoutFor(aspect: number): Layout {
  return aspect < 1 ? PORT : LAND;
}

function halfWidth(layout: Layout, y: number, inset: number): number {
  const span = layout.mugBot - layout.mugTop;
  const u = clamp((y - layout.mugTop) / span, 0, 1);
  const belly = Math.sin(u * Math.PI) * layout.mugTopR * 0.035;
  return Math.max(18, lerp(layout.mugTopR, layout.mugBotR, u ** 0.95) + belly - inset);
}

function addCupPath(ctx: CanvasRenderingContext2D, layout: Layout, inset: number): void {
  const top = layout.mugTop + (inset > 0 ? 16 : 0);
  const bot = layout.mugBot - (inset > 0 ? 14 : 0);
  const sideBot = bot - Math.max(18, 34 - inset);
  const steps = 10;
  const xAt = (y: number, side: -1 | 1) => layout.mugCx + side * halfWidth(layout, y, inset);

  ctx.moveTo(xAt(top, -1), top);
  for (let i = 1; i <= steps; i++) {
    const y = lerp(top, sideBot, i / steps);
    ctx.lineTo(xAt(y, -1), y);
  }
  ctx.quadraticCurveTo(xAt(sideBot, -1), bot, layout.mugCx, bot);
  ctx.quadraticCurveTo(xAt(sideBot, 1), bot, xAt(sideBot, 1), sideBot);
  for (let i = steps - 1; i >= 0; i--) {
    const y = lerp(top, sideBot, i / steps);
    ctx.lineTo(xAt(y, 1), y);
  }
  ctx.closePath();
}

function traceCup(ctx: CanvasRenderingContext2D, layout: Layout, inset: number): void {
  ctx.beginPath();
  addCupPath(ctx, layout, inset);
}

function sample(layout: Layout, time: number): Model {
  const vodka = easeInOutCubic(invLerp(POUR.vodka.from, POUR.vodka.to, time));
  const lime = easeInOutCubic(invLerp(POUR.lime.from, POUR.lime.to, time));
  const ginger = easeInOutCubic(invLerp(POUR.ginger.from, POUR.ginger.to, time));
  const fill = vodka * 0.32 + lime * 0.05 + ginger * 0.5;
  const innerTop = layout.mugTop + 30;
  const innerBot = layout.mugBot - 24;
  return {
    vodka,
    lime,
    ginger,
    fill,
    surfaceY: innerBot - (innerBot - innerTop) * fill,
    totalMl: vodka * MEASURES.vodkaMl + lime * MEASURES.limeMl + ginger * MEASURES.gingerMl,
  };
}

function mixLiquid(model: Model): { r: number; g: number; b: number; a: number } {
  const parts = [
    { w: Math.max(0.0001, model.vodka * MEASURES.vodkaMl), r: 186, g: 208, b: 214 },
    { w: model.lime * MEASURES.limeMl, r: 154, g: 184, b: 74 },
    { w: model.ginger * MEASURES.gingerMl, r: 188, g: 114, b: 32 },
  ];
  let weight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const part of parts) {
    weight += part.w;
    r += part.r * part.w;
    g += part.g * part.w;
    b += part.b * part.w;
  }
  return {
    r: r / weight,
    g: g / weight,
    b: b / weight,
    a: 0.48 + model.ginger * 0.4 + model.vodka * 0.06,
  };
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

function setType(
  ctx: CanvasRenderingContext2D,
  weight: number,
  size: number,
  family: "Fraunces" | "Outfit",
  tracking = "0px",
): void {
  const fallback = family === "Fraunces" ? "Georgia, serif" : "sans-serif";
  ctx.font = `${weight} ${size}px ${family}, ${fallback}`;
  ctx.letterSpacing = tracking;
}

function drawBackground(ctx: CanvasRenderingContext2D, layout: Layout, time: number): void {
  const wash = ctx.createLinearGradient(0, 0, 0, layout.h);
  wash.addColorStop(0, "#1c1612");
  wash.addColorStop(0.46, "#0d0a08");
  wash.addColorStop(1, "#070504");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, layout.w, layout.h);

  const glow = 0.15 + Math.sin(time * 0.65) * 0.018;
  const spot = ctx.createRadialGradient(layout.mugCx, layout.mugTop + 160, 30, layout.mugCx, layout.mugTop + 180, 560);
  spot.addColorStop(0, `rgba(255, 178, 112, ${glow})`);
  spot.addColorStop(0.5, "rgba(150, 68, 28, 0.05)");
  spot.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, layout.w, layout.h);
}

function drawCounter(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const y = layout.mugBot - 8;
  const counter = ctx.createLinearGradient(0, y, 0, layout.h);
  counter.addColorStop(0, "#2c1d14");
  counter.addColorStop(0.12, "#1a110d");
  counter.addColorStop(1, "#0c0806");
  ctx.fillStyle = counter;
  ctx.fillRect(0, y, layout.w, layout.h - y);
  ctx.beginPath();
  ctx.moveTo(0, y + 0.5);
  ctx.lineTo(layout.w, y + 0.5);
  ctx.strokeStyle = "rgba(255, 214, 176, 0.22)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawHandle(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const y1 = layout.mugTop + 72;
  const y2 = layout.mugBot - 118;
  const x1 = layout.mugCx + halfWidth(layout, y1, 0) - 4;
  const x2 = layout.mugCx + halfWidth(layout, y2, 0) - 4;
  const metal = ctx.createLinearGradient(x1, y1, x1 + 120, y2);
  metal.addColorStop(0, "#f3c7a0");
  metal.addColorStop(0.45, "#c47b3c");
  metal.addColorStop(1, "#623216");
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = metal;
  ctx.lineWidth = layout.mode === "port" ? 26 : 22;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(x1 + 118, y1 - 16, x1 + 124, y2 + 20, x2, y2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 236, 220, 0.32)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1 + 4, y1 + 10);
  ctx.bezierCurveTo(x1 + 96, y1 + 2, x1 + 98, y2 - 4, x2 + 2, y2 - 8);
  ctx.stroke();
  ctx.restore();
}

function drawCupShell(ctx: CanvasRenderingContext2D, layout: Layout): void {
  traceCup(ctx, layout, 0);
  const shell = ctx.createLinearGradient(
    layout.mugCx - layout.mugTopR,
    0,
    layout.mugCx + layout.mugTopR,
    0,
  );
  shell.addColorStop(0, "#4a2412");
  shell.addColorStop(0.16, "#c4783a");
  shell.addColorStop(0.3, "#f6d0aa");
  shell.addColorStop(0.46, "#a85c2c");
  shell.addColorStop(0.68, "#e8b07a");
  shell.addColorStop(1, "#542910");
  ctx.fillStyle = shell;
  ctx.fill();

  ctx.save();
  ctx.clip();
  const sheen = ctx.createLinearGradient(layout.mugCx - layout.mugTopR, 0, layout.mugCx, 0);
  sheen.addColorStop(0, "rgba(255, 244, 230, 0.18)");
  sheen.addColorStop(1, "rgba(255, 244, 230, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(layout.mugCx - layout.mugTopR - 20, layout.mugTop, layout.mugTopR, layout.mugBot);
  ctx.restore();
}

function clipCavity(ctx: CanvasRenderingContext2D, layout: Layout, extraTop: number): void {
  const inset = layout.wall;
  const top = layout.mugTop + 16;
  const bot = layout.mugBot - 14;
  const sideBot = bot - Math.max(18, 34 - inset);
  const steps = 10;
  const xAt = (y: number, side: -1 | 1) => layout.mugCx + side * halfWidth(layout, y, inset);
  ctx.beginPath();
  ctx.moveTo(xAt(top, -1), top - extraTop);
  ctx.lineTo(xAt(top, -1), top);
  for (let i = 1; i <= steps; i++) {
    const y = lerp(top, sideBot, i / steps);
    ctx.lineTo(xAt(y, -1), y);
  }
  ctx.quadraticCurveTo(xAt(sideBot, -1), bot, layout.mugCx, bot);
  ctx.quadraticCurveTo(xAt(sideBot, 1), bot, xAt(sideBot, 1), sideBot);
  for (let i = steps - 1; i >= 0; i--) {
    const y = lerp(top, sideBot, i / steps);
    ctx.lineTo(xAt(y, 1), y);
  }
  ctx.lineTo(xAt(top, 1), top - extraTop);
  ctx.closePath();
  ctx.clip();
}

function drawCavity(ctx: CanvasRenderingContext2D, layout: Layout): void {
  traceCup(ctx, layout, layout.wall);
  const cavity = ctx.createLinearGradient(0, layout.mugTop, 0, layout.mugBot);
  cavity.addColorStop(0, "#3a2922");
  cavity.addColorStop(0.35, "#1a120f");
  cavity.addColorStop(1, "#0c0908");
  ctx.fillStyle = cavity;
  ctx.fill();
}

function drawLiquid(ctx: CanvasRenderingContext2D, layout: Layout, model: Model, time: number): void {
  if (model.fill < 0.004) return;
  const color = mixLiquid(model);
  const top = model.surfaceY;
  const body = ctx.createLinearGradient(0, top, 0, layout.mugBot);
  body.addColorStop(0, rgba(color.r + 28, color.g + 24, color.b + 16, Math.min(0.96, color.a + 0.08)));
  body.addColorStop(0.22, rgba(color.r, color.g, color.b, color.a));
  body.addColorStop(1, rgba(color.r * 0.55, color.g * 0.5, color.b * 0.4, Math.min(0.98, color.a + 0.15)));
  ctx.fillStyle = body;
  ctx.fillRect(layout.mugCx - 400, top, 800, layout.mugBot - top + 30);

  const half = halfWidth(layout, top, layout.wall + 4);
  const wave = Math.sin(time * 2.4) * (time > 21.8 && time < 24.8 ? 5 : 1.4);
  ctx.beginPath();
  ctx.ellipse(layout.mugCx, top + wave * 0.15, half * 0.94, 11 + Math.abs(wave), 0, 0, Math.PI * 2);
  ctx.fillStyle = rgba(Math.min(255, color.r + 40), Math.min(255, color.g + 36), Math.min(255, color.b + 24), 0.35);
  ctx.fill();

  const cap = surfaceCap(time);
  if (cap > 0.02) {
    ctx.beginPath();
    ctx.ellipse(layout.mugCx, top - 1, half * 0.9, 8 + cap * 10, 0, 0, Math.PI * 2);
    ctx.fillStyle = capColor(time, cap);
    ctx.fill();
  }
}

function surfaceCap(time: number): number {
  const band = (from: number, to: number) => {
    if (time < from || time > to + 0.55) return 0;
    if (time > to) return 1 - (time - to) / 0.55;
    const p = invLerp(from, to, time);
    return Math.sin(Math.min(1, p) * Math.PI);
  };
  return Math.max(band(POUR.vodka.from, POUR.vodka.to), band(POUR.lime.from, POUR.lime.to), band(POUR.ginger.from, POUR.ginger.to));
}

function capColor(time: number, amount: number): string {
  if (time >= POUR.ginger.from) return `rgba(214, 154, 58, ${0.25 + amount * 0.45})`;
  if (time >= POUR.lime.from) return `rgba(198, 214, 86, ${0.25 + amount * 0.5})`;
  return `rgba(232, 244, 248, ${0.2 + amount * 0.4})`;
}

function drawFoam(ctx: CanvasRenderingContext2D, layout: Layout, model: Model, time: number): void {
  const settled = model.ginger * (time < POUR.ginger.to ? 1 : lerp(1, 0.42, clamp((time - POUR.ginger.to) / 2.4, 0, 1)));
  if (settled < 0.04) return;
  const half = halfWidth(layout, model.surfaceY, layout.wall + 8);
  const head = 8 + settled * 18;
  ctx.beginPath();
  ctx.ellipse(layout.mugCx, model.surfaceY - head * 0.15, half * 0.9, head * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 246, 236, ${0.22 + settled * 0.38})`;
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    const u = i / 4;
    const x = layout.mugCx + (u - 0.5) * half * 1.5;
    const r = (4 + hash(i + 2) * 7) * (0.6 + settled);
    ctx.beginPath();
    ctx.ellipse(x, model.surfaceY - head * (0.35 + hash(i + 8) * 0.4), r * 1.4, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 252, 247, ${0.18 + settled * 0.28})`;
    ctx.fill();
  }
}

function drawBubbles(ctx: CanvasRenderingContext2D, layout: Layout, model: Model, time: number): void {
  if (model.ginger <= 0) return;
  const activity = time < POUR.ginger.to + 2.5 ? 1 : 0.45;
  for (let i = 0; i < 34; i++) {
    const seed = i + 1;
    const depth = hash(seed * 2.3);
    const speed = 36 + hash(seed * 4.1) * 80;
    const travel = (layout.mugBot - model.surfaceY) * (0.45 + depth * 0.55);
    const loop = (time * speed * activity + hash(seed) * 320) % Math.max(40, travel);
    const y = layout.mugBot - 18 - loop;
    if (y < model.surfaceY + 4) continue;
    const half = halfWidth(layout, y, layout.wall + 14);
    const x = layout.mugCx + (hash(seed * 8.7) - 0.5) * half * 1.7;
    const radius = 1.2 + hash(seed * 6.5) * (time < POUR.ginger.to ? 3.4 : 2.2);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 236, 210, ${0.18 + hash(seed * 1.7) * 0.38})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - radius * 0.3, y - radius * 0.3, Math.max(0.4, radius * 0.28), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fill();
  }
}

function drawIce(ctx: CanvasRenderingContext2D, layout: Layout, time: number): void {
  const innerTop = layout.mugTop + 28;
  const innerBot = layout.mugBot - 26;
  const stir = invLerp(21.8, 24.6, time);
  const wobble = Math.sin(stir * Math.PI * 2) * 8 * Math.sin(stir * Math.PI);

  CUBES.forEach((cube, index) => {
    const at = ICE_TIMES[index];
    if (time < at) return;
    const fall = easeOutBounce(clamp((time - at) / 0.58, 0, 1));
    const restY = lerp(innerBot, innerTop, cube.oy);
    const y = lerp(layout.mugTop - cube.size * 0.2, restY, fall);
    const half = halfWidth(layout, restY, layout.wall + 12);
    const limit = Math.max(16, half - cube.size * 0.36);
    const x = layout.mugCx + cube.ox * limit + (fall > 0.92 ? wobble * (index % 2 === 0 ? 1 : -0.6) : 0);
    const rot = cube.rot + wobble * 0.012 * (index % 2 === 0 ? 1 : -1);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    roundCube(ctx, cube.size);
    ctx.restore();

    const age = time - (at + 0.2);
    if (age >= 0 && age < 0.26) {
      drawLanding(ctx, x, Math.min(y + cube.size * 0.2, restY), age / 0.26, index);
    }
  });
}

function roundCube(ctx: CanvasRenderingContext2D, size: number): void {
  const w = size;
  const h = size * 0.86;
  const radius = Math.max(8, size * 0.14);
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, radius);
  const ice = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  ice.addColorStop(0, "rgba(255, 255, 255, 0.94)");
  ice.addColorStop(0.45, "rgba(214, 230, 238, 0.78)");
  ice.addColorStop(1, "rgba(176, 198, 210, 0.7)");
  ctx.fillStyle = ice;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-w * 0.22, -h * 0.2);
  ctx.lineTo(-w * 0.02, h * 0.05);
  ctx.lineTo(w * 0.16, -h * 0.02);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(-w * 0.18, -h * 0.16, w * 0.16, h * 0.1, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.fill();
}

function drawLanding(ctx: CanvasRenderingContext2D, x: number, y: number, amount: number, index: number): void {
  ctx.save();
  for (let k = 0; k < 4; k++) {
    const angle = hash(index * 13 + k * 3) * Math.PI * 2;
    const dist = 8 + amount * 22;
    ctx.globalAlpha = 1 - amount;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist * 0.45, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRim(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const y = layout.mugTop + 2;
  const left = layout.mugCx - halfWidth(layout, layout.mugTop, 0);
  const right = layout.mugCx + halfWidth(layout, layout.mugTop, 0);
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.strokeStyle = "#f4d2b4";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.stroke();

  const lip = layout.mugTop + 15;
  ctx.beginPath();
  ctx.moveTo(left + 12, lip);
  ctx.lineTo(right - 12, lip);
  ctx.strokeStyle = "rgba(48, 22, 12, 0.55)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(left + 18, layout.mugTop + 36);
  ctx.quadraticCurveTo(
    layout.mugCx - halfWidth(layout, (layout.mugTop + layout.mugBot) / 2, 0) + 10,
    (layout.mugTop + layout.mugBot) / 2,
    layout.mugCx - halfWidth(layout, layout.mugBot - 40, 0) + 16,
    layout.mugBot - 48,
  );
  ctx.strokeStyle = "rgba(255, 244, 230, 0.28)";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawCondensation(ctx: CanvasRenderingContext2D, layout: Layout, time: number): void {
  for (let i = 0; i < 16; i++) {
    const grow = clamp((time - 8.2 - i * 0.28) / 3.5, 0, 1);
    if (grow <= 0) continue;
    const side = i % 2 === 0 ? -1 : 1;
    const y = lerp(layout.mugTop + 48, layout.mugBot - 36, hash(i + 4));
    const x = layout.mugCx + side * (halfWidth(layout, y, 0) - 2);
    ctx.beginPath();
    ctx.ellipse(x, y, 2.1 * grow, 3.3 * grow, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(226, 236, 240, ${0.22 * grow})`;
    ctx.fill();
  }
}

function drawEmptyLabel(ctx: CanvasRenderingContext2D, layout: Layout, time: number): void {
  if (time > 3.1) return;
  const alpha = time < 2.4 ? 1 : 1 - (time - 2.4) / 0.7;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  setType(ctx, 500, 15, "Outfit", "0.28em");
  ctx.fillStyle = "rgba(246, 240, 231, 0.42)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("EMPTY", layout.mugCx, (layout.mugTop + layout.mugBot) / 2);
  ctx.restore();
}

function propVisibility(time: number, from: number, to: number): number {
  const enter = easeOutCubic(clamp((time - (from - 0.48)) / 0.48, 0, 1));
  const exit = easeInOutCubic(clamp((time - to) / 0.42, 0, 1));
  return enter * (1 - exit);
}

function addBottlePath(
  ctx: CanvasRenderingContext2D,
  bodyWidth: number,
  bodyHeight: number,
  neckWidth: number,
  neckHeight: number,
): void {
  const bw = bodyWidth / 2;
  const nw = neckWidth / 2;
  const shoulder = -neckHeight;
  const base = -neckHeight - bodyHeight;
  ctx.beginPath();
  ctx.moveTo(-nw, 0);
  ctx.lineTo(-nw, shoulder + 10);
  ctx.bezierCurveTo(-nw - 2, shoulder, -bw + 8, shoulder - 2, -bw, shoulder - 20);
  ctx.lineTo(-bw, base + 18);
  ctx.quadraticCurveTo(-bw, base, -bw + 16, base);
  ctx.lineTo(bw - 16, base);
  ctx.quadraticCurveTo(bw, base, bw, base + 18);
  ctx.lineTo(bw, shoulder - 20);
  ctx.bezierCurveTo(bw - 8, shoulder - 2, nw + 2, shoulder, nw, shoulder + 10);
  ctx.lineTo(nw, 0);
  ctx.closePath();
}

function drawVodkaBottle(ctx: CanvasRenderingContext2D, level: number): void {
  const neck = 32;
  const body = 112;
  const base = -(neck + body);
  ctx.save();
  addBottlePath(ctx, 70, body, 18, neck);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();
  ctx.save();
  ctx.clip();
  const liquidY = -level * (body + neck * 0.35);
  ctx.fillStyle = "rgba(206, 224, 232, 0.42)";
  ctx.fillRect(-46, liquidY, 92, -liquidY + 6);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#f4efe8";
  ctx.fillRect(-26, base + 36, 52, 44);
  setType(ctx, 600, 11, "Outfit", "0.12em");
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VODKA", 0, base + 58);
  ctx.fillStyle = "#d7dde2";
  ctx.fillRect(-16, base - 8, 32, 10);
  ctx.restore();
}

function drawGingerBottle(ctx: CanvasRenderingContext2D, level: number): void {
  const neck = 28;
  const body = 118;
  const base = -(neck + body);
  ctx.save();
  addBottlePath(ctx, 84, body, 22, neck);
  const glass = ctx.createLinearGradient(-42, 0, 42, 0);
  glass.addColorStop(0, "rgba(92, 42, 12, 0.35)");
  glass.addColorStop(0.35, "rgba(214, 140, 48, 0.28)");
  glass.addColorStop(1, "rgba(70, 30, 8, 0.4)");
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const liquidY = -level * (body + neck * 0.3);
  ctx.fillStyle = "rgba(176, 96, 24, 0.78)";
  ctx.fillRect(-50, liquidY, 100, -liquidY + 6);
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(-18 + i * 9, base + 70 - i * 10, 2.1, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 220, 160, 0.45)";
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255, 214, 160, 0.55)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#f6f0e4";
  ctx.fillRect(-32, base + 34, 64, 50);
  setType(ctx, 600, 11, "Outfit", "0.06em");
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("GINGER", 0, base + 52);
  ctx.fillText("BEER", 0, base + 68);
  ctx.fillStyle = "#1a120c";
  ctx.fillRect(-20, base - 10, 40, 12);
  ctx.restore();
}

function drawStream(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  time: number,
  color: string,
): void {
  const bend = Math.sin(time * 24) * 5;
  ctx.beginPath();
  ctx.moveTo(x0 - width / 2, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2, x1 - width * 0.28, y1);
  ctx.lineTo(x1 + width * 0.28, y1);
  ctx.quadraticCurveTo((x0 + x1) / 2 + bend + 7, (y0 + y1) / 2, x0 + width / 2, y0);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawRipples(ctx: CanvasRenderingContext2D, x: number, y: number, half: number, time: number): void {
  for (let i = 0; i < 3; i++) {
    const phase = (time * 1.6 + i / 3) % 1;
    ctx.beginPath();
    ctx.ellipse(x, y, half * (0.15 + phase * 0.75), 5 + phase * 6, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${(1 - phase) * 0.32})`;
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
}

function drawPours(ctx: CanvasRenderingContext2D, layout: Layout, model: Model, time: number): void {
  drawSpirit(ctx, layout, model, time);
  drawLime(ctx, layout, model, time);
  drawGinger(ctx, layout, model, time);
}

function drawSpirit(ctx: CanvasRenderingContext2D, layout: Layout, model: Model, time: number): void {
  const vis = propVisibility(time, POUR.vodka.from, POUR.vodka.to);
  if (vis < 0.02) return;
  const pour = model.vodka;
  const mouthX = layout.mugCx - 8;
  const mouthY = layout.mugTop - 4;
  const x = lerp(layout.mugCx - 260, mouthX, Math.min(1, vis * 1.2));
  const y = lerp(layout.mugTop - 180, mouthY, Math.min(1, vis * 1.2));
  ctx.save();
  ctx.globalAlpha = clamp(vis * 1.6, 0, 1);
  ctx.translate(x, y);
  ctx.rotate(lerp(-0.85, -0.04, easeInOutCubic(clamp(pour + (1 - vis) * 0.2, 0, 1))));
  drawVodkaBottle(ctx, 1 - pour * 0.72);
  ctx.restore();
  if (pour > 0.03 && pour < 0.985 && vis > 0.85) {
    drawStream(ctx, x, y, layout.mugCx - 6, model.surfaceY, 7, time, "rgba(226, 238, 244, 0.72)");
    drawRipples(ctx, layout.mugCx, model.surfaceY, halfWidth(layout, model.surfaceY, layout.wall), time);
    drawLeader(ctx, layout, x, y);
  }
}

function drawGinger(ctx: CanvasRenderingContext2D, layout: Layout, model: Model, time: number): void {
  const vis = propVisibility(time, POUR.ginger.from, POUR.ginger.to);
  if (vis < 0.02) return;
  const pour = model.ginger;
  const mouthX = layout.mugCx + 18;
  const mouthY = layout.mugTop - 2;
  const x = lerp(layout.mugCx + 40, mouthX, Math.min(1, vis * 1.15));
  const y = lerp(layout.mugTop - 210, mouthY, Math.min(1, vis * 1.15));
  ctx.save();
  ctx.globalAlpha = clamp(vis * 1.6, 0, 1);
  ctx.translate(x, y);
  ctx.rotate(lerp(0.28, 0.04, easeInOutCubic(clamp(pour + (1 - vis) * 0.15, 0, 1))));
  drawGingerBottle(ctx, 1 - pour * 0.8);
  ctx.restore();
  if (pour > 0.02 && pour < 0.985 && vis > 0.85) {
    drawStream(ctx, x, y, layout.mugCx + 8, model.surfaceY, 9, time, "rgba(196, 122, 36, 0.88)");
    drawRipples(ctx, layout.mugCx, model.surfaceY, halfWidth(layout, model.surfaceY, layout.wall), time);
    drawLeader(ctx, layout, x, y);
  }
}

function drawLime(ctx: CanvasRenderingContext2D, layout: Layout, model: Model, time: number): void {
  const vis = propVisibility(time, POUR.lime.from, POUR.lime.to);
  if (vis < 0.02) return;
  const pour = model.lime;
  const x = lerp(layout.mugCx - 180, layout.mugCx - 36, Math.min(1, vis * 1.2));
  const y = lerp(layout.mugTop - 140, layout.mugTop - 58, Math.min(1, vis * 1.2));
  const squeeze = Math.sin(clamp(pour, 0, 1) * Math.PI);
  ctx.save();
  ctx.globalAlpha = clamp(vis * 1.5, 0, 1);
  ctx.translate(x, y);
  ctx.rotate(0.08);
  ctx.scale(1.35 + squeeze * 0.08, 1.35 - squeeze * 0.22);
  drawLimeHalf(ctx);
  ctx.restore();

  if (pour <= 0.02 || pour >= 0.99 || vis < 0.8) return;
  const impactX = layout.mugCx - 6;
  const impactY = model.surfaceY;
  drawStream(ctx, x, y + 6, impactX, impactY, 4.5, time, "rgba(176, 204, 64, 0.82)");
  for (let i = 0; i < 12; i++) {
    const birth = POUR.lime.from + 0.05 + i * 0.18;
    const age = (time - birth) / 0.5;
    if (age < 0 || age > 1) continue;
    const px = lerp(x, impactX, age) + Math.sin(age * Math.PI) * (10 + (i % 4) * 6);
    const py = lerp(y + 10, impactY, age);
    ctx.beginPath();
    ctx.arc(px, py, lerp(4.2, 1.6, age), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(186, 210, 70, ${0.95 - age * 0.15})`;
    ctx.fill();
  }
  drawRipples(ctx, impactX, impactY, halfWidth(layout, impactY, layout.wall), time);
  drawLeader(ctx, layout, x, y);
}

function drawLimeHalf(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(0, 0, 64, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = "#5d8e1c";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 54, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = "#eef3cc";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 47, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = "#d5e56e";
  ctx.fill();
  ctx.strokeStyle = "rgba(90, 110, 28, 0.4)";
  ctx.lineWidth = 1.4;
  for (let i = 1; i <= 4; i++) {
    const angle = Math.PI + (i * Math.PI) / 5;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(Math.cos(angle) * 46, Math.sin(angle) * 46);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-64, 0);
  ctx.lineTo(64, 0);
  ctx.strokeStyle = "#6f9424";
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawLeader(ctx: CanvasRenderingContext2D, layout: Layout, x: number, y: number): void {
  if (layout.mode !== "land") return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(layout.cardX - 8, layout.cardY + 210);
  ctx.quadraticCurveTo((layout.cardX + x) / 2, y - 30, x, y);
  ctx.strokeStyle = "rgba(224, 163, 106, 0.55)";
  ctx.lineWidth = 1.25;
  ctx.setLineDash([3, 7]);
  ctx.stroke();
  ctx.restore();
}

function drawSpoon(ctx: CanvasRenderingContext2D, layout: Layout, model: Model, time: number): void {
  const stir = invLerp(21.85, 24.45, time);
  if (stir <= 0 || stir >= 1) return;
  const fade = Math.sin(stir * Math.PI);
  const angle = stir * Math.PI * 2;
  const x = layout.mugCx + Math.cos(angle) * 28;
  const y = model.surfaceY + 36;
  const handleX = layout.mugCx + 150;
  const handleY = layout.mugTop - 28;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#c5ced6";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(handleX, handleY);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 2, y - 4);
  ctx.lineTo(handleX - 4, handleY + 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y + 8, 16, 26, Math.sin(angle) * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = "#f7fafc";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#9aa7b2";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(handleX, handleY, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#eef3f6";
  ctx.fill();
  ctx.restore();
}

function drawGarnish(ctx: CanvasRenderingContext2D, layout: Layout, time: number): void {
  if (time < 24.7) return;
  const drop = easeOutBounce(clamp((time - 24.75) / 0.72, 0, 1));
  const restX = layout.mugCx + halfWidth(layout, layout.mugTop, 0) - 20;
  const restY = layout.mugTop + 4;
  const y = lerp(layout.mugTop - 190, restY, drop);
  ctx.save();
  ctx.translate(restX, y);
  ctx.rotate(lerp(-0.8, 0.42, drop));
  drawLimeWheel(ctx, 44);
  ctx.restore();
}

function drawLimeWheel(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#5f8f1e";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = "#edf3c4";
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius * 0.74, i * (Math.PI / 4), (i + 0.86) * (Math.PI / 4));
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? "#d7e86e" : "#c3d85a";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = "#f7f8e4";
  ctx.fill();
}

function drawCutawayTag(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const x = layout.mugCx - halfWidth(layout, layout.mugTop, 0) - 14;
  setType(ctx, 500, 13, "Outfit", "0.24em");
  ctx.fillStyle = "rgba(224, 163, 106, 0.78)";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("CUTAWAY", x, layout.mugTop - 8);
}

function drawClock(ctx: CanvasRenderingContext2D, layout: Layout, time: number): void {
  setType(ctx, 500, 16, "Outfit", "0.08em");
  ctx.fillStyle = "rgba(246, 240, 231, 0.72)";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${clockLabel(time)}  /  0:30`, 48, layout.h - 36);
}

function drawCard(ctx: CanvasRenderingContext2D, layout: Layout, model: Model, time: number): void {
  const step = stepAt(time);
  const enter = easeOutCubic(clamp(time / 0.65, 0, 1));
  const x = layout.cardX + (1 - enter) * (layout.mode === "land" ? 48 : 0);
  const y = layout.cardY + (layout.mode === "port" ? (1 - enter) * 28 : 0);
  ctx.save();
  ctx.globalAlpha = enter;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 18;
  roundPanel(ctx, x, y, layout.cardW, layout.cardH);
  ctx.fillStyle = "rgba(22, 15, 12, 0.9)";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "rgba(224, 163, 106, 0.42)";
  ctx.stroke();

  const since = time - step.from;
  const fade = step.from === 0 ? 1 : easeOutCubic(clamp(since / 0.22, 0, 1));
  ctx.save();
  ctx.globalAlpha = fade;
  drawChipRow(ctx, x, y, layout.cardW, step);
  if (step.id === "intro") drawIntro(ctx, x, y, layout.cardW);
  else if (step.id === "serve") drawServe(ctx, x, y, layout.cardW);
  else drawFocus(ctx, x, y, layout.cardW, layout.cardH, step, model, time);
  drawFooter(ctx, x, y, layout.cardW, layout.cardH, step.narration);
  ctx.restore();
  ctx.restore();
}

function roundPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 22);
}

function drawChipRow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, step: Step): void {
  const chips = STEPS.filter((item) => item.id !== "intro" && item.id !== "serve");
  const gap = 8;
  const pad = 22;
  const chipW = (w - pad * 2 - gap * (chips.length - 1)) / chips.length;
  chips.forEach((chip, index) => {
    const cx = x + pad + index * (chipW + gap);
    const cy = y + 22;
    const state = step.id === "serve" || step.from > chip.from ? "done" : step.id === chip.id ? "now" : "wait";
    ctx.beginPath();
    ctx.roundRect(cx, cy, chipW, 28, 999);
    ctx.fillStyle = state === "now" ? COPPER : "rgba(246, 240, 231, 0.04)";
    ctx.fill();
    setType(ctx, 600, 11, "Outfit", "0.08em");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = state === "now" ? INK : state === "done" ? COPPER : "rgba(246,240,231,0.42)";
    ctx.fillText(chip.chip.toUpperCase(), cx + chipW / 2, cy + 15);
  });
}

function drawIntro(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const left = x + 32;
  setType(ctx, 500, 14, "Outfit", "0.18em");
  ctx.fillStyle = COPPER;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("CUTAWAY  ·  30 SECONDS", left, y + 72);
  setType(ctx, 600, 78, "Fraunces");
  ctx.fillStyle = CREAM;
  ctx.fillText("Moscow", left, y + 108);
  ctx.fillText("Mule", left, y + 186);

  setType(ctx, 400, 18, "Outfit");
  ctx.fillStyle = CREAM_DIM;
  ctx.fillText("Three measures. One copper cup.", left, y + 292);

  const rows = [
    ["Vodka", "45 ml", MEASURES.vodkaOz],
    ["Lime juice", "10 ml", MEASURES.limeOz],
    ["Ginger beer", "120 ml", MEASURES.gingerOz],
  ];
  rows.forEach((row, index) => {
    const ry = y + 348 + index * 48;
    setType(ctx, 500, 20, "Outfit");
    ctx.fillStyle = CREAM;
    ctx.textAlign = "left";
    ctx.fillText(row[0], left, ry);
    ctx.textAlign = "right";
    ctx.fillStyle = COPPER;
    ctx.fillText(row[1], x + w - 32, ry);
    setType(ctx, 400, 14, "Outfit");
    ctx.fillStyle = CREAM_DIM;
    ctx.fillText(row[2], x + w - 32, ry + 22);
  });
}

function drawFocus(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  step: Step,
  model: Model,
  time: number,
): void {
  const left = x + 32;
  setType(ctx, 500, 14, "Outfit", "0.18em");
  ctx.fillStyle = COPPER;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(step.kicker.toUpperCase(), left, y + 72);

  setType(ctx, 600, 52, "Fraunces");
  ctx.fillStyle = CREAM;
  ctx.fillText(step.title, left, y + 104);

  if (step.id === "ice") {
    const landed = ICE_TIMES.filter((at) => time >= at + 0.45).length;
    drawBigLine(ctx, left, y + 190, "Fill", "");
    setType(ctx, 400, 22, "Outfit");
    ctx.fillStyle = CREAM_DIM;
    ctx.textAlign = "left";
    ctx.fillText("To the rim", left, y + 300);
    drawBar(ctx, left, y + h - 150, w - 64, landed / ICE_TIMES.length);
    return;
  }

  if (step.id === "stir") {
    drawBigLine(ctx, left, y + 190, "Once", "");
    setType(ctx, 400, 22, "Outfit");
    ctx.fillStyle = CREAM_DIM;
    ctx.textAlign = "left";
    ctx.fillText("Gently", left, y + 300);
    drawBar(ctx, left, y + h - 150, w - 64, invLerp(21.8, 24.6, time));
    return;
  }

  if (step.id === "garnish") {
    drawBigLine(ctx, left, y + 190, "1", "slice");
    setType(ctx, 400, 22, "Outfit");
    ctx.fillStyle = CREAM_DIM;
    ctx.textAlign = "left";
    ctx.fillText("On the rim", left, y + 300);
    return;
  }

  const spec = step.id === "vodka"
    ? { ml: MEASURES.vodkaMl, oz: MEASURES.vodkaOz, p: model.vodka }
    : step.id === "lime"
      ? { ml: MEASURES.limeMl, oz: MEASURES.limeOz, p: model.lime }
      : { ml: MEASURES.gingerMl, oz: MEASURES.gingerOz, p: model.ginger };

  const shown = Math.round(spec.p * spec.ml);
  drawDigits(ctx, left, y + 186, shown, spec.ml, "ml");
  setType(ctx, 500, 22, "Outfit");
  ctx.fillStyle = spec.p > 0.82 ? CREAM : "rgba(246,240,231,0.35)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(spec.oz, left, y + 300);
  setType(ctx, 400, 16, "Outfit");
  ctx.fillStyle = CREAM_DIM;
  ctx.fillText(`In the cup  ·  ${Math.round(model.totalMl)} ml`, left, y + 338);
  drawBar(ctx, left, y + h - 150, w - 64, spec.p);
}

function drawBigLine(ctx: CanvasRenderingContext2D, x: number, y: number, word: string, unit: string): void {
  setType(ctx, 600, 92, "Fraunces");
  ctx.fillStyle = CREAM;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(word, x, y);
  if (!unit) return;
  const width = ctx.measureText(word).width;
  setType(ctx, 500, 28, "Outfit");
  ctx.fillStyle = COPPER;
  ctx.fillText(unit, x + width + 14, y + 54);
}

function drawDigits(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: number,
  max: number,
  unit: string,
): void {
  const text = String(value).padStart(String(max).length, " ");
  setType(ctx, 600, 104, "Fraunces");
  ctx.fillStyle = CREAM;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const cell = 62;
  for (let i = 0; i < text.length; i++) {
    const glyph = text[i];
    if (glyph === " ") continue;
    ctx.fillText(glyph, x + i * cell, y);
  }
  setType(ctx, 500, 28, "Outfit");
  ctx.fillStyle = COPPER;
  ctx.fillText(unit, x + text.length * cell + 8, y + 64);
}

function drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, amount: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, 6, 99);
  ctx.fillStyle = "rgba(246,240,231,0.12)";
  ctx.fill();
  const fill = Math.max(0, w * clamp(amount, 0, 1));
  if (fill <= 0) return;
  ctx.beginPath();
  ctx.roundRect(x, y, fill, 6, 99);
  ctx.fillStyle = COPPER;
  ctx.fill();
}

function drawServe(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const left = x + 32;
  setType(ctx, 500, 14, "Outfit", "0.18em");
  ctx.fillStyle = COPPER;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("IBA MEASURES", left, y + 72);
  setType(ctx, 600, 48, "Fraunces");
  ctx.fillStyle = CREAM;
  ctx.fillText("Moscow Mule", left, y + 102);

  const rows = [
    ["Vodka", "45 ml", MEASURES.vodkaOz],
    ["Lime juice", "10 ml", MEASURES.limeOz],
    ["Ginger beer", "120 ml", MEASURES.gingerOz],
    ["Lime slice", "1 slice", ""],
    ["Ice", "to the rim", ""],
  ];
  rows.forEach((row, index) => {
    const ry = y + 176 + index * 52;
    ctx.beginPath();
    ctx.moveTo(left, ry + 40);
    ctx.lineTo(x + w - 32, ry + 40);
    ctx.strokeStyle = "rgba(246,240,231,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
    setType(ctx, 500, 22, "Outfit");
    ctx.fillStyle = CREAM;
    ctx.textAlign = "left";
    ctx.fillText(row[0], left, ry);
    ctx.textAlign = "right";
    ctx.fillStyle = COPPER;
    ctx.fillText(row[1], x + w - 32, ry);
    if (row[2]) {
      setType(ctx, 400, 13, "Outfit");
      ctx.fillStyle = CREAM_DIM;
      ctx.fillText(row[2], x + w - 32, ry + 20);
    }
  });
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  line: string,
): void {
  const fy = y + h - 64;
  ctx.beginPath();
  ctx.moveTo(x + 28, fy);
  ctx.lineTo(x + w - 28, fy);
  ctx.strokeStyle = "rgba(224, 163, 106, 0.28)";
  ctx.lineWidth = 1;
  ctx.stroke();
  setType(ctx, 500, 18, "Outfit");
  ctx.fillStyle = CREAM;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(line, x + 32, fy + 32);
}

function drawGrain(ctx: CanvasRenderingContext2D, layout: Layout, time: number): void {
  if (!grain) {
    grain = document.createElement("canvas");
    grain.width = 160;
    grain.height = 160;
    const g = grain.getContext("2d");
    if (!g) return;
    const image = g.createImageData(160, 160);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = 80 + Math.random() * 175;
      image.data[i] = n;
      image.data[i + 1] = n;
      image.data[i + 2] = n;
      image.data[i + 3] = 255;
    }
    g.putImageData(image, 0, 0);
  }
  const pattern = ctx.createPattern(grain, "repeat");
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.translate((time * 18) % 160, (time * 11) % 160);
  ctx.fillStyle = pattern;
  ctx.fillRect(-160, -160, layout.w + 320, layout.h + 320);
  ctx.restore();
}

function drawVignette(ctx: CanvasRenderingContext2D, layout: Layout): void {
  const vignette = ctx.createRadialGradient(
    layout.w / 2,
    layout.h / 2,
    layout.w * 0.28,
    layout.w / 2,
    layout.h / 2,
    layout.w * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.48)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, layout.w, layout.h);
}

function drawMug(ctx: CanvasRenderingContext2D, layout: Layout, model: Model, time: number): void {
  const intro = easeOutCubic(clamp(time / 1.15, 0, 1));
  ctx.save();
  ctx.translate(0, lerp(22, 0, intro));

  ctx.save();
  ctx.filter = "blur(16px)";
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(layout.mugCx + 8, layout.mugBot + 10, layout.mugBotR * 0.92, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawHandle(ctx, layout);
  drawCupShell(ctx, layout);

  ctx.save();
  clipCavity(ctx, layout, 220);
  drawCavity(ctx, layout);
  drawLiquid(ctx, layout, model, time);
  drawBubbles(ctx, layout, model, time);
  drawFoam(ctx, layout, model, time);
  drawIce(ctx, layout, time);
  drawEmptyLabel(ctx, layout, time);
  ctx.restore();

  drawRim(ctx, layout);
  drawCondensation(ctx, layout, time);
  ctx.restore();
}

export function render(
  ctx: CanvasRenderingContext2D,
  time: number,
  pixelWidth: number,
  pixelHeight: number,
  cssAspect: number,
): void {
  const layout = layoutFor(cssAspect);
  const t = clamp(time, 0, DURATION);
  const model = sample(layout, t);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#070504";
  ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  ctx.imageSmoothingEnabled = true;

  const scale = Math.min(pixelWidth / layout.w, pixelHeight / layout.h);
  const offsetX = (pixelWidth - layout.w * scale) / 2;
  const offsetY = (pixelHeight - layout.h * scale) / 2;
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

  const zoom = lerp(1.03, 1, easeOutCubic(clamp(t / 1.8, 0, 1))) * lerp(1, 1.018, t / DURATION);
  ctx.save();
  ctx.translate(layout.w / 2, layout.h / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-layout.w / 2, -layout.h / 2);

  drawBackground(ctx, layout, t);
  drawCounter(ctx, layout);
  drawMug(ctx, layout, model, t);
  drawPours(ctx, layout, model, t);
  drawSpoon(ctx, layout, model, t);
  drawGarnish(ctx, layout, t);
  drawCutawayTag(ctx, layout);
  drawCard(ctx, layout, model, t);
  drawClock(ctx, layout, t);
  drawGrain(ctx, layout, t);
  drawVignette(ctx, layout);
  ctx.restore();
}
