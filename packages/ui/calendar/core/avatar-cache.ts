/// <reference lib="dom" />
/**
 * @projective/ui/calendar — the avatar stack's PHOTO half.
 *
 * The always-correct half of a face is its initials — synchronous, pure, drawn straight from the
 * scene (`core/scene-build.ts` `initialsOf`). A photo is a progressive enhancement on top of that,
 * and it is fundamentally NOT synchronous: `new Image()` loads on its own clock, which is a real
 * problem for a paint routine whose header rule is "no frame is ever required" — an `<img>` mid-load
 * is not a value {@link paintCard} can be handed as an argument and stay pure.
 *
 * The resolution: a MODULE-LEVEL cache (one `HTMLImageElement` per URL, shared across every card and
 * every mounted calendar on the page — the same photo drawn on three cards loads once) that the paint
 * pass reads SYNCHRONOUSLY and never blocks on. {@link resolveAvatar} returns the image the instant
 * it is decodable and `null` on every other call — not loaded yet, failed, or no URL at all — so the
 * caller (`scene-paint.ts`) always has a same-frame answer and falls back to initials with no special
 * casing. Loading is kicked off as a side effect of asking, and {@link watchAvatarLoads} is the other
 * half: a view wires it once to its own `redraw()`, exactly as `useGridCanvas` already re-fires a draw
 * when the theme or the device pixel ratio moves — a photo that finishes loading is just one more
 * reason the same frame needs to be painted again.
 */

type Entry = { image: HTMLImageElement } | "loading" | "error";

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();

function notify(): void {
	for (const l of listeners) l();
}

/**
 * The decoded image for `url`, or `null` while it is unavailable (never requested, still loading, or
 * failed) — in which case the caller draws initials instead. Calling this is what STARTS the load;
 * every subsequent call for the same URL is a synchronous cache read.
 */
export function resolveAvatar(url: string | undefined): HTMLImageElement | null {
	if (!url || typeof Image === "undefined") return null;
	const entry = cache.get(url);
	if (entry && entry !== "loading" && entry !== "error") return entry.image;
	if (entry) return null; // "loading" or "error" — already in flight or already given up
	cache.set(url, "loading");
	const img = new Image();
	img.decoding = "async";
	img.onload = () => {
		cache.set(url, { image: img });
		notify();
	};
	img.onerror = () => {
		cache.set(url, "error");
		notify();
	};
	img.src = url;
	return null;
}

/**
 * Subscribe to "a previously-unavailable avatar just became drawable". Returns an unsubscribe.
 *
 * Fires for EVERY resolution anywhere on the page (module-level, by design — see the header note), so
 * a view that does not currently have that URL on screen repaints once for nothing; that is far
 * cheaper than a photo silently never appearing because its `<img>` finished loading half a second
 * after the one frame that would have drawn it.
 */
export function watchAvatarLoads(onReady: () => void): () => void {
	listeners.add(onReady);
	return () => listeners.delete(onReady);
}
