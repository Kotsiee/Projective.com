import {
	ACTION_SEVERITY,
	type ClientEngagement,
	ClientEngagementRowSchema,
	type ClientIdentity,
	ClientKey,
	type ClientLane,
	clientLaneOf,
	type ClientPipeline,
	type ClientSummary,
	LANE_ORDER,
	money,
	severityRank,
} from "@projective/types/catalogue";
import { toMajorUnits } from "@projective/types/finance";
import type { MinorConverter } from "./analytics-model.ts";

/**
 * client-pipeline — the PURE half of the Clients reads: `catalogue.get_client_pipeline` rows in,
 * {@link ClientEngagement}s, per-buyer {@link ClientSummary}s and the board out. Lanes come only from
 * `laneOf` over each source's own status (root CLAUDE.md §5); nothing here invents a status.
 */

// #region Rows → engagements
/** A listing as the mapping needs it. */
export interface PipelineListing {
	slug: string;
	title: string;
}

/** `@handle` from a bare username, or `null` when it is not a valid {@link ClientKey}. */
export function toClientKey(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const key = `@${raw.trim().toLowerCase().replace(/^@/, "")}`;
	return ClientKey.safeParse(key).success ? key : null;
}

const MONEYED_KINDS = new Set(["order", "session_booking", "pipeline_project"]);

/**
 * Map RPC rows to engagements. A row whose listing is outside the scope, whose buyer has no handle
 * (an order a team placed records no person) or which does not parse is dropped, never guessed at.
 * `hasOrder` is whether the same buyer has an order, sitting or project on the same listing.
 */
export function toEngagements(
	rows: readonly unknown[],
	listings: ReadonlyMap<string, PipelineListing>,
	identities: ReadonlyMap<string, ClientIdentity>,
): ClientEngagement[] {
	const parsed = rows.flatMap((raw) => {
		const r = raw as Record<string, unknown>;
		const row = ClientEngagementRowSchema.safeParse({
			...r,
			amount_minor: r.amount_minor === null || r.amount_minor === undefined
				? null
				: Number(r.amount_minor),
			currency: typeof r.currency === "string" ? r.currency.toUpperCase() : null,
			action_reasons: r.action_reasons ?? [],
		});
		if (!row.success) return [];
		const handle = toClientKey(row.data.buyer_handle);
		const listing = listings.get(row.data.listing_id);
		return handle && listing ? [{ row: row.data, handle, listing }] : [];
	});

	const bought = new Set(
		parsed.filter((p) => MONEYED_KINDS.has(p.row.engagement_kind)).map((p) =>
			`${p.handle}|${p.row.listing_id}`
		),
	);
	return parsed.map(({ row, handle, listing }) => ({
		id: `${row.engagement_kind}-${row.engagement_id}`,
		kind: row.engagement_kind,
		status: row.status,
		client: identities.get(handle) ?? { handle, name: handle.slice(1), avatar: "" },
		listingId: listing.slug,
		listingTitle: listing.title.slice(0, 200),
		hasOrder: bought.has(`${handle}|${row.listing_id}`),
		actionReasons: [...row.action_reasons].sort((a, b) =>
			ACTION_SEVERITY.indexOf(a) - ACTION_SEVERITY.indexOf(b)
		),
		amountMinor: row.amount_minor,
		currency: row.currency,
		openedAt: new Date(row.opened_at).toISOString(),
		lastActivityAt: new Date(row.last_activity_at).toISOString(),
		nextEventAt: row.next_event_at ? new Date(row.next_event_at).toISOString() : null,
		href: row.href,
	}));
}
// #endregion

// #region Order
/** Action-required first, by severity; then the most recently active. */
export function compareEngagements(a: ClientEngagement, b: ClientEngagement): number {
	return severityRank([a]) - severityRank([b]) ||
		b.lastActivityAt.localeCompare(a.lastActivityAt) ||
		a.id.localeCompare(b.id);
}

/** Board order: lane urgency, then (action-required) severity, then recency. */
export function compareClients(a: ClientSummary, b: ClientSummary): number {
	return LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane) ||
		(a.lane === "action_required"
			? severityRank(a.engagements) - severityRank(b.engagements)
			: 0) ||
		b.lastActivityAt.localeCompare(a.lastActivityAt) ||
		a.client.handle.localeCompare(b.client.handle);
}
// #endregion

// #region Summaries
const CANCELLED = new Set([
	"refunded",
	"cancelled",
	"cancelled_by_freelancer",
	"cancelled_by_client",
]);

/**
 * The buyer's gross: their orders and sittings that were not refunded or cancelled (a project's budget
 * is not money taken). In the one currency it was taken in, else converted into `display`.
 */
export function grossLabelOf(
	engagements: readonly ClientEngagement[],
	display: string,
	convert: MinorConverter | null,
): string {
	const paid = engagements.filter((e) =>
		(e.kind === "order" || e.kind === "session_booking") && !CANCELLED.has(e.status) &&
		e.amountMinor !== null && e.currency !== null
	);
	const currencies = new Set(paid.map((e) => e.currency as string));
	const target = currencies.size === 1 ? [...currencies][0] : display.toUpperCase();
	let minor = 0;
	for (const e of paid) {
		const from = e.currency as string;
		minor += from === target
			? e.amountMinor as number
			: convert?.(e.amountMinor as number, from, target) ?? 0;
	}
	return money(toMajorUnits(minor, target) ?? 0, target).slice(0, 24);
}

/** One buyer's summary from their engagements (at least one). */
export function summarise(
	engagements: readonly ClientEngagement[],
	display: string,
	convert: MinorConverter | null,
): ClientSummary {
	const sorted = [...engagements].sort(compareEngagements);
	const opened = sorted.map((e) => e.openedAt).sort();
	const active = sorted.map((e) => e.lastActivityAt).sort();
	return {
		client: sorted[0].client,
		lane: clientLaneOf(sorted),
		engagements: sorted.slice(0, 100),
		grossLabel: grossLabelOf(sorted, display, convert),
		firstSeenAt: opened[0],
		lastActivityAt: active[active.length - 1],
	};
}

/** Group engagements by buyer. */
export function byClient(
	engagements: readonly ClientEngagement[],
): Map<string, ClientEngagement[]> {
	const out = new Map<string, ClientEngagement[]>();
	for (const e of engagements) {
		const list = out.get(e.client.handle);
		if (list) list.push(e);
		else out.set(e.client.handle, [e]);
	}
	return out;
}

const BOARD_CAP = 200;

/** The board: one summary per buyer in board order, buyers per lane, and whether rows were cut. */
export function buildPipeline(
	engagements: readonly ClientEngagement[],
	display: string,
	convert: MinorConverter | null,
	truncated: boolean,
): ClientPipeline {
	const clients = [...byClient(engagements).values()]
		.map((list) => summarise(list, display, convert))
		.sort(compareClients);
	const counts: Record<ClientLane, number> = {
		inquiries: 0,
		active: 0,
		action_required: 0,
		closed: 0,
	};
	for (const c of clients) counts[c.lane]++;
	return {
		clients: clients.slice(0, BOARD_CAP),
		counts,
		hasMore: truncated || clients.length > BOARD_CAP,
	};
}

/** Whether any engagement's currency differs from the others', which is when rates are needed. */
export function needsConversion(engagements: readonly ClientEngagement[]): boolean {
	return new Set(engagements.flatMap((e) => e.currency ? [e.currency] : [])).size > 1;
}
// #endregion
