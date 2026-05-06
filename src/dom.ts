// Central DOM element references. Keeps `getElementById` out of feature code.
//
// Each lookup asserts the element exists — if the HTML is missing one, we'd
// rather fail fast at startup than hand back `null` to feature code.

function el<T extends Element = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id} in DOM`);
  return found as unknown as T;
}

function optionalEl<T extends Element = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as unknown as T | null;
}

export const dom = {
  // Phases
  lobby: el<HTMLElement>("lobby"),
  room: el<HTMLElement>("room"),
  results: el<HTMLElement>("results"),
  resultsBody: el<HTMLElement>("results-body"),

  // Players / board / word bar
  players: el<HTMLElement>("players"),
  board: el<HTMLElement>("board"),
  boardTrail: el<SVGElement>("board-trail"),
  currentWord: el<HTMLElement>("current-word"),
  undoBtn: el<HTMLButtonElement>("undo-btn"),
  wordInput: el<HTMLInputElement>("word-input"),
  feedback: el<HTMLElement>("feedback"),
  myWords: el<HTMLElement>("my-words"),
  myCount: optionalEl<HTMLElement>("my-count"),
  startBtn: el<HTMLButtonElement>("start-btn"),
  readyBtn: el<HTMLButtonElement>("ready-btn"),
  submitBtn: el<HTMLButtonElement>("submit-btn"),
  nameInput: el<HTMLInputElement>("name-input"),
  timer: el<HTMLElement>("timer"),
  playAgainBtn: el<HTMLButtonElement>("play-again-btn"),

  // Theme
  themeBtn: el<HTMLButtonElement>("theme-btn"),
  themeName: el<HTMLElement>("theme-name"),

  // Lobby
  tabs: document.querySelectorAll<HTMLButtonElement>(".tab"),
  tabPanels: document.querySelectorAll<HTMLElement>(".tab-panel"),
  hostCodeInput: el<HTMLInputElement>("host-code"),
  rerollBtn: el<HTMLButtonElement>("reroll-code"),
  copyCodeBtn: el<HTMLButtonElement>("copy-code"),
  hostBtn: el<HTMLButtonElement>("host-btn"),
  joinCodeInput: el<HTMLInputElement>("join-code"),
  joinBtn: el<HTMLButtonElement>("join-btn"),

  // Room header
  roomHeader: el<HTMLElement>("room-header"),
  roomCodeDisplay: el<HTMLElement>("room-code-display"),
  copyLinkBtn: el<HTMLButtonElement>("copy-link-btn"),

  // Possible / your words info rows
  possibleWords: el<HTMLElement>("possible-words"),
  pwCount: el<HTMLElement>("pw-count"),
  yourWordsRow: el<HTMLElement>("your-words-row"),

  // Center slot + word bar containers
  centerSlot: el<HTMLElement>("center-slot"),
  waitingHost: el<HTMLElement>("waiting-host"),
  startSlot: el<HTMLElement>("start-slot"),
  wordBar: el<HTMLElement>("word-bar"),

  // Host-only settings
  settingsPanel: el<HTMLElement>("settings-panel"),
  sizeSelect: el<HTMLElement>("size-select"),
  roundSlider: el<HTMLInputElement>("round-slider"),
  roundValue: el<HTMLElement>("round-value"),

  // Tutorial shown in lobby
  tutorial: el<HTMLElement>("tutorial"),
  boardWrap: document.querySelector(".board-wrap") as HTMLElement,
} as const;

export type Dom = typeof dom;
