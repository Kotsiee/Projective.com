import { decodeBlurHash } from "./blurhash.ts";

/**
 * progressive-image — the client half of {@link ProgressiveImage}: the code that decides which of
 * the frame's three states a picture is in, and paints the BlurHash preview while it waits.
 *
 * ## One sweep for the whole document, not one island per image
 *
 * A card thumbnail is a server component. Giving every image a hydration root just to attach an
 * `onError` would put eighty islands on a discovery page to do one attribute write each. Instead a
 * single always-mounted island calls {@link watchProgressiveImages} once, and this module handles
 * every frame on the page — the ones in the first byte, the ones an island renders later, and the
 * ones whose `src` an island swaps — from one place:
 *
 *  - `load` and `error` do not BUBBLE from an `<img>`, but they do CAPTURE, so two listeners on
 *    `document` see every image's outcome, including images that do not exist yet. No per-node
 *    listener, nothing to detach, and a re-sourced image reports again for free.
 *  - The race that a listener attached at hydration cannot see — an image that finished, or failed,
 *    BEFORE the script ran — is settled by reading the element instead: `complete` with a positive
 *    `naturalWidth` is loaded, `complete` without one is broken. Nothing is ever re-requested to find
 *    out, which is also what makes a reload loop impossible: the only thing this module writes is an
 *    attribute, never a `src`.
 *  - One `MutationObserver` catches frames an island inserts later and a `src` an island rewrites,
 *    so both re-enter the same settle path.
 *
 * ## Preact ownership
 *
 * Frames rendered inside islands are Preact-owned DOM. Everything written here — `data-state`,
 * `data-hash`, the `--pimg-hash` custom property, `role`/`aria-label` on failure — is a property the
 * component never renders, so a re-render diffs old props against new props, finds neither, and
 * leaves the DOM alone. (The `style` attribute IS rendered, for `--pimg-color`; Preact's style diff
 * compares its own two objects key by key and never removes a key it did not set.)
 *
 * ## Motion
 *
 * A frame that was still loading when first observed fades its image in; one that was already
 * complete does not, so a cached image on a repeat navigation never flashes. The fade is a CSS
 * transition on `opacity` and nothing here depends on it having played.
 */

// #region Contract
/** The marker every frame carries. Selecting on it is how the sweep finds its subjects. */
export const PIMG_ATTR = "data-pimg";

/**
 * The frame's state, written to `data-state`.
 *
 *  - absent — the first byte: the ground is painted, the image is on top and paints when it can.
 *  - `loading` — observed before it finished; the image is held invisible and fades in on `load`.
 *  - `loaded` — the image is on screen.
 *  - `error` — the image failed; the ground stays (the hash if one was painted) and, when no hash
 *    is available, the fallback slot shows.
 */
export type ProgressiveImageState = "loading" | "loaded" | "error";

/** Decode size for the preview. The CSS stretches it with `background-size: cover`. */
const HASH_PX = 32;
// #endregion

// #region Painting the hash
let scratch: HTMLCanvasElement | null = null;

/** Decode `hash` and hand back a data URL, or `null` when it cannot be read or drawn. */
function hashToDataUrl(hash: string): string | null {
	const pixels = decodeBlurHash(hash, HASH_PX, HASH_PX);
	if (!pixels) return null;
	try {
		scratch ??= document.createElement("canvas");
		scratch.width = HASH_PX;
		scratch.height = HASH_PX;
		const ctx = scratch.getContext("2d");
		if (!ctx) return null;
		ctx.putImageData(new ImageData(pixels, HASH_PX, HASH_PX), 0, 0);
		return scratch.toDataURL("image/png");
	} catch {
		// A canvas can be refused (storage-partitioned iframes, memory pressure); the colour ground
		// beneath is still there, so the failure costs the blur and nothing else.
		return null;
	}
}

/** Paint the frame's hash once. Idempotent: a frame that already carries `data-hash` is skipped. */
function paintHash(frame: HTMLElement): void {
	if (frame.hasAttribute("data-hash")) return;
	const hash = frame.getAttribute("data-blurhash");
	if (!hash) return;
	const url = hashToDataUrl(hash);
	if (!url) {
		// Unreadable: drop the attribute so the CSS treats the frame as hash-less from here on.
		frame.removeAttribute("data-blurhash");
		return;
	}
	frame.style.setProperty("--pimg-hash", `url("${url}")`);
	frame.setAttribute("data-hash", "on");
}
// #endregion

// #region Settling a frame
function imageOf(frame: HTMLElement): HTMLImageElement | null {
	return frame.querySelector<HTMLImageElement>(":scope > img");
}

function markError(frame: HTMLElement, img: HTMLImageElement | null): void {
	// A hash outranks the neutral fallback even on failure: a blurred impression of the picture says
	// more than a glyph. The CSS shows the glyph only on an `error` frame with no `data-hash`.
	paintHash(frame);
	frame.setAttribute("data-state", "error");
	// The image's alt is about to leave the accessibility tree with the image; carry it on the frame.
	const alt = img?.alt?.trim();
	if (alt) {
		frame.setAttribute("role", "img");
		frame.setAttribute("aria-label", alt);
	}
}

function markLoaded(frame: HTMLElement): void {
	frame.setAttribute("data-state", "loaded");
	frame.removeAttribute("role");
	frame.removeAttribute("aria-label");
}

/**
 * Decide a frame's state from what the browser already knows, and paint its hash if it still
 * needs one. Safe to call repeatedly — every branch is idempotent.
 */
export function settleProgressiveImage(frame: HTMLElement): void {
	const img = imageOf(frame);
	const src = img?.getAttribute("src")?.trim() ?? "";
	if (!img || !src) {
		markError(frame, img);
		return;
	}
	if (img.complete) {
		if (img.naturalWidth > 0) markLoaded(frame);
		else markError(frame, img);
		return;
	}
	// Still travelling. Hold the image invisible over the ground and let the document-level
	// listeners finish the job; the state is only set if it is not already, so a `src` swap on a
	// loaded frame returns it to loading cleanly without touching an already-loading one.
	paintHash(frame);
	if (frame.getAttribute("data-state") !== "loading") {
		frame.setAttribute("data-state", "loading");
	}
}

/** Settle every frame under `root`, including `root` itself when it is a frame. */
export function settleProgressiveImages(root: ParentNode): void {
	if (root instanceof HTMLElement && root.hasAttribute(PIMG_ATTR)) {
		settleProgressiveImage(root);
	}
	for (const frame of root.querySelectorAll<HTMLElement>(`[${PIMG_ATTR}]`)) {
		settleProgressiveImage(frame);
	}
}
// #endregion

// #region The watcher
/**
 * Start watching the document: settle every frame now, then keep settling the ones that arrive,
 * report, or change. Returns a disposer. Call once per page, from an always-mounted island.
 */
export function watchProgressiveImages(root: Document = document): () => void {
	const onOutcome = (event: Event) => {
		const target = event.target;
		if (!(target instanceof HTMLImageElement)) return;
		const frame = target.parentElement;
		if (!frame || !frame.hasAttribute(PIMG_ATTR)) return;
		if (event.type === "load" && target.naturalWidth > 0) markLoaded(frame);
		else markError(frame, target);
	};
	root.addEventListener("load", onOutcome, true);
	root.addEventListener("error", onOutcome, true);

	const observer = new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "attributes") {
				const target = record.target;
				if (record.attributeName === "data-blurhash") {
					// A new hash describes a new picture: drop the painted preview so the next settle
					// paints this one. (An island re-rendering with a new src updates the frame's
					// props before the image's, so this runs first and the src branch finds it ready.)
					if (target instanceof HTMLElement && target.hasAttribute(PIMG_ATTR)) {
						target.removeAttribute("data-hash");
						target.style.removeProperty("--pimg-hash");
						settleProgressiveImage(target);
					}
					continue;
				}
				if (target instanceof HTMLImageElement && target.parentElement?.hasAttribute(PIMG_ATTR)) {
					// A new source is a new outcome: clear the terminal state so the ground shows
					// again until the browser reports.
					target.parentElement.removeAttribute("data-state");
					settleProgressiveImage(target.parentElement);
				}
				continue;
			}
			for (const node of record.addedNodes) {
				if (node instanceof HTMLElement) settleProgressiveImages(node);
			}
		}
	});
	observer.observe(root.body ?? root, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["src", "data-blurhash"],
	});

	settleProgressiveImages(root);

	return () => {
		root.removeEventListener("load", onOutcome, true);
		root.removeEventListener("error", onOutcome, true);
		observer.disconnect();
	};
}
// #endregion
