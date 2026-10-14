import type { SupabaseClient } from "supabaseClient";
import type { ConsoleScope } from "@projective/types/catalogue";
import type { ReadActor } from "../read-actor.ts";

/**
 * listing-scope — which of the acting seller's listings an Analytics or Clients read covers.
 *
 * The console addresses a slice of the catalogue with a {@link ConsoleScope} (`all`, a kind, a
 * delivery model or one of the seller's collections); the workspace addresses one listing by its
 * `svc-`/`prd-` slug. Both resolve here to {@link ScopedListing} rows read under the seller's JWT, so
 * the catalogue policies decide what exists, exactly as the listings grid does.
 */

// #region Shape
/** One listing a read covers, with what the analytics and pipeline reads need of it. */
export interface ScopedListing {
	/** `catalogue.listings.id`. */
	id: string;
	/** The public `svc-`/`prd-` slug the console addresses it by. */
	slug: string;
	title: string;
	kind: "product" | "service";
	/** `marketplace.service_delivery_model`, `null` for a product. */
	model: string | null;
	currency: string;
	createCategory: string | null;
	blueprintId: string | null;
	productId: string | null;
}

interface ListingRow {
	id: string;
	kind: "product" | "service";
	title: string;
	currency: string | null;
	create_category: string | null;
	service_blueprint_id: string | null;
	product_id: string | null;
}

/** What a Clients read covers: one listing (the workspace) or a console scope. */
export interface ClientScope {
	/** A `svc-`/`prd-` slug; wins over {@link filter}. */
	listing?: string;
	filter?: ConsoleScope;
}

/** The most listings one seller's console reads at once (the listings grid's own window). */
const SCOPE_WINDOW = 500;
const IN_CHUNK = 100;
const TIMED_MODELS: ReadonlySet<string> = new Set(["session", "group_session"]);
// #endregion

// #region Pure
/**
 * The listings a console scope covers. Pure; `collectionMembers` is the listing ids of the named
 * collection, read by {@link collectionMembers} (an unknown collection is an empty set, never "all").
 */
export function filterByScope(
	listings: readonly ScopedListing[],
	filter: ConsoleScope,
	collectionMembers: ReadonlySet<string> = new Set(),
): ScopedListing[] {
	if (filter === "all") return [...listings];
	if (filter === "product" || filter === "service") {
		return listings.filter((l) => l.kind === filter);
	}
	if (filter.startsWith("model:")) {
		const model = filter.slice("model:".length);
		return listings.filter((l) => l.model === model);
	}
	if (filter.startsWith("collection:")) return listings.filter((l) => collectionMembers.has(l.id));
	return [];
}

/** Whether any listing sells booked time, which is when the booking heatmap means anything. */
export function sellsSessions(listings: readonly ScopedListing[]): boolean {
	return listings.some((l) => l.model !== null && TIMED_MODELS.has(l.model));
}
// #endregion

// #region Reads
function chunks<T>(list: readonly T[]): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += IN_CHUNK) out.push(list.slice(i, i + IN_CHUNK));
	return out;
}

async function readIn<T>(
	ids: readonly string[],
	read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
	what: string,
): Promise<T[]> {
	const answers = await Promise.all(chunks(ids).map(read));
	const out: T[] = [];
	for (const { data, error } of answers) {
		if (error) throw new Error(`${what} read failed: ${error.message}`);
		out.push(...((data ?? []) as T[]));
	}
	return out;
}

/** The team the actor acts for, or `null` in a personal context. */
export function actingTeam(actor: Pick<ReadActor, "contextType" | "contextId">): string | null {
	return actor.contextType === "team" && actor.contextId ? actor.contextId : null;
}

/**
 * Every listing the acting seller manages — the acting team's, or the person's own non-team listings
 * — with its slug and delivery model. Archived listings are included: their history is still theirs.
 */
export async function loadScopedListings(
	db: SupabaseClient,
	actor: Pick<ReadActor, "userId" | "contextType" | "contextId">,
): Promise<ScopedListing[]> {
	const team = actingTeam(actor);
	let q = db.schema("catalogue").from("listings").select(
		"id, kind, title, currency, create_category, service_blueprint_id, product_id",
	);
	q = team
		? q.eq("owner_team_id", team)
		: q.eq("owner_user_id", actor.userId).is("owner_team_id", null);
	const { data, error } = await q.order("updated_at", { ascending: false }).limit(SCOPE_WINDOW);
	if (error) throw new Error(`catalogue.listings read failed: ${error.message}`);
	const rows = (data ?? []) as ListingRow[];

	const bpIds = rows.flatMap((r) => r.service_blueprint_id ? [r.service_blueprint_id] : []);
	const prodIds = rows.flatMap((r) => r.product_id ? [r.product_id] : []);
	const [blueprints, products] = await Promise.all([
		readIn<{ id: string; slug: string; delivery_model: string }>(
			bpIds,
			(ids) =>
				db.schema("marketplace").from("service_blueprints").select("id, slug, delivery_model").in(
					"id",
					ids,
				),
			"marketplace.service_blueprints",
		),
		readIn<{ id: string; slug: string }>(
			prodIds,
			(ids) => db.schema("catalogue").from("products").select("id, slug").in("id", ids),
			"catalogue.products",
		),
	]);
	const bpById = new Map(blueprints.map((b) => [b.id, b]));
	const prodById = new Map(products.map((p) => [p.id, p]));

	return rows.flatMap((r) => {
		const bp = r.service_blueprint_id ? bpById.get(r.service_blueprint_id) : undefined;
		const prod = r.product_id ? prodById.get(r.product_id) : undefined;
		const slug = bp?.slug ?? prod?.slug;
		if (!slug) return [];
		return [{
			id: r.id,
			slug,
			title: r.title,
			kind: r.kind,
			model: bp?.delivery_model ?? null,
			currency: (r.currency ?? "USD").toUpperCase(),
			createCategory: r.create_category,
			blueprintId: r.service_blueprint_id,
			productId: r.product_id,
		}];
	});
}

/** The listing ids in the acting seller's collection `slug` (empty when they have no such collection). */
export async function collectionMembers(
	db: SupabaseClient,
	actor: Pick<ReadActor, "userId" | "contextType" | "contextId">,
	slug: string,
): Promise<Set<string>> {
	const team = actingTeam(actor);
	let q = db.schema("catalogue").from("collections").select("id").eq("slug", slug);
	q = team
		? q.eq("owner_team_id", team)
		: q.eq("owner_user_id", actor.userId).is("owner_team_id", null);
	const { data, error } = await q;
	if (error) throw new Error(`catalogue.collections read failed: ${error.message}`);
	const ids = ((data ?? []) as Array<{ id: string }>).map((c) => c.id);
	if (ids.length === 0) return new Set();
	const members = await readIn<{ listing_id: string }>(
		ids,
		(chunk) =>
			db.schema("catalogue").from("collection_listings").select("listing_id").in(
				"collection_id",
				chunk,
			),
		"catalogue.collection_listings",
	);
	return new Set(members.map((m) => m.listing_id));
}

/** Resolve a console scope against the seller's listings, reading the collection only when named. */
export async function resolveConsoleScope(
	db: SupabaseClient,
	actor: Pick<ReadActor, "userId" | "contextType" | "contextId">,
	listings: readonly ScopedListing[],
	filter: ConsoleScope,
): Promise<ScopedListing[]> {
	const members = filter.startsWith("collection:")
		? await collectionMembers(db, actor, filter.slice("collection:".length))
		: undefined;
	return filterByScope(listings, filter, members);
}
// #endregion
