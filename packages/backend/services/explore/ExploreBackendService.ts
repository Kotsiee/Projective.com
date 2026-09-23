import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { type Catalog, loadCatalog } from "./live-catalog.ts";
import { getAnonClient } from "../../core/supabase.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { buildLiveViewPage } from "./live-view.ts";
import { getResults, groupResults, rankRecommended, relatedSearches } from "./query.ts";
import type {
	ArticleItem,
	CtaBanner,
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
	SearchPayload,
	ServiceItem,
	SponsoredSlot,
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
 * The two conversion banners Home interleaves between sections — product COPY, not data: what the
 * platform invites a visitor to do is decided by the platform, not derived from any row.
 */
const CTAS: { freelancer: CtaBanner; team: CtaBanner } = {
	freelancer: {
		id: "cta-freelancer",
		eyebrow: "Offer your skills",
		title: "Become a Freelancer",
		body:
			"Turn your craft into income. Set up services, get hired, and get paid safely at each step.",
		href: "/join?intent=freelancer",
		cta: "Start freelancing",
		tone: "primary",
	},
	team: {
		id: "cta-team",
		eyebrow: "Build together",
		title: "Launch a Team",
		body: "Assemble a micro-agency, take on bigger projects, and share the work — and the reward.",
		href: "/join?intent=team",
		cta: "Launch a team",
		tone: "neutral",
	},
};
// #endregion

// #region Composition

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
 * The reserved sponsored frames — one per ACTIVE paid placement, built from the listing it promotes.
 * A placement with no published listing behind it is skipped: an advert for something a visitor
 * cannot open is not a placement worth showing.
 */
function sponsoredSlots(catalog: Catalog): SponsoredSlot[] {
	return catalog.items
		.filter((it): it is ServiceItem | ProductItem =>
			(it.type === "services" || it.type === "products") && !!it.sponsored
		)
		.map((it) => ({
			id: `sp-${it.id}`,
			eyebrow: "Sponsored",
			title: it.title,
			body: it.summary,
			media: it.media ?? "",
			mediaPlaceholder: it.mediaPlaceholder,
			owner: it.owner,
			href: `/view/${it.id}`,
			cta: it.type === "services" ? "View service" : "View product",
		}));
}

/** The help reads Home surfaces between sections — the published articles, newest first. */
function helpArticles(catalog: Catalog): HelpArticle[] {
	return ofType(catalog, "articles")
		.slice()
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, 4)
		.map((a: ArticleItem) => ({
			id: a.id,
			title: a.title,
			minutes: a.readMinutes,
			href: `/view/${a.id}`,
		}));
}

/** The composed Home feed, from one catalogue load. */
function homeFeedFrom(catalog: Catalog): HomeFeed {
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
		sponsored: sponsoredSlots(catalog),
		helpArticles: helpArticles(catalog),
		ctas: CTAS,
		recommended: {
			services: rankRecommended(services),
			products: rankRecommended(products),
			projects: rankRecommended(projects),
			people: rankRecommended([...freelancers, ...teams]),
		},
	};
}

/** Compute a search page. The isolated feed pages over the REAL result set — no padded pool. */
function searchFrom(
	catalog: Catalog,
	params: ExploreParams,
	offset: number,
	limit: number,
): SearchPayload {
	const results = getResults(catalog.items, params);
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
	 */
	static async search(
		input: { params: ExploreParams; offset?: number; limit?: number },
	): Promise<ServiceResult<SearchPayload>> {
		const offset = Math.max(0, input.offset ?? 0);
		const limit = Math.min(FEED_MAX, Math.max(1, input.limit ?? FEED_PAGE));
		try {
			return ok(searchFrom(await loadCatalog(), input.params, offset, limit));
		} catch (error) {
			return unavailable(error);
		}
	}

	/** The composed Home discovery feed (sections + reserved promos) for State A first paint. */
	static async home(): Promise<ServiceResult<HomeFeed>> {
		try {
			return ok(homeFeedFrom(await loadCatalog()));
		} catch (error) {
			return unavailable(error);
		}
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
	 */
	static async viewPage(id: string): Promise<ServiceResult<EntityView>> {
		try {
			const catalog = await loadCatalog();
			const item = catalog.byId.get(id);
			if (!item || item.type === "users" || item.type === "freelancers" ||
				item.type === "teams" || item.type === "businesses") {
				return fail(404, { message: `No item found for id "${id}".` });
			}
			return ok(await buildLiveViewPage(catalog, item));
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
	 * sections and silently empty ones.
	 */
	static async landing(): Promise<ServiceResult<LandingPayload>> {
		const [home, testimonials, stats] = await Promise.all([
			ExploreBackendService.home(),
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

	/** Related search terms for a query/scope — the results-header "Related" row. */
	static async related(params: ExploreParams): Promise<ServiceResult<{ related: string[] }>> {
		try {
			return ok({ related: relatedSearches((await loadCatalog()).items, params) });
		} catch (error) {
			return unavailable(error);
		}
	}
}
