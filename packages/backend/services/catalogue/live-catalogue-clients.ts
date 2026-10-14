import type { SupabaseClient } from "supabaseClient";
import {
	type ClientDetail,
	type ClientEngagement,
	type ClientIdentity,
	type ClientPipeline,
	type ClientReschedule,
	CLOSED_STATUSES,
} from "@projective/types/catalogue";
import { PLATFORM_BASE_CURRENCY } from "@projective/types/finance";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { projectorFor } from "../finance/commerce-money.ts";
import { FxService } from "../finance/FxService.ts";
import type { ReadActor } from "../read-actor.ts";
import { ScheduleBackendService } from "../scheduling/ScheduleBackendService.ts";
import type { MinorConverter } from "./analytics-model.ts";
import {
	buildPipeline,
	needsConversion,
	type PipelineListing,
	summarise,
	toClientKey,
	toEngagements,
} from "./client-pipeline.ts";
import {
	type ClientScope,
	loadScopedListings,
	resolveConsoleScope,
	type ScopedListing,
} from "./listing-scope.ts";

/**
 * live-catalogue-clients — the Clients reads as the signed-in seller.
 *
 * One call to `catalogue.get_client_pipeline` (INVOKER, so every arm answers under RLS, orders through
 * its narrow definer — Decision #218), mapped by the pure `client-pipeline`. The buyer's public
 * identity comes from the profile directory, the inline thread from the pair's one DM thread, and
 * open reschedule rounds from the calendar's own coordination read.
 */

// #region Scope
/** The most rows one pipeline read asks for (the RPC's own ceiling). */
const RPC_LIMIT = 500;
const RESCHEDULE_CAP = 20;
const EVENT_HREF = /^\/calendar\?event=([0-9a-f-]{36})$/;
// #endregion

// #region Reads
interface DirectoryRow {
	handle: string;
	name: string;
	avatar_bucket: string | null;
	avatar_path: string | null;
}

async function identitiesFor(handles: readonly string[]): Promise<Map<string, ClientIdentity>> {
	const out = new Map<string, ClientIdentity>();
	const bare = [...new Set(handles.map((h) => h.slice(1)))];
	if (bare.length === 0) return out;
	const { data, error } = await getAnonClient().schema("org").from("profiles_index")
		.select("handle, name, avatar_bucket, avatar_path")
		.in("handle", bare);
	if (error) throw new Error(`org.profiles_index read failed: ${error.message}`);
	for (const row of (data ?? []) as DirectoryRow[]) {
		const key = toClientKey(row.handle);
		if (!key) continue;
		out.set(key, {
			handle: key,
			name: (row.name || row.handle).slice(0, 120),
			avatar: publicObjectUrl(row.avatar_bucket, row.avatar_path) ?? "",
		});
	}
	return out;
}

interface Loaded {
	engagements: ClientEngagement[];
	rows: Array<{ buyer_user_id: string | null; buyer_handle: string | null }>;
	truncated: boolean;
}

/** The scope's engagements, or `null` when it names a listing the caller does not manage. */
async function loadEngagements(
	db: SupabaseClient,
	actor: ReadActor & { accessToken: string },
	scope: ClientScope,
): Promise<Loaded | null> {
	const all = await loadScopedListings(db, actor);
	let listings: ScopedListing[];
	if (scope.listing) {
		const one = all.find((l) => l.slug === scope.listing);
		if (!one) return null;
		listings = [one];
	} else {
		listings = await resolveConsoleScope(db, actor, all, scope.filter ?? "all");
	}
	if (listings.length === 0) return { engagements: [], rows: [], truncated: false };

	const { data, error } = await db.schema("catalogue").rpc("get_client_pipeline", {
		p_listing: scope.listing ? listings[0].id : null,
		p_limit: RPC_LIMIT,
	});
	if (error) throw new Error(`catalogue.get_client_pipeline failed: ${error.message}`);
	const rows = (data ?? []) as Array<Record<string, unknown>>;
	const byId = new Map<string, PipelineListing>(
		listings.map((l) => [l.id, { slug: l.slug, title: l.title }]),
	);
	const handles = rows.flatMap((r) => {
		const key = toClientKey(r.buyer_handle as string | null);
		return key ? [key] : [];
	});
	return {
		engagements: toEngagements(rows, byId, await identitiesFor(handles)),
		rows: rows as Loaded["rows"],
		truncated: rows.length >= RPC_LIMIT,
	};
}

async function converterIfMixed(
	engagements: readonly ClientEngagement[],
): Promise<MinorConverter | null> {
	if (!needsConversion(engagements)) return null;
	const table = await FxService.rates(PLATFORM_BASE_CURRENCY);
	return (minor, from, to) => {
		const projector = projectorFor(to, table);
		return projector.canConvert(from) ? projector.convertMinor(minor, from) : null;
	};
}

/**
 * The seller's one DM thread with the buyer (`comms.get_or_create_dm_thread` keeps one non-group
 * thread per pair), read without minting one: `null` until either of them writes.
 */
async function pairThread(
	db: SupabaseClient,
	actor: ReadActor & { accessToken: string },
	buyerUserId: string,
): Promise<string | null> {
	const comms = db.schema("comms");
	const theirs = await comms.from("dm_participants").select("thread_id")
		.eq("user_id", buyerUserId).is("deleted_at", null);
	if (theirs.error) throw new Error(`comms.dm_participants read failed: ${theirs.error.message}`);
	const shared = ((theirs.data ?? []) as Array<{ thread_id: string }>).map((p) => p.thread_id);
	if (shared.length === 0) return null;
	const mine = await comms.from("dm_participants").select("thread_id")
		.eq("user_id", actor.userId).is("deleted_at", null).in("thread_id", shared.slice(0, 200));
	if (mine.error) throw new Error(`comms.dm_participants read failed: ${mine.error.message}`);
	const both = ((mine.data ?? []) as Array<{ thread_id: string }>).map((p) => p.thread_id);
	if (both.length === 0) return null;
	const thread = await comms.from("dm_threads").select("id")
		.in("id", both).neq("kind", "group")
		.order("created_at", { ascending: true }).limit(1).maybeSingle();
	if (thread.error) throw new Error(`comms.dm_threads read failed: ${thread.error.message}`);
	return (thread.data as { id: string } | null)?.id ?? null;
}

/** The events a buyer's open engagements are scheduled through: calls, sittings, project meetings. */
async function engagementEvents(
	db: SupabaseClient,
	engagements: readonly ClientEngagement[],
	now: number,
): Promise<string[]> {
	const open = engagements.filter((e) => !CLOSED_STATUSES[e.kind].includes(e.status));
	const ids = open.flatMap((e) => {
		const m = e.href.match(EVENT_HREF);
		return m ? [m[1]] : [];
	});
	const projectIds = open.filter((e) => e.kind === "pipeline_project")
		.map((e) => e.id.slice("pipeline_project-".length));
	if (projectIds.length > 0) {
		const { data, error } = await db.schema("scheduling").from("events").select("id")
			.in("project_id", projectIds)
			.gt("ends_at", new Date(now).toISOString())
			.order("starts_at", { ascending: true })
			.limit(100);
		if (error) throw new Error(`scheduling.events read failed: ${error.message}`);
		ids.push(...((data ?? []) as Array<{ id: string }>).map((e) => e.id));
	}
	return [...new Set(ids)];
}

async function openRounds(
	db: SupabaseClient,
	actor: ReadActor & { accessToken: string },
	engagements: readonly ClientEngagement[],
	now: number,
): Promise<ClientReschedule[]> {
	const eventIds = await engagementEvents(db, engagements, now);
	if (eventIds.length === 0) return [];
	const result = await ScheduleBackendService.openReschedules(eventIds, actor, now);
	if (!result.ok || !result.data) {
		throw new Error(`open reschedule read failed: ${result.message ?? result.status}`);
	}
	return result.data.events.flatMap((e) =>
		e.reschedule
			? [{
				eventId: e.id,
				title: e.title.slice(0, 200),
				start: e.start,
				href: `/calendar?event=${e.id}`,
				reschedule: e.reschedule,
				event: e,
			}]
			: []
	)
		.sort((a, b) => a.start - b.start)
		.slice(0, RESCHEDULE_CAP);
}
// #endregion

// #region Reads, assembled
/** The board for a scope, or `null` when it names a listing the caller does not manage. */
export async function livePipeline(
	scope: ClientScope,
	actor: ReadActor & { accessToken: string },
	display: string,
): Promise<ClientPipeline | null> {
	const db = getUserClient(actor.accessToken);
	const loaded = await loadEngagements(db, actor, scope);
	if (!loaded) return null;
	return buildPipeline(
		loaded.engagements,
		display,
		await converterIfMixed(loaded.engagements),
		loaded.truncated,
	);
}

/**
 * One buyer in a scope, or `null` when the scope names no listing of the caller's or the buyer has no
 * engagement in it (both answered as a 404: a handle is not a way to probe who buys from whom).
 */
export async function liveClient(
	handle: string,
	scope: ClientScope,
	actor: ReadActor & { accessToken: string },
	display: string,
	now: number,
): Promise<ClientDetail | null> {
	const db = getUserClient(actor.accessToken);
	const loaded = await loadEngagements(db, actor, scope);
	if (!loaded) return null;
	const mine = loaded.engagements.filter((e) => e.client.handle === handle);
	if (mine.length === 0) return null;
	const buyerUserId =
		loaded.rows.find((r) => toClientKey(r.buyer_handle) === handle)?.buyer_user_id ??
			null;
	const [convert, threadId, reschedules] = await Promise.all([
		converterIfMixed(mine),
		buyerUserId ? pairThread(db, actor, buyerUserId) : Promise.resolve(null),
		openRounds(db, actor, mine, now),
	]);
	return { ...summarise(mine, display, convert), threadId, reschedules };
}
// #endregion
