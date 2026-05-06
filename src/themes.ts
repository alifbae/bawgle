// Editor-inspired themes. Each theme is a small flat palette of CSS vars.

export interface ThemeColors {
  bg: string;
  panel: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  good: string;
  bad: string;
  warn: string;
  tile: string;
  "tile-fg": string;
}

export interface Theme {
  name: string;
  dark: boolean;
  c: ThemeColors;
}

export const THEMES: Record<string, Theme> = {
  dracula: {
    name: "Dracula",
    dark: true,
    c: {
      bg: "#282a36",
      panel: "#21222c",
      border: "#373949",
      fg: "#f8f8f2",
      muted: "#6272a4",
      accent: "#bd93f9",
      good: "#50fa7b",
      bad: "#ff5555",
      warn: "#f1fa8c",
      tile: "#44475a",
      "tile-fg": "#f8f8f2",
    },
  },
  monokai: {
    name: "Monokai",
    dark: true,
    c: {
      bg: "#272822",
      panel: "#1e1f1c",
      border: "#3e3d32",
      fg: "#f8f8f2",
      muted: "#75715e",
      accent: "#a6e22e",
      good: "#a6e22e",
      bad: "#f92672",
      warn: "#e6db74",
      tile: "#3e3d32",
      "tile-fg": "#f8f8f2",
    },
  },
  "solarized-dark": {
    name: "Solarized Dark",
    dark: true,
    c: {
      bg: "#002b36",
      panel: "#073642",
      border: "#0a4551",
      fg: "#eee8d5",
      muted: "#586e75",
      accent: "#268bd2",
      good: "#859900",
      bad: "#dc322f",
      warn: "#b58900",
      tile: "#094552",
      "tile-fg": "#eee8d5",
    },
  },
  "solarized-light": {
    name: "Solarized Light",
    dark: false,
    c: {
      bg: "#fdf6e3",
      panel: "#eee8d5",
      border: "#e0dbc6",
      fg: "#073642",
      muted: "#93a1a1",
      accent: "#268bd2",
      good: "#859900",
      bad: "#dc322f",
      warn: "#b58900",
      tile: "#fff9e8",
      "tile-fg": "#073642",
    },
  },
  cobalt: {
    name: "Cobalt",
    dark: true,
    c: {
      bg: "#002240",
      panel: "#001a33",
      border: "#0a3359",
      fg: "#ffffff",
      muted: "#7b96b3",
      accent: "#ffc600",
      good: "#3ad900",
      bad: "#ff628c",
      warn: "#ffc600",
      tile: "#053863",
      "tile-fg": "#ffffff",
    },
  },
  "one-dark": {
    name: "One Dark",
    dark: true,
    c: {
      bg: "#282c34",
      panel: "#21252b",
      border: "#3a3f4b",
      fg: "#abb2bf",
      muted: "#5c6370",
      accent: "#61afef",
      good: "#98c379",
      bad: "#e06c75",
      warn: "#d19a66",
      tile: "#353b45",
      "tile-fg": "#e5e7eb",
    },
  },
  nord: {
    name: "Nord",
    dark: true,
    c: {
      bg: "#2e3440",
      panel: "#3b4252",
      border: "#434c5e",
      fg: "#eceff4",
      muted: "#81a1c1",
      accent: "#88c0d0",
      good: "#a3be8c",
      bad: "#bf616a",
      warn: "#ebcb8b",
      tile: "#434c5e",
      "tile-fg": "#eceff4",
    },
  },
  "gruvbox-dark": {
    name: "Gruvbox Dark",
    dark: true,
    c: {
      bg: "#282828",
      panel: "#1d2021",
      border: "#3c3836",
      fg: "#ebdbb2",
      muted: "#928374",
      accent: "#fabd2f",
      good: "#b8bb26",
      bad: "#fb4934",
      warn: "#fe8019",
      tile: "#3c3836",
      "tile-fg": "#ebdbb2",
    },
  },
  github: {
    name: "GitHub",
    dark: false,
    c: {
      bg: "#ffffff",
      panel: "#f6f8fa",
      border: "#d0d7de",
      fg: "#1f2328",
      muted: "#656d76",
      accent: "#0969da",
      good: "#1a7f37",
      bad: "#cf222e",
      warn: "#9a6700",
      tile: "#ffffff",
      "tile-fg": "#1f2328",
    },
  },
  "tokyo-night": {
    name: "Tokyo Night",
    dark: true,
    c: {
      bg: "#1a1b26",
      panel: "#16161e",
      border: "#2a2b3d",
      fg: "#c0caf5",
      muted: "#565f89",
      accent: "#7aa2f7",
      good: "#9ece6a",
      bad: "#f7768e",
      warn: "#e0af68",
      tile: "#24283b",
      "tile-fg": "#c0caf5",
    },
  },
};

export const DEFAULT_THEME = "dracula";

export function applyTheme(key: string): void {
  const t = THEMES[key] || THEMES[DEFAULT_THEME];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.c)) {
    root.style.setProperty(`--c-${k}`, v);
  }
  root.dataset.theme = key;
  root.dataset.mode = t.dark ? "dark" : "light";
  try {
    localStorage.setItem("bawgle.theme", key);
  } catch {
    // ignore
  }
}

export function loadTheme(): string {
  let key = DEFAULT_THEME;
  try {
    key = localStorage.getItem("bawgle.theme") || DEFAULT_THEME;
  } catch {
    // ignore
  }
  if (!THEMES[key]) key = DEFAULT_THEME;
  applyTheme(key);
  return key;
}
