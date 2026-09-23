import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";
import type { ConnectionsView } from "@projective/types/integrations";
import type { ReadActor } from "@server/services/read-actor.ts";

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
 * A read that FAILED is reported as a failure (`error`) beside a complete, empty projection — never
 * as "nothing connected" alone, which would be a false claim about the person's accounts. The empty
 * value is still a real {@link ConnectionsView}, so nothing downstream null-checks a partial payload.
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

/** The console's first paint: the payload, or why it could not be read. */
export interface ConnectionsRead {
	view: ConnectionsView;
	error: string | null;
}

/**
 * Resolve the Settings → Integrations payload for the signed-in person. The actor comes from the
 * session and never from the request: a connection is a stored authorization to act at a third party
 * on someone's behalf, so a request-supplied user would let a caller enumerate whose accounts are
 * linked.
 */
export async function resolveConnections(actor: ReadActor): Promise<ConnectionsRead> {
	const res = await IntegrationsBackendService.connections(actor);
	return res.ok && res.data
		? { view: res.data, error: null }
		: { view: { ...EMPTY_CONNECTIONS }, error: res.message ?? "Your connections couldn't be loaded just now." };
}
// #endregion
