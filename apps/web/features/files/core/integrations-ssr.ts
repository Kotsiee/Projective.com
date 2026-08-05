import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";
import type { ConnectionsView } from "@projective/types/integrations";
import type { FilesSim } from "../types/file-types.ts";

/**
 * integrations-ssr — the server-only bootstrap for the Settings → Integrations console's first paint.
 *
 * The counterpart of `files-ssr.ts` for the connector subsystem: it calls the fat
 * {@link IntegrationsBackendService} DIRECTLY (no HTTP hop), so the console ships resolved in the
 * initial byte and the island refines through the thin `IntegrationsService`. **Never imported by an
 * island** — that import edge is what keeps the credential-touching half out of the client bundle.
 *
 * It lives beside the files feature rather than in one of its own because the connector subsystem has
 * no client feature of its own: `IntegrationsService`, the drive-browsing picker and this console all
 * live under `features/files/`, and a second feature folder holding one resolver would be a directory
 * rather than a boundary.
 *
 * Like every sibling resolver it degrades to a coherent EMPTY projection rather than throwing. A
 * settings page that 500s because the provider catalogue was briefly unavailable is a worse failure
 * than one that renders "nothing connected" and lets the island's own read correct it — and the empty
 * value below is a real, complete {@link ConnectionsView}, so nothing downstream has to null-check its
 * way through a partial payload.
 *
 * **A degraded read must never read as a positive capability claim.** `hasCalendar` /
 * `hasConferencing` / `activeConferencingProvider` all fall to their negative values, because a
 * surface that believes it can mint a meeting room and cannot is worse than one that offers to
 * connect a provider the user already has.
 */

// #region Connections
/** The console's payload when nothing could be resolved — complete, and negative on every capability. */
const EMPTY_CONNECTIONS: Readonly<ConnectionsView> = Object.freeze({
	providers: [],
	connections: [],
	hasCalendar: false,
	hasConferencing: false,
	activeConferencingProvider: null,
});

/**
 * Resolve the Settings → Integrations payload for a user.
 *
 * `userId` comes from the caller's hydrated session context and is never accepted from the request:
 * a connection is a stored authorization to act at a third party on someone's behalf, so a
 * request-supplied user would let a caller enumerate whose accounts are linked. An empty id resolves
 * to no connections rather than to somebody else's.
 */
export async function resolveConnections(
	userId: string,
	sim?: FilesSim,
): Promise<ConnectionsView> {
	const res = await IntegrationsBackendService.connections({ userId, sim });
	return res.ok && res.data ? res.data : { ...EMPTY_CONNECTIONS };
}
// #endregion
