import { signal } from "@preact/signals";

/**
 * copy-note — what the shell menus' last Copy link did (Decision #370), spoken by one polite live
 * region in the header tray. The menu closes on Copy, as a browser's own "Copy link address" does, so
 * this is the confirmation.
 */
export const copyNote = signal("");

/** Announce a Copy link result; the region is emptied first so a repeat copy is spoken again. */
export function noteCopied(ok: boolean): void {
	copyNote.value = "";
	setTimeout(() => (copyNote.value = ok ? "Link copied" : "Couldn't copy the link"), 50);
}
