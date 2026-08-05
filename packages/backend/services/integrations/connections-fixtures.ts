import type {
	ConnectionStatus,
	IntegrationProvider,
	ProviderSlug,
	UserConnection,
} from "@projective/types/integrations";
import { PROVIDER_LABEL } from "@projective/types/integrations";
import type { FilesSim } from "@projective/types/files";

/**
 * integrations connections fixtures — the deterministic provider catalogue and connection corpus the
 * fat {@link IntegrationsBackendService} answers from while `INTEGRATIONS_BACKEND_LIVE` is off.
 *
 * **Every {@link ConnectionStatus} is represented, because each one renders a different surface.** A
 * `degraded` connection still browses but warns; an `expired` one offers a one-click reconnect; a
 * `revoked` one needs fresh consent and must NOT offer reconnect (the grant is gone, not stale); a
 * `pending` one is a consent someone started and abandoned. The `none` case — never connected — is the
 * only one that is not a connection at all, so it is modelled as the absence of a row rather than an
 * eighth status, which is exactly what the surface has to handle.
 *
 * ⚠️ **No token, no secret, no key appears in this file or in the shape it produces.**
 * {@link UserConnection} mirrors `integrations.v_my_connections`, the definer view that physically
 * cannot project a token column. Credentials live in `integrations.connection_secrets` and are reached
 * only through `./token-vault.ts`.
 *
 * No RNG: a fixed reference clock and stable ids keep SSR and the client refetch byte-identical.
 */

// #region Reference clock

/** Fixed reference "now" (never `Date.now()`), matching every sibling fixture module. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

// #endregion

// #region Identity

/** The acting user, matching the `/files` hub's viewer. */
const VIEWER_ID = "0a7c1f30-1111-4000-8000-000000000001";

/**
 * Connection ids are real UUIDs because {@link UserConnectionSchema} validates them as such —
 * `DriveBrowseParams.connectionId` is a `uuid`, so a friendly `cn-google-drive` id would pass the
 * TypeScript type and fail the route's Zod parse. The readable alias survives as a lookup key (see
 * {@link resolveConnectionRef}) so the `/files` corpus can keep referring to a connection by name.
 */
const CONNECTION_IDS: Readonly<Record<string, string>> = {
	google_drive: "0a7c1f30-2222-4000-8000-000000000001",
	dropbox: "0a7c1f30-2222-4000-8000-000000000002",
	frameio: "0a7c1f30-2222-4000-8000-000000000003",
	s3: "0a7c1f30-2222-4000-8000-000000000004",
	google: "0a7c1f30-2222-4000-8000-000000000005",
	zoom: "0a7c1f30-2222-4000-8000-000000000006",
	notion: "0a7c1f30-2222-4000-8000-000000000007",
	github: "0a7c1f30-2222-4000-8000-000000000008",
	calendly: "0a7c1f30-2222-4000-8000-000000000009",
	microsoft_teams: "0a7c1f30-2222-4000-8000-00000000000a",
};

/** The readable aliases the `/files` fixture corpus refers to connections by. */
const CONNECTION_ALIASES: Readonly<Record<string, string>> = {
	"cn-google-drive": CONNECTION_IDS.google_drive,
	"cn-dropbox": CONNECTION_IDS.dropbox,
	"cn-frameio": CONNECTION_IDS.frameio,
	"cn-s3": CONNECTION_IDS.s3,
};

/**
 * Resolve either a connection UUID or a readable alias to the canonical id.
 *
 * Accepting both is what lets the `/files` seed stay legible (`cn-dropbox`) while the API surface stays
 * strictly UUID-typed — rather than either scattering UUIDs through a hand-written fixture or loosening
 * the schema that keeps a malformed id from reaching a query.
 */
export function resolveConnectionRef(ref: string): string {
	return CONNECTION_ALIASES[ref] ?? ref;
}

// #endregion

// #region Provider catalogue

/** One catalogue row, with the fields that never vary defaulted. */
function provider(opts: {
	slug: ProviderSlug;
	category: IntegrationProvider["category"];
	capabilities: IntegrationProvider["capabilities"];
	authScheme: IntegrationProvider["authScheme"];
	broker?: IntegrationProvider["broker"];
	supportsWebhooks?: boolean;
	isBeta?: boolean;
	defaultScopes?: string[];
	sortOrder: number;
}): IntegrationProvider {
	return {
		slug: opts.slug,
		label: PROVIDER_LABEL[opts.slug],
		category: opts.category,
		capabilities: opts.capabilities,
		authScheme: opts.authScheme,
		isEnabled: true,
		isBeta: opts.isBeta ?? false,
		broker: opts.broker ?? "direct",
		supportsWebhooks: opts.supportsWebhooks ?? false,
		// Documentation/config only — a scope string is never a credential.
		defaultScopes: opts.defaultScopes ?? [],
		docsUrl: null,
		iconUrl: null,
		sortOrder: opts.sortOrder,
		createdAt: new Date(NOW - 400 * DAY).toISOString(),
	};
}

/**
 * The seeded catalogue.
 *
 * The unit of architecture is the `(provider, capability)` pair, never the vendor: Google appears once
 * as a `calendar`/`freebusy` source and once as `google_drive` for `storage`, because a user may grant
 * one and not the other and a merged row could not express that consent.
 */
const PROVIDERS: readonly IntegrationProvider[] = [
	provider({
		slug: "google_drive",
		category: "storage",
		capabilities: ["storage"],
		authScheme: "oauth2",
		supportsWebhooks: true,
		defaultScopes: ["https://www.googleapis.com/auth/drive.readonly"],
		sortOrder: 10,
	}),
	provider({
		slug: "dropbox",
		category: "storage",
		capabilities: ["storage"],
		authScheme: "oauth2",
		supportsWebhooks: true,
		defaultScopes: ["files.metadata.read", "files.content.read"],
		sortOrder: 20,
	}),
	provider({
		slug: "frameio",
		category: "storage",
		capabilities: ["storage"],
		authScheme: "oauth2",
		supportsWebhooks: true,
		isBeta: true,
		defaultScopes: ["asset.read", "project.read"],
		sortOrder: 30,
	}),
	provider({
		slug: "s3",
		category: "storage",
		capabilities: ["storage"],
		// Not an OAuth variant: no authorization server, no redirect, no refresh. The connect flow must
		// branch on this rather than presenting a credential form as a consent screen.
		authScheme: "aws_sigv4",
		sortOrder: 40,
	}),
	provider({
		slug: "google",
		category: "calendar",
		capabilities: ["calendar", "freebusy", "conferencing"],
		authScheme: "oauth2",
		broker: "nylas",
		supportsWebhooks: true,
		defaultScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
		sortOrder: 50,
	}),
	provider({
		slug: "zoom",
		category: "conferencing",
		capabilities: ["conferencing"],
		authScheme: "oauth2",
		sortOrder: 60,
	}),
	provider({
		slug: "notion",
		category: "productivity",
		// Notion keeps its `calendar` capability from Decision #37's INTEGRATION_SOURCES and gains
		// `docs`. Whether Notion-as-a-calendar is still intended is flagged, not resolved here.
		capabilities: ["docs", "calendar"],
		authScheme: "oauth2",
		sortOrder: 70,
	}),
	provider({
		slug: "github",
		category: "developer",
		capabilities: ["code", "issues"],
		authScheme: "oauth2",
		supportsWebhooks: true,
		sortOrder: 80,
	}),
	provider({
		slug: "calendly",
		category: "calendar",
		capabilities: ["calendar", "freebusy"],
		authScheme: "oauth2",
		sortOrder: 90,
	}),
	provider({
		// A separate vendor row from `google`, and deliberately not merged with `outlook` either: the
		// scheduling FKs already point at these slugs, and consolidating Microsoft into one row would
		// break them. Flagged in Decision #59, not resolved here.
		slug: "microsoft_teams",
		category: "conferencing",
		capabilities: ["conferencing"],
		authScheme: "oauth2",
		sortOrder: 100,
	}),
];

/** The whole provider catalogue, sort-ordered. */
export function listProviders(): IntegrationProvider[] {
	return PROVIDERS.slice().sort((a, b) => a.sortOrder - b.sortOrder);
}

/** One catalogue row by slug. */
export function findProvider(slug: string): IntegrationProvider | null {
	return PROVIDERS.find((p) => p.slug === slug) ?? null;
}

// #endregion

// #region Connection corpus

/** Build one connection row. */
function connection(opts: {
	slug: ProviderSlug;
	status: ConnectionStatus;
	accountLabel: string;
	grantedKinds?: UserConnection["grantedKinds"];
	config?: UserConnection["config"];
	lastError?: string | null;
	errorCount?: number;
	tokenExpiresInHours?: number | null;
	connectedAgoDays?: number;
}): UserConnection {
	const meta = findProvider(opts.slug);
	const connectedAt = NOW - (opts.connectedAgoDays ?? 30) * DAY;
	const revoked = opts.status === "revoked" || opts.status === "disconnected";
	return {
		id: CONNECTION_IDS[opts.slug],
		userId: VIEWER_ID,
		providerSlug: opts.slug,
		providerLabel: PROVIDER_LABEL[opts.slug],
		providerCategory: meta?.category ?? "storage",
		providerCapabilities: meta?.capabilities ?? [],
		status: opts.status,
		// What this consent actually granted — may be NARROWER than the provider's capabilities, which
		// is the whole reason the two are separate arrays.
		grantedKinds: opts.grantedKinds ?? meta?.capabilities ?? [],
		grantedScopes: meta?.defaultScopes ?? [],
		// Read-only inbound is the MVP default; bidirectional carries echo-suppression + conflict cost.
		syncDirection: "inbound",
		externalAccountId: `acct-${opts.slug}`,
		externalAccountLabel: opts.accountLabel,
		tokenExpiresAt: opts.tokenExpiresInHours === null
			? null
			: new Date(NOW + (opts.tokenExpiresInHours ?? 20) * HOUR).toISOString(),
		lastSyncedAt: opts.status === "active" || opts.status === "degraded"
			? new Date(NOW - 3 * HOUR).toISOString()
			: null,
		lastError: opts.lastError ?? null,
		errorCount: opts.errorCount ?? 0,
		config: opts.config ?? null,
		connectedAt: new Date(connectedAt).toISOString(),
		revokedAt: revoked ? new Date(NOW - 2 * DAY).toISOString() : null,
		createdAt: new Date(connectedAt).toISOString(),
		updatedAt: new Date(NOW - 3 * HOUR).toISOString(),
	};
}

/**
 * The seeded connections — every {@link ConnectionStatus} represented, and every STORAGE adapter
 * reachable.
 *
 * Those two goals pull against each other, and the resolution matters: an earlier seed put `degraded`
 * on Dropbox, which meant the Dropbox adapter could never be browsed in development at all, because a
 * non-`active` connection is refused before it reaches one. So the three healthy storage connectors are
 * `active`, the recoverable state sits on Frame.io (a storage provider, which is where the reconnect
 * surface actually needs exercising), and the remaining five states live on the non-storage providers.
 */
const CONNECTIONS: readonly UserConnection[] = [
	connection({
		slug: "google_drive",
		status: "active",
		accountLabel: "you@studio.example",
		connectedAgoDays: 120,
	}),
	connection({
		slug: "dropbox",
		status: "active",
		accountLabel: "studio-shared",
		connectedAgoDays: 200,
	}),
	connection({
		slug: "s3",
		status: "active",
		accountLabel: "projective-media (eu-west-2)",
		// Everything the adapter needs to ADDRESS the bucket — and nothing that could open it.
		config: {
			endpoint: "",
			region: "eu-west-2",
			bucket: "projective-media",
			prefix: "",
			pathStyle: false,
		},
		tokenExpiresInHours: null,
		connectedAgoDays: 300,
	}),
	connection({
		slug: "frameio",
		// Recoverable: the surface offers "reconnect", not "authorise again".
		status: "expired",
		accountLabel: "Launch Film — Team",
		tokenExpiresInHours: -6,
		connectedAgoDays: 90,
	}),
	connection({
		slug: "google",
		status: "degraded",
		accountLabel: "you@studio.example",
		// The consent is NARROWER than the provider's capabilities: Google advertises `conferencing`
		// and this grant withholds it. That asymmetry is the whole reason the two arrays are separate,
		// and it is why `hasConferencing` resolves through Zoom below rather than through Google.
		grantedKinds: ["calendar", "freebusy"],
		lastError: "Token refresh failed (429). Retrying with backoff.",
		errorCount: 3,
		connectedAgoDays: 150,
	}),
	connection({
		slug: "zoom",
		status: "active",
		accountLabel: "you@studio.example",
		connectedAgoDays: 45,
	}),
	connection({
		slug: "calendly",
		// A consent someone started and abandoned — not an error, and not a connection either.
		status: "pending",
		accountLabel: "you@studio.example",
		tokenExpiresInHours: null,
		connectedAgoDays: 0,
	}),
	connection({
		slug: "notion",
		// Terminal. The user must grant fresh consent — offering "reconnect" would imply a stored grant
		// that no longer exists, and the retry would fail with nothing to explain it.
		status: "revoked",
		accountLabel: "Studio workspace",
		tokenExpiresInHours: null,
		connectedAgoDays: 240,
	}),
	connection({
		slug: "microsoft_teams",
		// The user removed it themselves — distinct from `revoked`, which the PROVIDER did.
		status: "disconnected",
		accountLabel: "studio.example",
		tokenExpiresInHours: null,
		connectedAgoDays: 400,
	}),
	connection({
		slug: "github",
		status: "error",
		accountLabel: "studio-org",
		lastError: "Provider returned 500 on the last three syncs.",
		errorCount: 3,
		connectedAgoDays: 60,
	}),
];

// #endregion

// #region Reads

/**
 * The caller's connections, with the developer {@link FilesSim} overlay applied.
 *
 * `connectionState: "none"` returns an EMPTY list rather than a row with a status, because
 * never-connected is the absence of a connection and the surface it drives is an empty state that
 * offers to connect — not a degraded card. Any other simulated state is forced onto the STORAGE
 * connections only: forcing it onto the calendar ones too would make one axis change two unrelated
 * surfaces, and a developer chasing a Drive bug would find their calendar broken as well.
 */
export function listConnections(userId: string, sim?: FilesSim): UserConnection[] {
	const mine = CONNECTIONS.filter((c) => c.userId === userId || userId === VIEWER_ID);
	if (!sim?.connectionState) return mine.slice();
	if (sim.connectionState === "none") return [];

	const forced: ConnectionStatus = sim.connectionState;
	return mine.map((c) =>
		c.providerCategory === "storage"
			? {
				...c,
				status: forced,
				revokedAt: forced === "revoked" || forced === "disconnected"
					? new Date(NOW - 2 * DAY).toISOString()
					: null,
			}
			: c
	);
}

/** One connection by id or readable alias. */
export function findConnection(ref: string, sim?: FilesSim): UserConnection | null {
	const id = resolveConnectionRef(ref);
	return listConnections(VIEWER_ID, sim).find((c) => c.id === id) ?? null;
}

/** Whether the caller holds an active grant for a capability — mirrors `integrations.fn_has_capability`. */
export function hasCapability(
	userId: string,
	kind: UserConnection["grantedKinds"][number],
	sim?: FilesSim,
): boolean {
	return listConnections(userId, sim).some(
		(c) => c.status === "active" && c.grantedKinds.includes(kind),
	);
}

/**
 * The slug that would mint a meeting room today — mirrors `integrations.fn_conferencing_provider`.
 *
 * Calendar sync and conferencing are two AXES, not one chip set: a user may sync a Google calendar and
 * host on Zoom. Resolving them separately is what keeps the booking flow from assuming the calendar
 * provider can also mint a room.
 */
export function activeConferencingProvider(userId: string, sim?: FilesSim): string | null {
	const match = listConnections(userId, sim).find(
		(c) => c.status === "active" && c.grantedKinds.includes("conferencing"),
	);
	return match?.providerSlug ?? null;
}

/** The acting user id the fixtures answer for. */
export const FIXTURE_USER_ID = VIEWER_ID;

// #endregion

// #region Writes

/** Consents started but not finished, keyed by the opaque `state` the redirect carries. */
const PENDING = new Map<string, { userId: string; slug: string; returnTo: string | null }>();
/** Per-process mutations over the seeded corpus, so connect → revoke round-trips with the gate off. */
const OVERRIDES = new Map<string, UserConnection>();

/** A stable hash → non-negative int. Unsigned `>>>` (a signed `>>` goes negative past 2^31). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/**
 * Record a started consent and return the opaque `state`.
 *
 * `state` is the CSRF binding for the whole round trip: the callback is an unauthenticated request from
 * the provider's redirect, so a callback carrying a state we never issued must be refused outright.
 * Deterministic here for reproducibility; the live path mints it from `crypto.getRandomValues` for the
 * same reason a share slug does.
 */
export function beginConsent(userId: string, slug: string, returnTo: string | null): string {
	const state = `st-${hash(`${userId}:${slug}:${PENDING.size}`).toString(36)}`;
	PENDING.set(state, { userId, slug, returnTo });
	return state;
}

/** Look up and consume a started consent. Single-use: a replayed `state` must not authorise twice. */
export function consumeConsent(
	state: string,
): { userId: string; slug: string; returnTo: string | null } | null {
	const pending = PENDING.get(state);
	if (!pending) return null;
	PENDING.delete(state);
	return pending;
}

/** Move a connection to `active` after a completed consent. */
export function activateConnection(slug: string): UserConnection | null {
	const base = CONNECTIONS.find((c) => c.providerSlug === slug);
	if (!base) return null;
	const next: UserConnection = {
		...base,
		status: "active",
		lastError: null,
		errorCount: 0,
		revokedAt: null,
		connectedAt: new Date(NOW).toISOString(),
		updatedAt: new Date(NOW).toISOString(),
	};
	OVERRIDES.set(next.id, next);
	return next;
}

/**
 * Revoke a stored authorization.
 *
 * Terminal — reconnecting requires a fresh consent, never a re-arm of the old grant. The live path also
 * deletes the `connection_secrets` row and calls the provider's own revocation endpoint: leaving a
 * token valid at the far end after the user asked us to forget it is the one failure they would never
 * find out about.
 */
export function revokeConnectionRow(ref: string): boolean {
	const id = resolveConnectionRef(ref);
	const current = OVERRIDES.get(id) ?? CONNECTIONS.find((c) => c.id === id);
	if (!current || current.status === "revoked") return false;
	OVERRIDES.set(id, {
		...current,
		status: "revoked",
		revokedAt: new Date(NOW).toISOString(),
		tokenExpiresAt: null,
		updatedAt: new Date(NOW).toISOString(),
	});
	return true;
}

/** Apply any per-process overrides over a connection list. */
export function withOverrides(rows: UserConnection[]): UserConnection[] {
	return rows.map((row) => OVERRIDES.get(row.id) ?? row);
}

// #endregion
