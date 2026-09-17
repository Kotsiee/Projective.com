import { useEffect } from "preact/hooks";
import { watchProgressiveImages } from "@projective/ui/display/image";

/**
 * ImageFallbackBridge — the one always-mounted island that runs the progressive-image pipeline.
 *
 * It renders **nothing**. On mount it starts `@projective/ui/display`'s image watcher, which settles
 * every `ProgressiveImage` frame on the page — picture, else BlurHash, else neutral fallback — from
 * the elements' own load state and two document-level listeners, and keeps doing so for frames an
 * island renders or re-sources later. See `packages/ui/display/core/progressive-image.ts` for why
 * this is ONE island per page rather than one per image, and why it never touches a `src`.
 *
 * Mounted in `_app.tsx`, beside `CurrencyBridge`, so it reaches every surface — public and authed
 * alike. A guest browsing Explore has eighty card thumbnails and a handful of dead ones; a bridge
 * that only existed inside the authed shell would leave exactly those showing the broken glyph.
 *
 * Imported through the `./display/image` sub-path, not the `display` barrel, for the same reason the
 * currency bridge uses `./display/money`: this ships to every route's bundle, and the barrel would
 * drag Table, Tree and Galleria along to attach two listeners.
 */
export default function ImageFallbackBridge(): null {
	useEffect(() => watchProgressiveImages(), []);
	return null;
}
