/// <reference lib="dom" />
/**
 * three-loader — the one place three.js is fetched. The engine touches WebGL and is heavy, so it
 * lives behind a dynamic import of {@link ./three-runtime.ts | `three-runtime`} that only ever runs
 * in a browser. The promise is memoised and cleared on failure, so a transient network error can be
 * retried by the next mount instead of poisoning the page.
 */

/** three.js and the addons the model canvas uses, as one namespace object. */
export type ThreeRuntime = typeof import("./three-runtime.ts")["default"];

let pending: Promise<ThreeRuntime> | null = null;
let resolved: ThreeRuntime | null = null;

/** Fetch (or re-use) the three.js runtime. */
export function loadThree(): Promise<ThreeRuntime> {
	pending ??= import("./three-runtime.ts")
		.then((mod) => {
			resolved = mod.default;
			return resolved;
		})
		.catch((error: unknown) => {
			pending = null;
			throw error;
		});
	return pending;
}

/** The runtime if it is already here, otherwise `null` — never a fetch. */
export function loadedThree(): ThreeRuntime | null {
	return resolved;
}

/**
 * Start the fetch without waiting for it; a no-op on the server. The rejection is dropped on
 * purpose: the mount effect awaits {@link loadThree} for real and reports the failure there.
 */
export function warmThree(): void {
	if (typeof document === "undefined" || resolved) return;
	loadThree().catch(() => undefined);
}
