/**
 * fullscreen-sync — keeps the browser's own fullscreen in step with the inspector's theater. The
 * theater covers the viewport in place; entering it also asks the browser to hide its own chrome by
 * making the whole document fullscreen (never the canvas alone, so a menu, tooltip or dialog portalled
 * to the body still shows). It only ever leaves a fullscreen it entered, and when the browser leaves
 * on its own (Escape, which the page never hears) the theater closes with it. Where the browser
 * refuses, the theater stands alone. Pure: the document is injected.
 */

// #region Contract
/** The browser's fullscreen, as this module needs it (`useNativeFullscreen` binds the document's). */
export interface FullscreenHost {
	/** Whether this page may go fullscreen at all. */
	supported(): boolean;
	/** Whether anything on the page is fullscreen. */
	active(): boolean;
	request(): Promise<void>;
	exit(): Promise<void>;
	/** Subscribe to the browser entering or leaving fullscreen; returns the unsubscribe. */
	onChange(listener: () => void): () => void;
}

/** The theater's side of the sync. */
export interface FullscreenSync {
	/** The theater opened: go fullscreen too, if the browser lets us. */
	enter(): void;
	/** The theater closed: leave fullscreen, if we were the ones who entered it. */
	leave(): void;
	dispose(): void;
}
// #endregion

/**
 * Sync one theater with the browser's fullscreen. `onLeft` runs when the browser leaves a fullscreen
 * this sync entered, so the caller can close the theater.
 */
export function createFullscreenSync(host: FullscreenHost, onLeft: () => void): FullscreenSync {
	let wanted = false;
	let entered = false;
	let disposed = false;

	function exitQuietly(): void {
		host.exit().catch(() => undefined);
	}

	const unsubscribe = host.onChange(() => {
		if (disposed) return;
		if (host.active()) {
			if (wanted) entered = true;
			return;
		}
		if (!entered) return;
		entered = false;
		if (wanted) {
			wanted = false;
			onLeft();
		}
	});

	return {
		enter(): void {
			if (disposed || wanted) return;
			wanted = true;
			if (!host.supported() || host.active()) return;
			let pending: Promise<void>;
			try {
				pending = host.request();
			} catch {
				return;
			}
			pending.then(() => {
				if (!host.active()) return;
				if (wanted && !disposed) entered = true;
				else exitQuietly();
			}).catch(() => undefined);
		},
		leave(): void {
			wanted = false;
			if (!entered) return;
			entered = false;
			if (host.active()) exitQuietly();
		},
		dispose(): void {
			disposed = true;
			unsubscribe();
		},
	};
}
