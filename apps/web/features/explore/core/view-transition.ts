/** Whether either reduced-motion channel is on: the OS query or the in-app `data-motion` switch. */
export function motionReduced(): boolean {
	if (typeof document === "undefined") return true;
	if (document.documentElement.dataset.motion === "reduced") return true;
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Runs a synchronous DOM update inside a same-document View Transition where the engine supports it
 * and motion is allowed; otherwise runs it directly.
 */
export function withViewTransition(update: () => void): void {
	if (motionReduced() || typeof document.startViewTransition !== "function") {
		update();
		return;
	}
	document.startViewTransition(update);
}
