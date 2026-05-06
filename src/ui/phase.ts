import { dom } from "../dom.ts";

export type ViewPhase = "lobby" | "room-idle" | "playing" | "results";
export type FeedbackKind = "ok" | "bad" | "";

export function setPhase(phase: ViewPhase): void {
  dom.lobby.classList.toggle("hidden", phase !== "lobby");
  dom.room.classList.toggle("hidden", phase !== "playing" && phase !== "room-idle");
  dom.results.classList.toggle("hidden", phase !== "results");
}

let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

export function flashFeedback(text: string, kind: FeedbackKind = ""): void {
  dom.feedback.textContent = text;
  dom.feedback.className = "feedback " + (kind || "");
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    dom.feedback.textContent = "";
    dom.feedback.className = "feedback";
  }, 1600);
}
