import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import {
	type Catalog,
	entityKey,
	loadCatalog,
	type PlacementSurface,
	readProjectPreview,
	stampOf,
} from "./live-catalog.ts";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { buildLiveViewPage, composeViewPage, NO_REVIEWS, semanticSimilarTo } from "./live-view.ts";
import { ANONYMOUS_READER, canReadLive, type ReadActor } from "../read-actor.ts";
import { logDiscoveryQuery } from "../search/query-log.ts";
import {
	EmbeddingBackendService,
	isEmbeddableQuery,
	normaliseQuery,
	reportEmbeddingFallback,
} from "../search/EmbeddingBackendService.ts";
import { getResults, groupResults, rankRecommended, relatedSearches } from "./query.ts";
import {
	nearestKindsFor,
	SEMANTIC_POOL,
	semanticResults,
	type SemanticSimilarity,
	similarityFrom,
} from "./semantic.ts";
import { similarityCache, similarityCacheKey, similarityDeps } from "./similarity-cache.ts";
import { suggestFrom } from "./suggest.ts";
import { NO_PERSONAL_RAILS, personalRails, topicsOf, trendingRail } from "./personalise.ts";
import { ownHandlesOf, readViewerSignals } from "./viewer-signals.ts";
import { type DiscoveryRanking, type DiscoverySim, NO_DISCOVERY_SIM } from "@projective/types/explore";
import type {
	ArticleItem,
	CtaPromo,
	EditorialPromo,
	EntityView,
	ExploreItem,
	ExploreParams,
	HelpArticle,
	HomeFeed,
	LandingPayload,
	PlatformStats,
	ProductItem,
	ProfileItem,
	ProjectItem,
	PromoSlot,
	SearchPayload,
	ServiceItem,
	SponsoredPromo,
	SuggestQuery,
	Suggestions,
	Testimonial,
} from "@projective/types/explore";

/**
 * ExploreBackendService — the FAT server-side discovery service.
 *
 * It owns the discovery query: filtering, ranking, merged-section grouping, item lookup, the composed
 * Home feed and the `/view/[id]` page. Thin routes under `apps/web/routes/api/explore/*` do HTTP
 * parsing + Zod validation, then delegate here; the `/explore` and `/view` routes call these directly
 * for SSR first paint. Islands never reach this — they `fetch` the routes via the thin
 * `ExploreService`.
 *
 * Every read is LIVE: the public marketplace is loaded from Postgres once per short TTL
 * (`./live-catalog.ts`) and the pure query layer (`./query.ts`) filters, ranks and groups it. There is
 * no fixture fallback. A database that cannot be reached answers `503` with a message the surface
 * renders as its error state, never a corpus that looks real and is not.
 */

// #region Constants
/** Default page size when a caller omits `limit`. */
const FEED_PAGE = 18;
/** The most a single isolated-feed page may ask for. */
const FEED_MAX = 60;

/**
 * The two conversion slots Home places between sections — product COPY, not data: what the platform
 * invites a visitor to do is decided by the platform, not derived from any row.
 */
const CTA_FREELANCER: CtaPromo = {
	variant: "cta",
	id: "cta-freelancer",
	after: "freelancers",
	eyebrow: "Offer your skills",
	title: "Become a Freelancer",
	body: "Turn your craft into income. Set up services, get hired, and get paid safely at each step.",
	href: "/join?intent=freelancer",
	cta: "Start freelancing",
	audience: "non_freelancers",
	dismissible: true,
};

const CTA_TEAM: CtaPromo = {
	variant: "cta",
	id: "cta-team",
	after: "articles",
	eyebrow: "Build together",
	title: "Launch a Team",
	body: "Assemble a micro-agency, take on bigger projects, and share the work — and the reward.",
	href: "/join?intent=team",
	cta: "Launch a team",
	audience: "everyone",
	dismissible: true,
};

/** The placement inventory the Home feed sells (`marketplace.promoted_placements.surface`). */
const HOME_SURFACE: PlacementSurface = "explore_home";
// #endregion

// #region Composition

/**
 * A result that also says how its discovery content was ordered (Decision #179). Transport metadata on
 * the envelope, like `session`: the route turns it into the development-only `x-discovery-ranking`
 * header and it never reaches the JSON body.
 */
export type RankedResult<T> = ServiceResult<T> & { ranking: DiscoveryRanking };

function ranked<T>(result: ServiceResult<T>, ranking: DiscoveryRanking): RankedResult<T> {
	return { ...result, ranking };
}

async function querySimilarity(
	catalog: Catalog,
	params: ExploreParams,
): Promise<{ similarity: SemanticSimilarity; vector: number[] } | null> {
	// Too short or letterless to mean anything to a vector: heuristic by design, not a fallback.
	if (!isEmbeddableQuery(normaliseQuery(params.q))) return null;
	// A later page of the same search reuses the first page's neighbours (see ./similarity-cache.ts).
	const cacheKey = similarityCacheKey(params);
	const cached = similarityCache.get(cacheKey);
	if (cached) return cached;
	try {
		const embedded = await EmbeddingBackendService.embedQuery(params.q);
		if (!embedded.ok || !embedded.data) {
			// An open breaker or a spent budget already logged its transition; one line per request is noise.
			const reason = embedded.details?.reason;
			if (reason !== "circuit_open" && reason !== "budget") {
				reportEmbeddingFallback("search", embedded.message ?? "no query vector");
			}
			return null;
		}
		const rows = await similarityDeps().nearestTo(
			embedded.data,
			nearestKindsFor(params.category),
			[],
			SEMANTIC_POOL,
		);
		const similarity = similarityFrom(rows, (kind, id) => catalog.itemIdByEntity.get(entityKey(kind, id)));
		if (similarity.size === 0) return null;
		const found = { similarity, vector: embedded.data };
		similarityCache.set(cacheKey, found);
		return found;
	} catch (error) {
		reportEmbeddingFallback("search", error);
		return null;
	}
}

/** The error every read returns when the discovery load itself failed. */
function unavailable<T>(error: unknown): ServiceResult<T> {
	console.error("[explore]", error);
	return fail(503, {
		message: "Discovery is unavailable right now. Please try again in a moment.",
	});
}

/** Narrowing filters over the mixed catalogue. */
const ofType = <T extends ExploreItem["type"]>(catalog: Catalog, type: T) =>
	catalog.items.filter((it): it is Extract<ExploreItem, { type: T }> => it.type === type);

/**
 * The sponsored slots — one per ACTIVE placement bought for `surface`, oldest flight first, each built
 * from the listing it promotes. A placement whose item is not a sponsored service or product is
 * skipped: an advert for something a visitor cannot open, or that carries no disclosure, is not one
 * worth showing. A listing placed twice on the same surface is featured once.
 */
function sponsoredPromos(catalog: Catalog, surface: PlacementSurface): SponsoredPromo[] {
	const seen = new Set<string>();
	const out: SponsoredPromo[] = [];
	for (const placement of catalog.placements) {
		if (placement.surface !== surface || seen.has(placement.itemId)) continue;
		const it = catalog.byId.get(placement.itemId);
		if (!it || (it.type !== "services" && it.type !== "products") || !it.sponsored) continue;
		seen.add(it.id);
		out.push({
			variant: "sponsored",
			id: `sp-${it.id}`,
			rail: it.type,
			itemId: it.id,
			title: it.title,
			body: it.summary,
			media: it.media ?? "",
			mediaPlaceholder: it.mediaPlaceholder,
			owner: it.owner,
			href: `/view/${it.id}`,
			cta: it.type === "services" ? "View service" : "View product",
		});
	}
	return out;
}

/** The editorial break — the published articles, newest first; absent when there are none. */
function helpPromo(catalog: Catalog): EditorialPromo | null {
	const articles: HelpArticle[] = ofType(catalog, "articles")
		.slice()
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, 3)
		.map((a: ArticleItem) => ({
			id: a.id,
			title: a.title,
			minutes: a.readMinutes,
			href: `/view/${a.id}`,
		}));
	if (articles.length === 0) return null;
	return {
		variant: "editorial",
		id: "ed-help",
		after: "products",
		lead: "New here?",
		tail: "Start with these",
		href: "/help",
		hrefLabel: "All help articles",
		articles,
	};
}

/** Every Home promo slot, in feed order. */
function homePromos(catalog: Catalog): PromoSlot[] {
	const help = helpPromo(catalog);
	return [
		...sponsoredPromos(catalog, HOME_SURFACE),
		CTA_FREELANCER,
		...(help ? [help] : []),
		CTA_TEAM,
	];
}

/**
 * The cold-start simulation that may apply — development only, decided here rather than trusted from
 * the request: a switch a caller could assert into existence in production is not a gate.
 */
function effectiveDiscoverySim(sim: DiscoverySim | undefined): DiscoverySim {
	if (!sim || serverEnv().appEnv !== "development") return NO_DISCOVERY_SIM;
	return sim;
}

/**
 * The SHARED Home feed, from one catalogue load: the same for every viewer, so it is computed from the
 * anon-cached catalogue alone. The personal rails start empty; the viewer pass fills them.
 */
function homeFeedFrom(catalog: Catalog, sim: DiscoverySim): HomeFeed {
	const services = ofType(catalog, "services") as ServiceItem[];
	const products = ofType(catalog, "products") as ProductItem[];
	const projects = ofType(catalog, "projects") as ProjectItem[];
	const freelancers = ofType(catalog, "freelancers") as ProfileItem[];
	const teams = ofType(catalog, "teams") as ProfileItem[];
	return {
		users: ofType(catalog, "users") as ProfileItem[],
		freelancers,
		teams,
		businesses: ofType(catalog, "businesses") as ProfileItem[],
		services,
		projects,
		products,
		articles: ofType(catalog, "articles") as ArticleItem[],
		promos: homePromos(catalog),
		recommended: {
			services: rankRecommended(services, catalog.scoreById),
			products: rankRecommended(products, catalog.scoreById),
			projects: rankRecommended(projects, catalog.scoreById),
			people: rankRecommended([...freelancers, ...teams], catalog.scoreById),
		},
		personal: NO_PERSONAL_RAILS,
		trending: trendingRail(catalog, Date.now(), sim.activity === "quiet"),
	};
}

/** Compute a search page. The isolated feed pages over the REAL result set — no padded pool. */
function searchFrom(
	catalog: Catalog,
	params: ExploreParams,
	offset: number,
	limit: number,
	similarity?: SemanticSimilarity,
): SearchPayload {
	const results = similarity
		? semanticResults(catalog.items, params, catalog.scoreById, similarity)
		: getResults(catalog.items, params, catalog.scoreById);
	const related = relatedSearches(catalog.items, params);
	if (params.category === "all") {
		return {
			count: results.length,
			isolated: false,
			items: [],
			poolTotal: 0,
			groups: groupResults(results),
			related,
			hasMore: false,
		};
	}
	return {
		count: results.length,
		isolated: true,
		items: results.slice(offset, offset + limit),
		poolTotal: results.length,
		groups: [],
		related,
		hasMore: offset + limit < results.length,
	};
}

// #endregion

export class ExploreBackendService {
	/**
	 * Run a discovery search. Returns the grouped merged sections (cross-category) or a single page of
	 * the isolated-category feed, plus the real count and related terms.
	 *
	 * `semantic` is the caller's `isEmbeddingsLive(req)` (Decision #179): when it holds and there is a
	 * query, the results are re-ranked and topped up with voyage-4 similarity; any Voyage or database
	 * failure falls back to the heuristic search for this request (logged once), and `ranking` says
	 * which one ran.
	 */
	static async search(
		input: {
			params: ExploreParams;
			offset?: number;
			limit?: number;
			actor?: ReadActor;
			semantic?: boolean;
		},
	): Promise<RankedResult<SearchPayload>> {
		const offset = Math.max(0, input.offset ?? 0);
		const limit = Math.min(FEED_MAX, Math.max(1, input.limit ?? FEED_PAGE));
		const started = performance.now();
		try {
			const catalog = await loadCatalog();
			const semantic = input.semantic && input.params.q.trim()
				? await querySimilarity(catalog, input.params)
				: null;
			const payload = searchFrom(catalog, input.params, offset, limit, semantic?.similarity);
			// A later page of the same feed is not a new search, so only the first page is logged.
			if (offset === 0) {
				const { category } = input.params;
				logDiscoveryQuery(input.actor ?? ANONYMOUS_READER, {
					params: input.params,
					resultCount: payload.count,
					candidatePool: category === "all"
						? catalog.items.length
						: catalog.items.filter((it) => it.type === category).length,
					durationMs: performance.now() - started,
					queryEmbedding: semantic?.vector,
				}).catch((error) => console.error("[explore] search.fn_log_query failed", error));
			}
			return ranked(ok(payload), semantic ? "semantic" : "heuristic");
		} catch (error) {
			return ranked(unavailable(error), "heuristic");
		}
	}

	/**
	 * The composed Home discovery feed (State A first paint), in two passes.
	 *
	 * The SHARED pass — sections, promos, the Recommended lists and Trending — comes from the
	 * anon-cached catalogue and is identical for every visitor. For a signed-in viewer, a
	 * VIEWER-SCOPED pass then reads their own views, saves and affinity under their token
	 * (`./viewer-signals.ts`) and composes "Because you viewed" / "Picked for you" and "Saved". A guest
	 * gets the shared feed with empty personal rails.
	 *
	 * A failed viewer pass is logged and the shared feed is served: personalisation is never worth
	 * taking discovery down for. `sim` is the Dev Context Switcher's cold-start simulation, honoured in
	 * development only.
	 */
	static async home(
		input: { actor: ReadActor; sim?: DiscoverySim },
	): Promise<ServiceResult<HomeFeed>> {
		const sim = effectiveDiscoverySim(input.sim);
		let catalog: Catalog;
		try {
			catalog = await loadCatalog();
		} catch (error) {
			return unavailable(error);
		}
		const feed = homeFeedFrom(catalog, sim);
		if (!canReadLive(input.actor)) return ok(feed);
		try {
			const signals = await readViewerSignals(input.actor, catalog, sim.viewer, Date.now());
			// #region Semantic personalisation hook (ranking-v1: user vectors re-rank the personal rails)
			// #endregion
			return ok({ ...feed, personal: personalRails(catalog, signals, catalog.weights) });
		} catch (error) {
			console.error("[explore] the viewer pass failed; serving the shared Home feed", error);
			return ok(feed);
		}
	}

	/**
	 * Record that a signed-in viewer opened a discovery item — their "Because you viewed" anchor, a
	 * lean of their affinity toward its topics, and one vote toward Trending (`search.record_view`,
	 * under their own token). The id is resolved against the PUBLISHED catalogue first, so a stale or
	 * invented id records nothing. Opening your own listing or profile is not a view of interest and is
	 * not recorded (`recorded: false`), so nobody can nudge their own work toward Trending.
	 */
	static async recordView(
		input: { id: string; actor: ReadActor },
	): Promise<ServiceResult<{ recorded: boolean }>> {
		const actor = input.actor;
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to keep a viewing history." });
		let catalog: Catalog;
		try {
			catalog = await loadCatalog();
		} catch (error) {
			return unavailable(error);
		}
		const item = catalog.byId.get(input.id);
		const entity = catalog.entityById.get(input.id);
		if (!item || !entity) return fail(404, { message: `No item found for id "${input.id}".` });
		if (ownHandlesOf(actor, catalog).has(item.owner.handle)) return ok({ recorded: false });

		const { error } = await getUserClient(actor.accessToken).schema("search").rpc("record_view", {
			p_entity_type: entity.kind,
			p_entity_id: entity.id,
			p_topics: topicsOf(item),
		});
		if (!error) return ok({ recorded: true });
		if (error.code === "42501") return fail(401, { message: "Sign in to keep a viewing history." });
		if (error.code === "23503") {
			return fail(409, { message: "Finish setting up your account to keep a viewing history." });
		}
		return unavailable(error);
	}

	/** Look up a single item by id — backs the detail drawer + SEO/title resolution. */
	static async item(id: string): Promise<ServiceResult<{ item: ExploreItem }>> {
		try {
			const item = (await loadCatalog()).byId.get(id);
			return item ? ok({ item }) : fail(404, { message: `No item found for id "${id}".` });
		} catch (error) {
			return unavailable(error);
		}
	}

	/**
	 * Resolve a BATCH of ids in one pass — the "Continue where you left off" rail hands over the dozen
	 * or so references it has stored. Results come back **in the order the ids were given** (the
	 * reader's own recency), and an id that resolves to nothing is **omitted**: a stored reference goes
	 * stale the moment its listing is unpublished, and one dead entry must not cost the other eleven.
	 */
	static async items(ids: string[]): Promise<ServiceResult<ExploreItem[]>> {
		try {
			const catalog = await loadCatalog();
			return ok(ids.map((id) => catalog.byId.get(id)).filter((it): it is ExploreItem => !!it));
		} catch (error) {
			return unavailable(error);
		}
	}

	/**
	 * Everything one owner has PUBLISHED, as the SAME cards `/explore` renders — the profile's
	 * Services, Products, Posts and open-briefs sections read this, so a card on a profile is
	 * byte-identical to the card that links to it from discovery. `owner` is the `@handle` (or bare
	 * handle); a team or business handle returns what that entity published.
	 *
	 * `projects.open` is the owner's public briefs still hiring. There is deliberately no "past"
	 * list here: the discovery load reads as `anon`, and RLS admits only ACTIVE public projects to
	 * `anon` — a completed engagement's visibility is governed by its portfolio display rights, which
	 * the profile's own definer read enforces.
	 */
	static async listingsByOwner(owner: string): Promise<
		ServiceResult<{
			services: ServiceItem[];
			products: ProductItem[];
			articles: ArticleItem[];
			projects: { open: ProjectItem[] };
		}>
	> {
		const handle = owner.startsWith("@") ? owner : `@${owner}`;
		try {
			const catalog = await loadCatalog();
			const mine = catalog.items.filter((it) => it.owner.handle === handle);
			return ok({
				services: mine.filter((it): it is ServiceItem => it.type === "services"),
				products: mine.filter((it): it is ProductItem => it.type === "products"),
				articles: mine.filter((it): it is ArticleItem => it.type === "articles"),
				projects: { open: mine.filter((it): it is ProjectItem => it.type === "projects") },
			});
		} catch (error) {
			return unavailable(error);
		}
	}

	/**
	 * The composed Entity View page (`/view/[id]`): the item plus its gallery, resolved pricing/trust
	 * facts, deliverables, cross-sell rails, reviews and its type-specific extension.
	 *
	 * With `semantic` (the caller's `isEmbeddingsLive(req)`), the "Similar" rail comes from the item's
	 * stored voyage-4 vector instead of the heuristic, which stays the answer when the item has no
	 * vector or the read fails; `ranking` says which one ran.
	 */
	static async viewPage(
		id: string,
		options: { semantic?: boolean } = {},
	): Promise<RankedResult<EntityView>> {
		try {
			const catalog = await loadCatalog();
			const item = catalog.byId.get(id);
			if (!item || item.type === "users" || item.type === "freelancers" ||
				item.type === "teams" || item.type === "businesses") {
				return ranked(fail(404, { message: `No item found for id "${id}".` }), "heuristic");
			}
			const [view, similar] = await Promise.all([
				buildLiveViewPage(catalog, item),
				options.semantic ? semanticSimilarTo(catalog, item) : Promise.resolve(null),
			]);
			return similar ? ranked(ok({ ...view, similar }), "semantic") : ranked(ok(view), "heuristic");
		} catch (error) {
			return ranked(unavailable(error), "heuristic");
		}
	}

	/**
	 * The owner's PREVIEW of their own brief (`/projects/[slug]/preview`) — the same composed
	 * {@link EntityView} a freelancer's `/view/[id]?type=projects` renders, built from the project's rows
	 * as they are NOW, drafts included.
	 *
	 * The catalogue holds only published, public briefs and lags an edit by up to one TTL, so the rows
	 * are read fresh with the owner's token (`readProjectPreview`) and mapped by the catalogue's own
	 * `assemble`; the page then composes through the same `composeViewPage` as the public one. One
	 * mapping and one composer is what lets the preview promise to be the page.
	 *
	 * The cross-sell rails and the reviews are left EMPTY rather than computed: the preview excludes
	 * them (an owner evaluating their own brief is not the audience for a recommendation of someone
	 * else's, and their own client reviews are not what they are checking), and a payload that carried
	 * them would be one forgotten conditional away from rendering them.
	 *
	 * Ownership is the ROUTE's guard (`viewerIsClient`), and RLS is the backstop: a token that cannot
	 * read the project gets a 404 here, never another client's draft.
	 */
	static async projectPreviewPage(
		slug: string,
		actor: ReadActor,
	): Promise<ServiceResult<EntityView>> {
		if (!canReadLive(actor)) return fail(401, { message: "Sign in to preview this project." });
		try {
			const catalog = await loadCatalog();
			const withProject = await readProjectPreview(actor.accessToken, slug, catalog);
			const item = withProject?.byId.get(slug);
			if (!withProject || !item || item.type !== "projects") {
				return fail(404, { message: `No project found for "${slug}".` });
			}
			return ok({
				...composeViewPage(withProject, item, NO_REVIEWS),
				moreByOwner: [],
				similar: [],
			});
		} catch (error) {
			return unavailable(error);
		}
	}

	/**
	 * Recent, highly rated reviews to quote on the landing page — one per author, so a single
	 * enthusiastic reviewer cannot fill the marquee. The voice follows the review's TARGET: a review of
	 * a seller or a listing is a client speaking; a review of a client or a business is a seller
	 * speaking. An author outside the public directory is skipped rather than quoted anonymously.
	 */
	static async testimonials(limit = 8): Promise<ServiceResult<Testimonial[]>> {
		try {
			const catalog = await loadCatalog();
			const { data, error } = await getAnonClient()
				.schema("reviews")
				.from("entity_reviews")
				.select("id, reviewer_user_id, target_entity_type, rating, title, comment, created_at")
				.gte("rating", 4.5)
				.order("created_at", { ascending: false })
				.limit(60);
			if (error) throw new Error(`reading reviews failed — ${error.message}`);
			const seen = new Set<string>();
			const out: Testimonial[] = [];
			for (const r of (data ?? []) as Array<{
				id: string;
				reviewer_user_id: string;
				target_entity_type: string;
				rating: number | string;
				title: string | null;
				comment: string;
			}>) {
				if (out.length >= limit) break;
				if (seen.has(r.reviewer_user_id)) continue;
				const author = catalog.profileById.get(r.reviewer_user_id);
				if (!author) continue;
				seen.add(r.reviewer_user_id);
				out.push({
					id: r.id,
					quote: r.comment,
					title: r.title ?? "",
					rating: Number(r.rating),
					voice: r.target_entity_type === "user" || r.target_entity_type === "business"
						? "freelancer"
						: "client",
					author: {
						handle: `@${author.handle}`,
						name: author.name,
						avatar: publicObjectUrl(author.avatar_bucket, author.avatar_path) ?? "",
						kind: author.entity_type,
						verified: author.verified,
						verificationStamp: stampOf(author.verification_stamp),
					},
					role: author.headline ?? "",
				});
			}
			return ok(out);
		} catch (error) {
			return unavailable(error);
		}
	}

	/** The platform's running totals for the landing hero (`search.platform_stats`). */
	static async stats(): Promise<ServiceResult<PlatformStats>> {
		try {
			const { data, error } = await getAnonClient()
				.schema("search")
				.from("platform_stats")
				.select("helpers, stages_delivered, projects_live, paid_out_minor, paid_out_currency")
				.single();
			if (error) throw new Error(`reading search.platform_stats failed — ${error.message}`);
			const row = data as {
				helpers: number;
				stages_delivered: number;
				projects_live: number;
				paid_out_minor: number | string;
				paid_out_currency: string;
			};
			return ok({
				helpers: row.helpers,
				stagesDelivered: row.stages_delivered,
				projectsLive: row.projects_live,
				paidOutMinor: Number(row.paid_out_minor),
				paidOutCurrency: row.paid_out_currency,
			});
		} catch (error) {
			return unavailable(error);
		}
	}

	/**
	 * Everything the public landing page renders, in one call: the live home feed (its showcase
	 * sections), real testimonials, the platform's running totals and the hero backdrop. A failure of
	 * any read fails the whole — the landing page then renders its error state rather than a mix of real
	 * sections and silently empty ones. The landing page is the same for everyone, so its feed is the
	 * shared one: no viewer pass runs here.
	 */
	static async landing(): Promise<ServiceResult<LandingPayload>> {
		const [home, testimonials, stats] = await Promise.all([
			ExploreBackendService.home({ actor: ANONYMOUS_READER }),
			ExploreBackendService.testimonials(),
			ExploreBackendService.stats(),
		]);
		if (!home.ok || !home.data) return fail(home.status, { message: home.message });
		// The quotes and the totals are garnish: a failed read leaves that part absent rather than
		// taking the whole page down with it (the failure is already logged by `unavailable`).
		return ok({
			home: home.data,
			testimonials: testimonials.ok && testimonials.data ? testimonials.data : [],
			stats: stats.ok && stats.data ? stats.data : null,
			heroImage: publicObjectUrl("public_assets", "platform/marketing/hero.webp"),
		});
	}

	/**
	 * Search-as-you-type for the three discovery bars: top hits per listing type, matched skills and
	 * categories, and matched `@handle`s for a typed prefix — or the trending terms when `q` is empty,
	 * led by the topics of the catalogue's trending items so the dropdown agrees with Home's rail.
	 * Reads the same TTL-cached catalogue as {@link search}, so a keystroke never reaches Postgres.
	 */
	static async suggest(query: SuggestQuery): Promise<ServiceResult<Suggestions>> {
		try {
			const catalog = await loadCatalog();
			return ok(suggestFrom(catalog.items, query, Date.now(), catalog.trending));
		} catch (error) {
			return unavailable(error);
		}
	}

	/** Related search terms for a query/scope — the results-header "Related" row. */
	static async related(params: ExploreParams): Promise<ServiceResult<{ related: string[] }>> {
		try {
			return ok({ related: relatedSearches((await loadCatalog()).items, params) });
		} catch (error) {
			return unavailable(error);
		}
	}
}
