// Sharing helpers: invite link copy (lobby header) + round results
// share (results screen). Both fall through the same ladder:
// Web Share API → clipboard → window.prompt.

import { flashFeedback } from "./stores/feedback.ts";
import { buildShareText } from "../ui/share-text.ts";
import type { RoomState } from "../../shared/types.ts";

export async function copyInviteLink(): Promise<boolean> {
  const link = location.href;
  const canShare =
    typeof navigator.share === "function" &&
    (!("canShare" in navigator) ||
      (navigator as Navigator).canShare?.({ url: link }));

  if (canShare) {
    try {
      await navigator.share({ url: link });
      return true;
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return false;
    }
  }

  try {
    await navigator.clipboard.writeText(link);
    flashFeedback("invite link copied", "ok");
    return true;
  } catch {
    window.prompt("Copy invite link:", link);
    return false;
  }
}

export async function shareRound(state: RoomState | null): Promise<void> {
  const roundId = state?.lastRoundId;
  if (!state || !roundId) {
    flashFeedback("no round to share yet", "bad");
    return;
  }
  const url = new URL(location.href);
  url.pathname = url.pathname.replace(/\/[^/]*$/, "/") + "result";
  url.search = `?round=${roundId}`;
  const shareUrl = url.toString();
  const shareText = buildShareText(state, shareUrl);

  if (navigator.share) {
    try {
      await navigator.share({ text: shareText });
      flashFeedback("shared", "ok");
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareText);
      flashFeedback("results copied — paste into WhatsApp", "ok");
      return;
    } catch {
      /* fall through */
    }
  }
  window.prompt("Copy the share text:", shareText);
}
