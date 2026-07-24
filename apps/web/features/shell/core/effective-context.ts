import { type ReadonlySignal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { ContextRole, ContextType, UserContext } from "@projective/types/auth";
import {
	type DevSeamState,
	personaCapabilities,
	readDevSeam,
	subscribeDevSeam,
} from "@web/utils/dev-seam.ts";

/**
 * effective-context — the shipping-safe bridge that lets the authenticated shell chrome (the global
 * sidebar + the header account popover) react to the DEV-ONLY **Context Switcher** live, without
 * importing the build-excluded `features/devtools/*` code.
 *
 * The SSR {@link UserContext} paints the correct rail/popover in the first byte; but when a developer
 * flips the simulated persona (`data-dev-persona` + the `pj:devcontext` event) the chrome must re-gate
 * with no reload — the same way the `/projects` lane, the messaging inbox, and the session sidebar
 * already consume the seam (`@web/utils/dev-seam.ts`). This module folds the seam's persona into the
 * base context using the **single-sourced** {@link personaCapabilities} map, so the shell agrees with
 * every other seam consumer (notably: a business is buyer-only).
 *
 * Production-safe: {@link readDevSeam}/{@link subscribeDevSeam} degrade to "no override" (the whole
 * dev seam tree-shakes out), so {@link useEffectiveContext} always resolves to the base context there.
 */

/** The live-resolved context + whether a dev override is currently shaping it. */
export interface EffectiveContext {
	/** The context to gate chrome on — the SSR base, or the persona-overridden context in dev. */
	context: UserContext;
	/** `true` while a Context-Switcher override is active (so the popover can prefer it over live data). */
	overridden: boolean;
}

/**
 * Fold a dev-seam persona override into the base {@link UserContext}. A pass-through when `seam` is
 * `null` (no override / production / SSR). Mirrors the devtools `applyDevContext` deriver but with
 * ONLY shipping-safe imports, so the two stay in lockstep via the shared {@link personaCapabilities}.
 */
export function deriveEffectiveContext(base: UserContext, seam: DevSeamState | null): UserContext {
	if (!seam) return base;
	const contextType: ContextType = seam.persona === "team"
		? "team"
		: seam.persona === "business"
		? "business"
		: "personal";
	const role: ContextRole = seam.role === "admin" || seam.role === "manager"
		? "admin"
		: seam.role === "guest"
		? "guest"
		: "member";
	const { isClient, isFreelancer } = personaCapabilities(seam.persona);
	return { ...base, contextType, role, isClient, isFreelancer };
}

/**
 * A reactive {@link EffectiveContext} for an island: seeded from the SSR `base` (so hydration matches
 * the server byte-for-byte), then re-derived on mount and on every {@link subscribeDevSeam} change.
 * In production the seam is inert, so the signal stays `{ context: base, overridden: false }` forever.
 */
export function useEffectiveContext(base: UserContext): ReadonlySignal<EffectiveContext> {
	const sig = useSignal<EffectiveContext>({ context: base, overridden: false });
	useEffect(() => {
		const apply = (seam: DevSeamState | null): void => {
			sig.value = { context: deriveEffectiveContext(base, seam), overridden: seam !== null };
		};
		apply(readDevSeam());
		return subscribeDevSeam(apply);
		// `base` is a stable SSR prop; re-subscribing on identity churn is unnecessary.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return sig;
}
