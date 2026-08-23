import { type DevSeamState, personaCapabilities, readDevSeam } from "@web/utils/dev-seam.ts";

/**
 * event-access — the pure, shipping-safe model that resolves what the acting viewer may DO with a
 * calendar event, layering the (DEV-only) Context Switcher override on the SSR-resolved baseline.
 *
 * It answers only "which side of the market is this person on", which is what the Finances tab and
 * the footer's perspective-based money readout are gated on. **Where the viewer sits on a specific
 * EVENT is a different question and is not answered here**: that is `viewerIsHost` and the roster row
 * the server marked `isViewer`, both server-derived, because a host-only affordance must not be
 * decided from a handle comparison the client could get wrong on a team-owned engagement.
 *
 * The persona → capability mapping is NOT re-derived: it delegates to {@link personaCapabilities},
 * the one place that owns it (`@web/utils/dev-seam.ts`), so the calendar and the projects board
 * cannot come to two different answers about the same simulated persona.
 *
 * Production safety: the override is read exclusively through the `IS_DEV`-gated seam, so in
 * production it is always `null` and every value degrades to the server's own. Reading it grants no
 * access — RLS remains the real gate; it only changes what the developer's browser draws.
 */

// #region Access shape
/** Which side of the market the acting viewer is on, for one calendar surface. */
export interface EventAccess {
	/** A provider-side seat: sells the session, and is the one an earnings figure belongs to. */
	isFreelancer: boolean;
	/** A buyer-side seat: books and pays, and is the one a cost figure belongs to. */
	isClient: boolean;
}
// #endregion

// #region Resolution
/**
 * Resolve the surface's access set from the SSR baseline plus the active override.
 *
 * With no override the server's `viewerIsClient` settles it — a calendar payload carries no finer
 * signal, and inventing one client-side would be a guess dressed as a fact. With an override the
 * simulated persona decides, through the shared capability table (a team is both, a business is a
 * buyer only).
 */
export function resolveEventAccess(
	baseline: { viewerIsClient: boolean },
	seam: DevSeamState | null,
): EventAccess {
	if (!seam) {
		return { isClient: baseline.viewerIsClient, isFreelancer: !baseline.viewerIsClient };
	}
	const caps = personaCapabilities(seam.persona);
	return { isClient: caps.isClient, isFreelancer: caps.isFreelancer };
}

export { readDevSeam };
export type { DevSeamState };
// #endregion
