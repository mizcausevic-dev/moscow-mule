export const DURATION = 30;

export const SOURCE_URL = "https://iba-world.com/iba-cocktail/moscow-mule/";

export const MEASURES = {
  vodkaMl: 45,
  limeMl: 10,
  gingerMl: 120,
  vodkaOz: "1 1/2 oz",
  limeOz: "1/3 oz",
  gingerOz: "4 oz",
} as const;

export const ICE_TIMES = [2.92, 3.34, 3.76, 4.22, 4.7, 5.18, 5.66] as const;

export const POUR = {
  vodka: { from: 7.05, to: 11.15 },
  lime: { from: 11.9, to: 14.35 },
  ginger: { from: 15.2, to: 21.45 },
} as const;

export type StepId = "intro" | "ice" | "vodka" | "lime" | "ginger" | "stir" | "garnish" | "serve";

export interface Step {
  id: StepId;
  chip: string;
  from: number;
  to: number;
  kicker: string;
  title: string;
  narration: string;
}

export const STEPS: readonly Step[] = [
  {
    id: "intro",
    chip: "Cup",
    from: 0,
    to: 2.55,
    kicker: "Cutaway · 30 seconds",
    title: "Moscow Mule",
    narration: "Start with an empty mule cup.",
  },
  {
    id: "ice",
    chip: "Ice",
    from: 2.55,
    to: 6.6,
    kicker: "Step 1 of 6",
    title: "Ice",
    narration: "Fill the mule cup with ice.",
  },
  {
    id: "vodka",
    chip: "Vodka",
    from: 6.6,
    to: 11.4,
    kicker: "Step 2 of 6",
    title: "Vodka",
    narration: "45 ml. A standard pour.",
  },
  {
    id: "lime",
    chip: "Lime",
    from: 11.4,
    to: 14.6,
    kicker: "Step 3 of 6",
    title: "Lime juice",
    narration: "10 ml. A short squeeze.",
  },
  {
    id: "ginger",
    chip: "Ginger",
    from: 14.6,
    to: 21.8,
    kicker: "Step 4 of 6",
    title: "Ginger beer",
    narration: "120 ml. This is the body of the drink.",
  },
  {
    id: "stir",
    chip: "Stir",
    from: 21.8,
    to: 24.6,
    kicker: "Step 5 of 6",
    title: "Stir",
    narration: "Once, gently, so the fizz stays.",
  },
  {
    id: "garnish",
    chip: "Slice",
    from: 24.6,
    to: 27.4,
    kicker: "Step 6 of 6",
    title: "Lime slice",
    narration: "One slice on the rim.",
  },
  {
    id: "serve",
    chip: "Serve",
    from: 27.4,
    to: 30,
    kicker: "IBA measures",
    title: "Moscow Mule",
    narration: "Serve cold.",
  },
];

export function stepAt(time: number): Step {
  let current: Step = STEPS[0];
  for (const step of STEPS) {
    if (time >= step.from) current = step;
  }
  return current;
}

export function clockLabel(time: number): string {
  const whole = Math.min(DURATION, Math.max(0, Math.floor(time)));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
