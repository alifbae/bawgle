import { dom } from "../dom.ts";
import { THEMES, applyTheme, loadTheme } from "../themes.ts";

export function initThemeSelect(afterChange?: () => void): void {
  const entries = Object.entries(THEMES).sort(([, a], [, b]) =>
    a.name.localeCompare(b.name)
  );
  const keys = entries.map(([k]) => k);

  let current = loadTheme();
  if (!keys.includes(current)) current = keys[0];
  setLabel(current);

  dom.themeBtn.addEventListener("click", () => {
    const idx = keys.indexOf(current);
    current = keys[(idx + 1) % keys.length];
    applyTheme(current);
    setLabel(current);
    afterChange?.();
  });
}

function setLabel(key: string): void {
  dom.themeName.textContent = THEMES[key]?.name ?? key;
}
