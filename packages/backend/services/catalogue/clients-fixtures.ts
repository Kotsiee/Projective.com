import type {
	ActionReason,
	ClientDetail,
	ClientEngagementRow,
	ClientIdentity,
	ClientPipeline,
	ClientReschedule,
	EngagementKind,
} from "@projective/types/catalogue";
import { fixtureScopedListings } from "./analytics-fixtures.ts";
import { buildPipeline, summarise, toEngagements } from "./client-pipeline.ts";
import { type ClientScope, filterByScope, type ScopedListing } from "./listing-scope.ts";

/**
 * clients-fixtures — the Clients reads with `CATALOGUE_BACKEND_LIVE=false`.
 *
 * Synthetic `catalogue.get_client_pipeline` rows over the fixture catalogue, one deterministic set per
 * state of the `clientPipeline` dev axis, mapped through the SAME `client-pipeline` functions as the
 * live rows — so lanes and severity order are exercised, never hand-written.
 */

// #region Simulation
/**
 * The states the Dev Context Switcher's `clientPipeline` axis selects. Declared here rather than
 * imported from `apps/web/utils/dev-seam.ts` (root CLAUDE.md §2). `auto` reads as `busy`.
 */
export type ClientPipelineSim = "auto" | "empty" | "action_required" | "busy";

/** Whether a raw `?sim=` value is one of them. */
export function isClientPipelineSim(raw: string): raw is ClientPipelineSim {
	return raw === "auto" || raw === "empty" || raw === "action_required" || raw === "busy";
}
// #endregion

// #region Cast
const BUYERS: readonly ClientIdentity[] = [
	{ handle: "@ada_lin", name: "Ada Lin", avatar: "" },
	{ handle: "@kofi_mensah", name: "Kofi Mensah", avatar: "" },
	{ handle: "@noor_haddad", name: "Noor Haddad", avatar: "" },
	{ handle: "@jun_park", name: "Jun Park", avatar: "" },
	{ handle: "@elena_ruiz", name: "Elena Ruiz", avatar: "" },
	{ handle: "@tomas_berg", name: "Tomas Berg", avatar: "" },
	{ handle: "@priya_shah", name: "Priya Shah", avatar: "" },
	{ handle: "@sam_okoro", name: "Sam Okoro", avatar: "" },
];

/** The fixture buyers by handle. */
export const FIXTURE_BUYERS: ReadonlyMap<string, ClientIdentity> = new Map(
	BUYERS.map((b) => [b.handle, b]),
);

interface Seed {
	buyer: number;
	kind: EngagementKind;
	status: string;
	/** Index into the fixture listings: 0 pipeline, 3 session, 4 group session, 5 product. */
	listing: number;
	hoursAgo: number;
	reasons?: ActionReason[];
	amountMinor?: number;
	eventInHours?: number;
}

const ACTION_REQUIRED: readonly Seed[] = [
	{
		buyer: 0,
		kind: "session_booking",
		status: "active",
		listing: 4,
		hoursAgo: 30,
		reasons: ["dispute_open"],
		amountMinor: 24_000,
		eventInHours: 50,
	},
	{
		buyer: 1,
		kind: "pipeline_project",
		status: "active",
		listing: 0,
		hoursAgo: 2,
		reasons: ["revision_requested", "submission_pending"],
		amountMinor: 450_000,
	},
	{
		buyer: 2,
		kind: "discovery_call",
		status: "confirmed",
		listing: 3,
		hoursAgo: 5,
		reasons: ["reschedule_open"],
		eventInHours: 26,
	},
	{
		buyer: 3,
		kind: "inquiry",
		status: "primary",
		listing: 0,
		hoursAgo: 1,
		reasons: ["inquiry_unanswered"],
	},
];

const BUSY: readonly Seed[] = [
	...ACTION_REQUIRED,
	{ buyer: 0, kind: "order", status: "confirmed", listing: 5, hoursAgo: 400, amountMinor: 4_900 },
	{
		buyer: 4,
		kind: "quote",
		status: "sent",
		listing: 0,
		hoursAgo: 12,
		reasons: ["inquiry_unanswered"],
		amountMinor: 300_000,
	},
	{ buyer: 4, kind: "inquiry", status: "primary", listing: 0, hoursAgo: 14 },
	{
		buyer: 5,
		kind: "session_booking",
		status: "active",
		listing: 3,
		hoursAgo: 20,
		amountMinor: 9_000,
		eventInHours: 72,
	},
	{ buyer: 5, kind: "order", status: "confirmed", listing: 3, hoursAgo: 21, amountMinor: 9_000 },
	{ buyer: 6, kind: "quote", status: "answered", listing: 0, hoursAgo: 60, amountMinor: 200_000 },
	{ buyer: 7, kind: "order", status: "refunded", listing: 5, hoursAgo: 900, amountMinor: 4_900 },
	{ buyer: 7, kind: "discovery_call", status: "completed", listing: 3, hoursAgo: 1_100 },
];

const SEEDS: Readonly<Record<Exclude<ClientPipelineSim, "auto">, readonly Seed[]>> = {
	empty: [],
	action_required: ACTION_REQUIRED,
	busy: BUSY,
};

const HOUR = 3_600_000;

function uuidOf(n: number, prefix: string): string {
	return `00000000-0000-4000-8000-${prefix}${String(n).padStart(12 - prefix.length, "0")}`;
}

function rowOf(
	seed: Seed,
	index: number,
	listings: readonly ScopedListing[],
	now: number,
): ClientEngagementRow | null {
	const listing = listings[seed.listing];
	if (!listing) return null;
	const buyer = BUYERS[seed.buyer];
	const at = new Date(now - seed.hoursAgo * HOUR).toISOString();
	const eventId = seed.eventInHours === undefined ? null : uuidOf(index, "e");
	const engagementId = uuidOf(index, "c");
	const href = seed.kind === "inquiry"
		? `/messages/${engagementId}`
		: eventId
		? `/calendar?event=${eventId}`
		: seed.kind === "pipeline_project"
		? "/projects/prj-fixture01"
		: `/messages/dm-${buyer.handle.slice(1)}`;
	return {
		engagement_kind: seed.kind,
		engagement_id: engagementId,
		listing_id: listing.id,
		buyer_user_id: uuidOf(seed.buyer, "b"),
		buyer_handle: buyer.handle.slice(1),
		status: seed.status,
		opened_at: new Date(now - (seed.hoursAgo + 48) * HOUR).toISOString(),
		last_activity_at: at,
		amount_minor: seed.amountMinor ?? null,
		currency: seed.amountMinor === undefined ? null : listing.currency,
		next_event_at: seed.eventInHours === undefined
			? null
			: new Date(now + seed.eventInHours * HOUR).toISOString(),
		action_reasons: seed.reasons ?? [],
		href,
	};
}
// #endregion

// #region Reads
function fixtureEngagements(scope: ClientScope, sim: ClientPipelineSim, now: number) {
	const all = fixtureScopedListings();
	const inScope = scope.listing
		? all.filter((l) => l.slug === scope.listing)
		: filterByScope(all, scope.filter ?? "all");
	if (scope.listing && inScope.length === 0) return null;
	const ids = new Set(inScope.map((l) => l.id));
	const rows = SEEDS[sim === "auto" ? "busy" : sim]
		.map((seed, i) => rowOf(seed, i + 1, all, now))
		.filter((r): r is ClientEngagementRow => r !== null && ids.has(r.listing_id));
	const listings = new Map(inScope.map((l) => [l.id, { slug: l.slug, title: l.title }]));
	return toEngagements(rows, listings, FIXTURE_BUYERS);
}

/** The fixture board, or `null` when a listing scope names no fixture listing. */
export function fixturePipeline(
	scope: ClientScope,
	sim: ClientPipelineSim,
	display: string,
	now: number,
): ClientPipeline | null {
	const engagements = fixtureEngagements(scope, sim, now);
	return engagements ? buildPipeline(engagements, display, null, false) : null;
}

/** One fixture buyer, or `null` when they have nothing in scope. */
export function fixtureClient(
	handle: string,
	scope: ClientScope,
	sim: ClientPipelineSim,
	display: string,
	now: number,
): ClientDetail | null {
	const mine = (fixtureEngagements(scope, sim, now) ?? []).filter((e) =>
		e.client.handle === handle
	);
	if (mine.length === 0) return null;
	const inquiry = mine.find((e) => e.kind === "inquiry");
	const reschedules: ClientReschedule[] = mine
		.filter((e) => e.actionReasons.includes("reschedule_open") && e.nextEventAt)
		.map((e) => {
			const start = Date.parse(e.nextEventAt as string);
			const eventId = e.href.slice("/calendar?event=".length);
			return {
				eventId,
				title: e.listingTitle,
				start,
				href: e.href,
				reschedule: {
					mode: "counterparty",
					status: "awaiting_counterparty",
					openedBy: { name: e.client.name, avatar: null, handle: e.client.handle },
					openedAt: now - 5 * HOUR,
					proposals: [{
						id: `${eventId}-p1`,
						start: start + 24 * HOUR,
						end: start + 25 * HOUR,
						proposedBy: { name: e.client.name, avatar: null, handle: e.client.handle },
						proposedByRole: "attendee",
						proposedAt: now - 5 * HOUR,
						approved: false,
						note: "Could we push this by a day?",
						votes: [],
					}],
					resolvesAt: null,
					resolvedProposalId: null,
					round: 1,
				},
			};
		});
	return {
		...summarise(mine, display, null),
		threadId: inquiry ? inquiry.id.slice("inquiry-".length) : null,
		reschedules,
	};
}
// #endregion
