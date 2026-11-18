import { AsyncLocalStorage } from "node:async_hooks";
import { setAmbientScreenShareResolver } from "@projective/ui/utils/screen-share";

/**
 * screen-share-scope — the request's screen sharing state carried across the whole render, for a
 * server component inside an island subtree, where `_app.tsx`'s `ScreenShareContext` provider does
 * not reach (the `currency-context.ts` measurement). Server-only: never import it from an island.
 */

const screenShareScope = new AsyncLocalStorage<boolean>();

/** Run `fn` with `active` as the ambient screen sharing state for the whole async subtree. */
export function runWithScreenShare<T>(active: boolean, fn: () => T): T {
	return screenShareScope.run(active, fn);
}

setAmbientScreenShareResolver(() => {
	const active = screenShareScope.getStore();
	return active === undefined ? null : { active };
});
