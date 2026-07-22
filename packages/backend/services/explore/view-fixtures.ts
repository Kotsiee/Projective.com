import { allItems } from "./query.ts";
import { lowestActivePrice } from "./query.ts";
import type {
	EntityMedia,
	EntityPricing,
	EntityReview,
	EntityView,
	ExploreItem,
	ExploreOwner,
	ReviewDistribution,
	ReviewSummary,
	TrustFact,
} from "@projective/types/explore";

/**
 * Explore — the Entity View page derivation (server side).
 *
 * The `/view/[id]` page is a composed READ over the discovery corpus: {@link buildViewPage} takes a
 * resolved {@link ExploreItem} and derives its media gallery, resolved pricing/trust facts, deliverable
 * specs, cross-sell rails, and aggregated reviews — deterministically (no RNG; SSR/resume-safe), so it
 * swaps cleanly for the discovery + reviews tables later. The app never imports this; it receives the
 * validated {@link EntityView} via SSR props + the `/api/explore/*` boundary.
 */

// #region Deterministic primitives
/** Stable unsigned string hash (djb2) — the deterministic seed for every derivation below. */
function hash(s: string): number {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
	return h >>> 0;
}

/** Self-contained Unsplash source builder (the backend cannot import the app's marketing helper). */
function unsplash(id: string, w: number, h: number): string {
	return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&h=${h}&q=72`;
}

/** Rewrite an existing Unsplash URL's crop dimensions (reused for a large `src` + a small `thumb`). */
function reshape(url: string, w: number, h: number): string {
	return url.replace(/([?&]w=)\d+/, `$1${w}`).replace(/([?&]h=)\d+/, `$1${h}`);
}

/** Format a whole-dollar amount (`240` → `"$240"`). Mirrors the app's `pricing.money`. */
function money(n: number): string {
	return `$${n.toLocaleString("en-US")}`;
}

/** Workload-intensity multipliers bracketing a Pipeline service's per-ticket price (mirrors pricing.ts). */
const PIPELINE_LOW = 0.5;
const PIPELINE_HIGH = 2.0;

/** Fixed reference clock — keeps derived review dates deterministic (SSR == island, resume-safe). */
const NOW = new Date("2026-07-01T00:00:00Z");
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** A date `monthsAgo` months before the fixed clock, as ISO + a `Mon YYYY` label. */
function monthsAgo(months: number): { iso: string; label: string } {
	const d = new Date(NOW);
	d.setUTCMonth(d.getUTCMonth() - months);
	return { iso: d.toISOString(), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}
// #endregion

// #region Media gallery
/**
 * Extra showcase crops used to build a multi-image gallery from a single-media item — deterministic
 * variety so the vertical thumbnail strip and lightbox carousel have real volume (Amazon-style).
 */
const GALLERY_POOL = [
	"1517245386807-bb43f82c33c4",
	"1522542550221-31fd19575a2d",
	"1531403009284-440f080d1e12",
	"1497366754035-f200968a6e72",
	"1497366811353-6870744d04b2",
	"1487014679447-9f8336841d58",
	"1498050108023-c5249f4df085",
	"1519389950473-47ba0277781c",
	"1506729623306-b5a934d88b53",
	"1454165804606-c3d57bc86b40",
	"1524758631624-e2822e304c36",
	"1600880292089-90a7e086ee0c",
];

/**
 * Build the hero showcase gallery. Leads with the item's own media (its cover/highlights for a
 * profile entity), then fills with a deterministic window of the shared pool so there are always
 * enough images to justify the vertical strip + the "+N" overflow into the lightbox.
 */
function galleryFor(item: ExploreItem): EntityMedia[] {
	const media: EntityMedia[] = [];
	const seen = new Set<string>();
	const push = (src: string) => {
		const key = src.replace(/[?&]w=\d+/, "").replace(/[?&]h=\d+/, "");
		if (seen.has(key)) return;
		seen.add(key);
		media.push({
			src: reshape(src, 1400, 1050),
			thumb: reshape(src, 240, 240),
			alt: `${item.title} — view ${media.length + 1}`,
			kind: "image",
		});
	};

	if (item.media) push(item.media);
	// Profile entities carry a cover + work highlights — real, on-brand extra frames.
	const cover = (item as { cover?: string }).cover;
	if (cover) push(cover);
	const highlights = (item as { highlights?: string[] }).highlights;
	if (highlights) { for (const h of highlights) push(h); }

	// Top up from the shared pool to a healthy 7 frames, windowed by the item hash.
	const seed = hash(item.id);
	const target = 7;
	for (let i = 0; media.length < target && i < GALLERY_POOL.length; i++) {
		push(unsplash(GALLERY_POOL[(seed + i) % GALLERY_POOL.length], 1400, 1050));
	}
	return media;
}
// #endregion

// #region Pricing
/**
 * Resolve the sidebar price block from the item's engagement shape — matching the card/detail helper
 * (`pricing.servicePricing`) exactly so the view agrees with the card that linked to it: Pipeline →
 * a per-ticket `0.5×–2.0×` workload range; Session → a per-session price; One-Off → the fixed string.
 */
function pricingFor(item: ExploreItem): EntityPricing {
	switch (item.type) {
		case "services": {
			if (item.serviceType === "Pipeline" && item.ticketPrice) {
				const min = Math.round(item.ticketPrice * PIPELINE_LOW);
				const max = Math.round(item.ticketPrice * PIPELINE_HIGH);
				return {
					mode: "pipeline",
					display: `${money(min)} – ${money(max)}`,
					caption: "Per ticket · scales with workload intensity",
					min,
					max,
				};
			}
			if (item.serviceType === "Session" && item.sessionPrice) {
				return {
					mode: "session",
					display: `${money(item.sessionPrice)} / session`,
					caption: "Billed per booked session",
				};
			}
			return { mode: "fixed", display: item.price, caption: "One-off fixed price" };
		}
		case "products":
			return { mode: "fixed", display: item.price, caption: "One-time purchase" };
		case "freelancers": {
			const low = item.servicePrices?.length ? lowestActivePrice(item.servicePrices) : null;
			return low === null || low === undefined
				? { mode: "quote", display: "Contact for pricing" }
				: {
					mode: "quote",
					display: `from $${low.toLocaleString("en-US")}`,
					caption: "Across active services",
				};
		}
		case "projects":
			return { mode: "quote", display: item.budget, caption: "Escrow-backed project budget" };
		default:
			return { mode: "quote", display: "Contact for pricing" };
	}
}
// #endregion

// #region Trust & deliverables
/** The operational trust chips shown under the sidebar CTAs. */
function trustFor(item: ExploreItem): TrustFact[] {
	const seed = hash(item.id);
	const responses = ["Within 1 hour", "Within 2 hours", "Within 4 hours", "Same day"];
	const facts: TrustFact[] = [
		{ icon: "response", label: "Avg. response", value: responses[seed % responses.length] },
	];
	if (item.type === "services") {
		facts.push({ icon: "delivery", label: "Delivery", value: item.delivery });
		facts.push({ icon: "revisions", label: "Revisions", value: `${1 + (seed % 3)} included` });
	} else if (item.type === "products") {
		facts.push({ icon: "delivery", label: "Access", value: "Instant download" });
		facts.push({ icon: "returns", label: "Guarantee", value: "14-day refund" });
	} else if (item.type === "projects") {
		facts.push({ icon: "delivery", label: "Stage", value: item.stage });
	}
	const topRated = (item.rating?.asHelper?.value ?? 0) >= 4.8 && !!item.owner.verified;
	facts.push({
		icon: "seller",
		label: "Seller",
		value: topRated
			? "Top Rated · verified"
			: item.owner.verified
			? "Verified seller"
			: "Active seller",
	});
	facts.push({ icon: "escrow", label: "Protection", value: "Funds held in escrow" });
	return facts;
}

/** Derive a short deliverables / key-specification list for the right details column. */
function deliverablesFor(item: ExploreItem): string[] {
	// Skills that merely restate the item's category add nothing — drop them from the spec list.
	const category = (item as { category?: string }).category?.toLowerCase();
	const extraSkills = (n: number): string[] =>
		item.skills
			.map((s) => s.label)
			.filter((l) => l.toLowerCase() !== category)
			.slice(0, n);
	switch (item.type) {
		case "services":
			return [
				`${item.serviceType} engagement`,
				item.delivery,
				`${item.category} category`,
				...extraSkills(3),
			];
		case "products":
			return [
				`${item.category} category`,
				"Instant digital download",
				"Commercial licence included",
				...extraSkills(3),
			];
		case "projects":
			return [
				`Client · ${item.org}`,
				`Stage · ${item.stage}`,
				`Budget · ${item.budget}`,
				...item.roles,
			];
		default:
			return item.skills.slice(0, 6).map((s) => s.label);
	}
}
// #endregion

// #region Cross-sell rails
/** Other items by the same creator (excluding this one) — the "More by …" rail. */
function moreByOwner(item: ExploreItem): ExploreItem[] {
	return allItems()
		.filter((it) => it.owner.handle === item.owner.handle && it.id !== item.id)
		.slice(0, 8);
}

/** The category folded for "similar" cross-sell — services/products share their `category`. */
function sameCategory(a: ExploreItem, b: ExploreItem): boolean {
	if (a.type !== b.type) return false;
	if ((a.type === "services" || a.type === "products") && "category" in b) {
		return (a as { category: string }).category === (b as { category: string }).category;
	}
	return true;
}

/** Algorithmically-adjacent items (same type/category, different owner preferred) — the "Similar" rail. */
function similarTo(item: ExploreItem): ExploreItem[] {
	const pool = allItems().filter((it) => it.id !== item.id && it.type === item.type);
	const scored = pool
		.map((it) => ({
			it,
			score: (sameCategory(item, it) ? 2 : 0) +
				(it.owner.handle !== item.owner.handle ? 1 : 0) +
				(it.owner.verified ? 1 : 0),
		}))
		.sort((a, b) => b.score - a.score);
	return scored.slice(0, 8).map((s) => s.it);
}
// #endregion

// #region Reviews
/** A small deterministic authorship pool for derived reviews. */
const REVIEW_AUTHORS: ExploreOwner[] = [
	{
		handle: "@priyakapoor",
		name: "Priya Kapoor",
		avatar: unsplash("1438761681033-6461ffad8d80", 96, 96),
		kind: "user",
		verified: true,
	},
	{
		handle: "@dmitrivolkov",
		name: "Dmitri Volkov",
		avatar: unsplash("1500648767791-00dcc994a43e", 96, 96),
		kind: "user",
	},
	{
		handle: "@saoirse",
		name: "Saoirse Byrne",
		avatar: unsplash("1544005313-94ddf0286df2", 96, 96),
		kind: "user",
		verified: true,
	},
	{
		handle: "@tomoki",
		name: "Tomoki Sato",
		avatar: unsplash("1506794778202-cad84cf45f1d", 96, 96),
		kind: "user",
	},
	{
		handle: "@amaraokafor",
		name: "Amara Okafor",
		avatar: unsplash("1534528741775-53994a69daeb", 96, 96),
		kind: "business",
		verified: true,
	},
	{
		handle: "@lucasmoreau",
		name: "Lucas Moreau",
		avatar: unsplash("1507591064344-4c6ce005b128", 96, 96),
		kind: "user",
	},
];

const REVIEW_TITLES = [
	"Exceptional work, exactly to brief",
	"Fast, communicative, and thorough",
	"Elevated our whole product",
	"Would hire again in a heartbeat",
	"Great value for the quality",
	"Professional from start to finish",
];

const REVIEW_BODIES = [
	"Delivery was ahead of schedule and the quality bar was consistently high. Every revision was handled without friction and the final result exceeded what we scoped.",
	"Communication was clear the whole way through — regular updates, thoughtful questions, and a real sense of ownership over the outcome. Escrow made the whole thing painless.",
	"The craft here is genuinely a cut above. They pushed back on a few decisions in exactly the right way and the end product is better for it.",
	"Reliable, precise, and easy to work with. The deliverables were well-documented and needed almost no rework on our side.",
	"Turned a vague brief into something polished and on-brand. Turnaround was quick and the handoff was clean.",
];

/**
 * Build the aggregated review summary + a deterministic review list from the item's stored reputation.
 * The distribution is a plausible histogram concentrated around the average; the list samples the
 * authorship pool by item hash so it is stable across renders.
 */
function reviewsFor(item: ExploreItem): { summary: ReviewSummary; list: EntityReview[] } {
	const helper = item.rating?.asHelper;
	const client = item.rating?.asClient;
	const primary = helper ?? client;
	const average = primary?.value ?? 4.8;
	const count = primary?.count ?? 24;

	// A histogram peaked at the rounded average, tapering to the tails — deterministic, sums to `count`.
	const peak = Math.min(5, Math.max(1, Math.round(average)));
	const weights = [0, 0, 0, 0, 0].map((_, i) => {
		const star = i + 1;
		return Math.max(1, 12 - Math.abs(star - peak) * 5);
	});
	const wSum = weights.reduce((a, b) => a + b, 0);
	const distribution = weights.map((w) =>
		Math.round((w / wSum) * count)
	) as unknown as ReviewDistribution;

	const summary: ReviewSummary = {
		average,
		count,
		distribution,
		asHelper: helper,
		asClient: client,
	};

	const seed = hash(item.id);
	const n = Math.min(5, Math.max(3, 3 + (seed % 3)));
	const list: EntityReview[] = [];
	for (let i = 0; i < n; i++) {
		const k = (seed + i * 7) % REVIEW_AUTHORS.length;
		// Ratings cluster at/just below the average so the list agrees with the summary.
		const rating = Math.min(5, Math.max(3, Math.round(average) - (i % 2)));
		const when = monthsAgo(i + 1 + (seed % 4));
		list.push({
			id: `${item.id}-rev-${i}`,
			author: REVIEW_AUTHORS[k],
			rating,
			track: helper ? "helper" : "client",
			title: REVIEW_TITLES[(seed + i) % REVIEW_TITLES.length],
			body: REVIEW_BODIES[(seed + i * 3) % REVIEW_BODIES.length],
			createdAt: when.iso,
			dateLabel: when.label,
			reciprocal: (seed + i) % 3 === 0,
			verifiedEngagement: (seed + i) % 4 !== 0,
		});
	}
	return { summary, list };
}
// #endregion

/** Compose the full Entity View payload for a resolved discovery item. */
export function buildViewPage(item: ExploreItem): EntityView {
	return {
		item,
		gallery: galleryFor(item),
		pricing: pricingFor(item),
		trust: trustFor(item),
		deliverables: deliverablesFor(item),
		moreByOwner: moreByOwner(item),
		similar: similarTo(item),
		reviews: reviewsFor(item),
	};
}
