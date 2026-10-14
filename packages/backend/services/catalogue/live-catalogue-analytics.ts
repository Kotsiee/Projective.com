import type { SupabaseClient } from "supabaseClient";
import {
	type AnalyticsPeriod,
	type AnalyticsScope,
	type CatalogueAnalytics,
	type ConsoleScope,
	lastRolledUpDay,
	shiftDay,
} from "@projective/types/catalogue";
import { PLATFORM_BASE_CURRENCY } from "@projective/types/finance";
import { getUserClient } from "../../core/supabase.ts";
import { projectorFor } from "../finance/commerce-money.ts";
import { FxService } from "../finance/FxService.ts";
import type { ReadActor } from "../read-actor.ts";
import {
	type AnalyticsHeadline,
	type AnalyticsWindows,
	buildAnalytics,
	headlineOf,
	type MinorConverter,
	reportingCurrency,
	type RollupRow,
	type StandingCounts,
	windowsFor,
} from "./analytics-model.ts";
import {
	actingTeam,
	loadScopedListings,
	resolveConsoleScope,
	type ScopedListing,
} from "./listing-scope.ts";

/**
 * live-catalogue-analytics — the Analytics read as the signed-in seller.
 *
 * The rollups come through `catalogue.get_listing_rollups` (`analytics` is not an exposed schema), an
 * INVOKER door, so `analytics.daily_rollups` still answers under its own policy
 * (`fn_subject_visible('listing')`: the owner, or a `publish_listings` holder on the owning team) and
 * a listing the caller may not see reads as no activity rather than as an error. The figures are then
 * assembled by the pure
 * {@link buildAnalytics}.
 */

// #region Plumbing
const PAGE = 1000;
const MAX_PAGES = 200;
const IN_CHUNK = 100;
const FALLBACK_TZ = "UTC";

interface Pageable {
	range(
		from: number,
		to: number,
	): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Every row a query matches, a page at a time: PostgREST cuts a response at `max_rows` silently. */
async function readAll<T>(build: () => Pageable, what: string): Promise<T[]> {
	const out: T[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const { data, error } = await build().range(page * PAGE, page * PAGE + PAGE - 1);
		if (error) throw new Error(`${what} read failed: ${error.message}`);
		const rows = (data ?? []) as T[];
		out.push(...rows);
		if (rows.length < PAGE) return out;
	}
	throw new Error(`${what} read exceeded ${MAX_PAGES * PAGE} rows`);
}

async function readAllIn<T>(
	ids: readonly string[],
	build: (chunk: string[]) => Pageable,
	what: string,
): Promise<T[]> {
	const out: T[] = [];
	for (let i = 0; i < ids.length; i += IN_CHUNK) {
		const chunk = ids.slice(i, i + IN_CHUNK);
		out.push(...await readAll<T>(() => build(chunk), what));
	}
	return out;
}

function startOf(day: string): string {
	return `${day}T00:00:00Z`;
}
// #endregion

// #region Reads
async function readRollups(
	db: SupabaseClient,
	listingIds: readonly string[],
	windows: AnalyticsWindows,
): Promise<RollupRow[]> {
	return await readAllIn<RollupRow>(
		listingIds,
		(chunk) =>
			db.schema("catalogue").rpc("get_listing_rollups", {
				p_listing_ids: chunk,
				p_from: windows.previous.from,
				p_to: windows.current.through,
			}),
		"catalogue.get_listing_rollups",
	);
}

/**
 * Standing impact (Decision #217(h)): the reviews and the completed stages each listing with a
 * CREATE category earned in each window — the events that move the seller's Standing in that
 * category. `null` when no listing in scope has a category.
 */
async function readStandingCounts(
	db: SupabaseClient,
	listings: readonly ScopedListing[],
	windows: AnalyticsWindows,
): Promise<StandingCounts | null> {
	const credited = listings.filter((l) => l.createCategory);
	if (credited.length === 0) return null;
	const since = startOf(windows.previous.from);
	const until = startOf(shiftDay(windows.current.through, 1));
	const subjects = credited.flatMap((l) =>
		[l.blueprintId, l.productId].filter((id): id is string => !!id)
	);
	const blueprints = credited.flatMap((l) => l.blueprintId ? [l.blueprintId] : []);

	const [reviews, projects] = await Promise.all([
		readAllIn<{ created_at: string }>(
			subjects,
			(chunk) =>
				db.schema("reviews").from("entity_reviews").select("created_at")
					.in("target_entity_type", ["service_blueprint", "product"])
					.in("target_entity_id", chunk)
					.gte("created_at", since)
					.lt("created_at", until)
					.order("id"),
			"reviews.entity_reviews",
		),
		readAllIn<{ id: string }>(
			blueprints,
			(chunk) =>
				db.schema("projects").from("projects").select("id").in("source_blueprint_id", chunk).order(
					"id",
				),
			"projects.projects",
		),
	]);
	const stages = await readAllIn<{ completed_at: string }>(
		projects.map((p) => p.id),
		(chunk) =>
			db.schema("projects").from("project_stages").select("completed_at")
				.in("project_id", chunk)
				.gte("completed_at", since)
				.lt("completed_at", until)
				.order("id"),
		"projects.project_stages",
	);

	const counts: StandingCounts = { current: 0, previous: 0 };
	for (const at of [...reviews.map((r) => r.created_at), ...stages.map((s) => s.completed_at)]) {
		const day = new Date(at).toISOString().slice(0, 10);
		if (day >= windows.current.from && day <= windows.current.through) counts.current++;
		else if (day >= windows.previous.from && day <= windows.previous.through) counts.previous++;
	}
	return counts;
}

/**
 * The zone the booking heatmap is keyed in — the rollup's own rule: the owning schedule's zone, else
 * the seller's profile zone, else UTC. A secondary read: a failure costs the label, never the page.
 */
async function sellerZone(
	db: SupabaseClient,
	actor: Pick<ReadActor, "userId" | "contextType" | "contextId">,
): Promise<string> {
	const team = actingTeam(actor);
	const schedule = await db.schema("scheduling").from("schedules").select("timezone")
		.eq("owner_type", team ? "team" : "user")
		.eq("owner_id", team ?? actor.userId)
		.maybeSingle();
	const own = (schedule.data as { timezone: string | null } | null)?.timezone;
	if (own?.trim()) return own;
	const profile = await db.schema("org").from("users_public").select("timezone")
		.eq("user_id", actor.userId)
		.maybeSingle();
	const tz = (profile.data as { timezone: string | null } | null)?.timezone;
	return tz?.trim() ? tz : FALLBACK_TZ;
}

async function converterFor(): Promise<MinorConverter> {
	const table = await FxService.rates(PLATFORM_BASE_CURRENCY);
	return (minor, from, to) => {
		const projector = projectorFor(to, table);
		return projector.canConvert(from) ? projector.convertMinor(minor, from) : null;
	};
}
// #endregion

// #region Overview
/**
 * One analytics read for a scope and window, or `null` when the scope names a listing the caller does
 * not manage (answered as a 404, never revealing that it exists).
 */
export async function liveOverview(
	scope: AnalyticsScope,
	period: AnalyticsPeriod,
	actor: ReadActor & { accessToken: string },
	display: string,
	now: Date,
): Promise<CatalogueAnalytics | null> {
	const db = getUserClient(actor.accessToken);
	const all = await loadScopedListings(db, actor);
	let listings: ScopedListing[];
	if (scope.kind === "listing") {
		const one = all.find((l) => l.slug === scope.listingId);
		if (!one) return null;
		listings = [one];
	} else {
		listings = await resolveConsoleScope(db, actor, all, scope.filter);
	}

	const windows = windowsFor(period, lastRolledUpDay(now));
	const ids = listings.map((l) => l.id);
	const [rows, standing, timezone] = await Promise.all([
		readRollups(db, ids, windows),
		readStandingCounts(db, listings, windows),
		sellerZone(db, actor),
	]);
	const { mixed } = reportingCurrency(rows, listings, display);
	return buildAnalytics({
		scope,
		period,
		listings,
		rows,
		windows,
		standing,
		timezone,
		display,
		convert: mixed ? await converterFor() : null,
	});
}

/**
 * The console header's sales rollups for a console scope: the gross, orders and conversion tiles of
 * the SAME assembly {@link liveOverview} runs, over the same rollups and window. Standing and the
 * heatmap's zone feed none of those tiles, so they are not read.
 */
export async function liveHeadline(
	db: SupabaseClient,
	actor: Pick<ReadActor, "userId" | "contextType" | "contextId">,
	filter: ConsoleScope,
	period: AnalyticsPeriod,
	display: string,
	now: Date,
): Promise<AnalyticsHeadline> {
	const listings = await resolveConsoleScope(
		db,
		actor,
		await loadScopedListings(db, actor),
		filter,
	);
	const windows = windowsFor(period, lastRolledUpDay(now));
	const rows = await readRollups(db, listings.map((l) => l.id), windows);
	const { mixed } = reportingCurrency(rows, listings, display);
	return headlineOf(buildAnalytics({
		scope: { kind: "catalogue", filter },
		period,
		listings,
		rows,
		windows,
		standing: null,
		timezone: FALLBACK_TZ,
		display,
		convert: mixed ? await converterFor() : null,
	}));
}
// #endregion
