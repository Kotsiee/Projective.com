import { allItems } from "./query.ts";
import { lowestActivePrice } from "./query.ts";
import { PIPELINE_HIGH, PIPELINE_LOW } from "./pricing.ts";
import { resolveSkills } from "./skills.ts";
import { findProfile } from "../profile/profile-fixtures.ts";
import type {
	ArticleAsset,
	ArticleBlock,
	ArticleComment,
	ArticleTocEntry,
	ArticleViewExtra,
	EntityMedia,
	EntityPricing,
	EntityReview,
	EntityView,
	ExploreItem,
	ExploreOwner,
	ProductCompat,
	ProductFile,
	ProductLicence,
	ProductPreview,
	ProductSpec,
	ProductViewExtra,
	ProjectFinance,
	ProjectMetric,
	ProjectStage,
	ProjectStageStatus,
	ProjectViewExtra,
	ReviewDistribution,
	ReviewSummary,
	ServiceModel,
	ServiceRole,
	ServiceViewExtra,
	SkillRef,
	StageRevisions,
	StageRole,
	StageSeatKind,
	TicketPrice,
	TrustFact,
} from "@projective/types/explore";
import { revisionAllowanceKind } from "@projective/types/explore";
import type {
	ArticleItem,
	ProductFormat,
	ProductItem,
	ProjectItem,
	ServiceItem,
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

// The workload-intensity multipliers come from the shared numeric pricing primitives
// (`./pricing.ts`) so the card, this view, and a basket line cannot bracket a pipeline differently.

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
			if (item.serviceType === "Group Session" && item.sessionPrice) {
				return {
					mode: "session",
					display: `${money(item.sessionPrice)} / seat`,
					caption: "Per attendee seat · booked per session",
				};
			}
			if (item.serviceType === "Direct Deliverable") {
				return { mode: "fixed", display: item.price, caption: "Fixed scope · one payment" };
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
			return { mode: "quote", display: item.budget, caption: "Project budget" };
		case "articles":
			return { mode: "quote", display: "Free to read", caption: `${item.readMinutes} min read` };
		default:
			return { mode: "quote", display: "Contact for pricing" };
	}
}
// #endregion

// #region Trust & deliverables
/**
 * The seller's median first-reply time, in MINUTES.
 *
 * A number rather than the sentence it used to be, because two consumers need it and only one of them
 * wants prose: the trust row prints "Within 1 hour", and the conversion lane's "Fast replies" badge
 * has to compare it against a threshold. Deriving the badge by matching the English string would make
 * a gate out of presentation text, so a copy change would silently retire a badge.
 *
 * Same seed and same ladder order as the string list it replaces, so every listing keeps the response
 * time it already had.
 */
function responseMinutesFor(item: ExploreItem): number {
	// 1h · 2h · 4h · same day, in the order the old string list declared them.
	const ladder = [60, 120, 240, 600];
	return ladder[hash(item.id) % ladder.length];
}

/** The response time as the trust row states it — formatted FROM the minutes, never beside them. */
function responseLabel(minutes: number): string {
	if (minutes >= 600) return "Same day";
	const hours = minutes / 60;
	return `Within ${hours} hour${minutes === 60 ? "" : "s"}`;
}

/** The operational trust chips shown under the sidebar CTAs. */
function trustFor(item: ExploreItem): TrustFact[] {
	const facts: TrustFact[] = [
		{ icon: "response", label: "Avg. response", value: responseLabel(responseMinutesFor(item)) },
	];
	if (item.type === "services") {
		facts.push({ icon: "delivery", label: "Delivery", value: item.delivery });
		/*
		 * The DECLARED allowance, classified by the SAME SSOT rule the stage ledger uses. This row and
		 * that one are one commitment stated in two places: a listing that told a buyer "2 included"
		 * here and "unlimited revisions" on every stage would be describing two different offers on one
		 * screen, and the reader has no way to tell which is the real one.
		 */
		const revisions = stageRevisions(item, 0);
		facts.push({
			icon: "revisions",
			label: "Revisions",
			value: revisionValue(revisions),
		});
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

// #region Shared derivation helpers
/** Slugify a heading/phase into a stable in-page anchor fragment. */
function slugify(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) ||
		"section";
}

/** Parse the leading currency amount out of a budget string (`"$54,000 held safe"` → `54000`). */
function parseMoney(s: string): number {
	const n = Number.parseFloat(s.replace(/[^0-9.]/g, ""));
	return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Round to the nearest `step` (finance figures read cleaner at $10 granularity). */
function roundTo(n: number, step: number): number {
	return Math.max(step, Math.round(n / step) * step);
}

/** A deterministic amplitude envelope for a stubbed audio clip (0..1, `count` bars). */
function peaksFor(seed: number, count = 56): number[] {
	const bars: number[] = [];
	for (let i = 0; i < count; i++) {
		const a = Math.abs(Math.sin(seed * 0.013 + i * 0.5));
		const b = Math.abs(Math.sin(seed * 0.007 + i * 0.19));
		bars.push(Math.min(1, 0.22 + 0.72 * (a * 0.6 + b * 0.4)));
	}
	return bars;
}

/** `m:ss` clock label for a duration in ms. */
function clock(ms: number): string {
	const total = Math.round(ms / 1000);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Format a `YYYY-MM-DD`-ish ISO date as `Mon D, YYYY`. */
function longDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
// #endregion

// #region Project view derivation
/** Generic contributor roles topped up onto a project's own role list when a stage needs more seats. */
const FALLBACK_ROLES = ["Contributor", "Reviewer", "Specialist", "Lead", "Coordinator"];

/** Build a fixed per-ticket price (`min === max`) with its pre-formatted label. */
function ticketFixed(n: number): TicketPrice {
	const v = roundTo(n, 10);
	return { min: v, max: v, label: `${money(v)} / ticket` };
}

/** Build a per-ticket price — collapses to a fixed price when the rounded bounds coincide. */
function ticketRange(lo: number, hi: number): TicketPrice {
	const min = roundTo(Math.min(lo, hi), 10);
	const max = roundTo(Math.max(lo, hi), 10);
	return min === max
		? { min, max, label: `${money(min)} / ticket` }
		: { min, max, label: `${money(min)} – ${money(max)} / ticket` };
}

/** The spanning per-ticket range across a set of role prices (min of mins → max of maxs). */
function spanningPrice(roles: StageRole[]): TicketPrice {
	if (!roles.length) return ticketFixed(0);
	const min = Math.min(...roles.map((r) => r.price.min));
	const max = Math.max(...roles.map((r) => r.price.max));
	return ticketRange(min, max);
}

/** Per-stage descriptive copy — deterministic, references the stage + project, no RNG. */
function stageDescription(stageName: string, project: ProjectItem, i: number): string {
	const n = stageName.toLowerCase();
	const templates = [
		`Establish the ${n} for ${project.title}: agree the scope, open the first tickets, and lock the acceptance criteria every contributor delivers against.`,
		`Deliver the ${n} in reviewable increments. Each ticket is priced up front and paid on client acceptance of the submission.`,
		`Harden and hand off the ${n} — documentation, QA, and the migration notes the following stage depends on.`,
		`Drive adoption of the ${n} across ${project.org}'s teams, closing out revisions and final acceptance before sign-off.`,
	];
	return templates[i % templates.length];
}

/** A general "open seats" pool summary for a stage that recruits from a shared contributor pool. */
function seatPoolSummary(stageName: string): string {
	return `Open to any qualified contributor — ${stageName.toLowerCase()} tickets are claimed from a shared seat pool, each paying its listed ticket price on acceptance.`;
}

/** Pick `n` role titles for a stage, rotating through the project roles then generics. */
function pickRoleNames(pool: string[], n: number, offset: number): string[] {
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(pool[(offset + i) % pool.length]);
	return out;
}

/** Turn role titles into full {@link StageRole}s — each with an open-seat count + fixed/range price. */
function buildRoles(names: string[], baseTicket: number, seed: string): StageRole[] {
	return names.map((name, ri) => {
		const rh = hash(`${seed}:${name}:${ri}`);
		const p = baseTicket * (0.8 + (rh % 7) / 10); // 0.8×–1.4×
		// Every third role prices its tickets as a workload range; the rest are a single fixed price.
		const price = rh % 3 === 0 ? ticketRange(p * 0.75, p * 1.6) : ticketFixed(p);
		return { name, openSeats: 1 + (rh % 2), price }; // 1–2 open seats per role
	});
}

/** Merge a stage's role-derived skills with the project's own, de-duplicated, capped. */
function stageSkills(roleNames: string[], projectSkills: SkillRef[], seed: number): SkillRef[] {
	const merged = [...resolveSkills(roleNames.slice(0, 2)), ...projectSkills];
	const seen = new Set<string>();
	const unique: SkillRef[] = [];
	for (const s of merged) {
		const key = s.label.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(s);
	}
	const start = seed % Math.max(1, unique.length);
	// Rotate so different stages surface different skills, then cap at four tags.
	return [...unique.slice(start), ...unique.slice(0, start)].slice(0, 4);
}

/** The single delivery stage for a **One-Off** project — recruits its named roles at fixed prices. */
function oneOffStage(project: ProjectItem): ProjectStage {
	const seed = hash(project.id);
	const budget = parseMoney(project.budget);
	const baseTicket = roundTo(budget / 20, 10) || 120;
	const names = project.roles.length ? project.roles : ["Contributor"];
	const roles = buildRoles(names, baseTicket, `${project.id}:one-off`);
	const openSeats = roles.reduce((a, r) => a + r.openSeats, 0);
	return {
		id: `stage-1-${slugify(project.title)}`,
		index: 1,
		name: "Full delivery",
		description:
			`Deliver ${project.title} as a single, self-contained engagement — one agreed scope, one set of tickets, and a fixed ticket price paid on acceptance of the completed work.`,
		status: "active",
		seatKind: "roles",
		openSeats,
		seatsTotal: openSeats,
		seatsFilled: 0,
		roles,
		price: spanningPrice(roles),
		skills: stageSkills(names, project.skills, seed),
	};
}

/** Derive the multi-stage pipeline for a **Pipeline** project from its phases/roles/budget. */
function pipelineStages(project: ProjectItem): ProjectStage[] {
	const phases = project.phases.length ? project.phases : [project.stage || "Delivery"];
	const budget = parseMoney(project.budget);
	// The base per-ticket price scales the budget across a plausible ticket count.
	const baseTicket = roundTo(budget / Math.max(1, phases.length * 14), 10) || 80;
	const rolePool = [...project.roles, ...FALLBACK_ROLES];

	// Active stage: read a "Step N" out of the stage label, else land a little past the start.
	const stepMatch = project.stage.match(/step\s*(\d+)/i);
	const activeIdx = Math.max(
		0,
		Math.min(
			phases.length - 1,
			stepMatch ? Number(stepMatch[1]) - 1 : Math.floor(phases.length * 0.4),
		),
	);

	return phases.map((name, i) => {
		const s = hash(`${project.id}:${name}:${i}`);
		const status: ProjectStageStatus = i < activeIdx
			? "completed"
			: i === activeIdx
			? "active"
			: "upcoming";
		// Alternate the two opening structures so a pipeline demonstrates both (§Part 4).
		const seatKind: StageSeatKind = i % 2 === 0 ? "roles" : "seats";
		const alreadyStaffed = 1 + (s % 2); // seats filled once recruiting starts
		const skillNames = pickRoleNames(rolePool, 2, i + (s % rolePool.length));
		const common = {
			id: `stage-${i + 1}-${slugify(name)}`,
			index: i + 1,
			name,
			description: stageDescription(name, project, i),
			status,
			skills: stageSkills(skillNames, project.skills, s),
		};

		// Completed stages are fully staffed — no live openings.
		if (status === "completed") {
			const total = alreadyStaffed + 1;
			return {
				...common,
				seatKind,
				openSeats: 0,
				seatsTotal: total,
				seatsFilled: total,
				roles: [],
				seatSummary: seatKind === "seats"
					? "All seats filled — this stage is complete."
					: undefined,
				price: ticketFixed(baseTicket * (0.8 + (s % 7) / 10)),
			};
		}

		const filled = status === "active" ? alreadyStaffed : 0;
		if (seatKind === "roles") {
			const names = pickRoleNames(rolePool, 2 + (s % 2), i + (s % rolePool.length)); // 2–3 roles
			const roles = buildRoles(names, baseTicket, common.id);
			const openSeats = roles.reduce((a, r) => a + r.openSeats, 0);
			return {
				...common,
				seatKind,
				openSeats,
				seatsTotal: openSeats + filled,
				seatsFilled: filled,
				roles,
				price: spanningPrice(roles),
			};
		}

		// Open-seats pool.
		const openSeats = 2 + (s % 3); // 2–4 open
		const p = baseTicket * (0.8 + (s % 7) / 10);
		return {
			...common,
			seatKind,
			openSeats,
			seatsTotal: openSeats + filled,
			seatsFilled: filled,
			roles: [],
			seatSummary: seatPoolSummary(name),
			// Half the seat pools price as a workload range, the rest as a single fixed ticket price.
			price: s % 2 === 0 ? ticketFixed(p) : ticketRange(p * 0.7, p * 1.5),
		};
	});
}

/** Compose the projects-only view extension (chrome banner + stage flow + finance + metrics). */
function projectViewFor(project: ProjectItem): ProjectViewExtra {
	const seed = hash(project.id);
	const isPipeline = project.classification === "pipeline";
	const stages = isPipeline ? pipelineStages(project) : [oneOffStage(project)];

	const openSeats = stages.reduce((a, s) => a + s.openSeats, 0);
	const totalSeats = stages.reduce((a, s) => a + s.seatsTotal, 0);
	// The project-wide ticket price spans every stage's bounds — collapses to fixed for a One-Off.
	const minTicket = Math.min(...stages.map((s) => s.price.min));
	const maxTicket = Math.max(...stages.map((s) => s.price.max));
	const ticketPrice = ticketRange(minTicket, maxTicket);

	const finance: ProjectFinance = { ticketPrice, openSeats, totalSeats };

	// Resolve the uploader's profile for chrome parity (banner/headline) — falls back deterministically.
	const prof = findProfile(project.owner.handle);
	const banner = prof?.banner ?? unsplash(GALLERY_POOL[seed % GALLERY_POOL.length], 1600, 460);
	const classificationLabel = isPipeline ? "Pipeline" : "One-Off";

	// Type-tailored metric chips (§Part 3): stages/current-stage only surface for a Pipeline.
	const metrics: ProjectMetric[] = [
		{ icon: "type", label: "Type", value: classificationLabel },
	];
	if (isPipeline) metrics.push({ icon: "stages", label: "Stages", value: `${stages.length}` });
	metrics.push({ icon: "ticket", label: "Ticket price", value: ticketPrice.label });
	metrics.push({ icon: "seats", label: "Open seats", value: `${openSeats}` });

	return {
		banner,
		ownerHeadline: prof?.headline ?? `${project.org} · Project owner`,
		ownerVerified: prof?.verified ?? project.owner.verified ?? false,
		classification: project.classification,
		classificationLabel,
		stage: isPipeline ? project.stage : undefined,
		stages,
		finance,
		metrics,
	};
}
// #endregion

// #region Service view derivation
/** The normalised delivery-model key each {@link ServiceType} dispatches on. */
const SERVICE_MODEL: Record<ServiceItem["serviceType"], ServiceModel> = {
	"Pipeline": "pipeline",
	"One-Off": "one-off",
	"Direct Deliverable": "direct",
	"Session": "session",
	"Group Session": "group-session",
};

/** The workflow phases a **Pipeline** service showcases (billed per ticket). */
const PIPELINE_PHASES = [
	"Discovery & scope",
	"Design & build",
	"Review & revisions",
	"Handoff & launch",
];
/** The milestones a **One-Off** service showcases (each a fixed-price increment). */
const ONEOFF_MILESTONES = ["Kickoff & scope", "Production", "Final handoff"];

/** Deterministic per-stage turnaround labels. */
const STAGE_TURNAROUNDS = ["~2 days", "~4 days", "~1 week", "~3 days", "~5 days"];

/** Bucket a phase name into its intent, so deliverables + copy stay coherent across both models. */
type PhaseKind = "discovery" | "build" | "review" | "handoff" | "generic";
function phaseKind(name: string): PhaseKind {
	const n = name.toLowerCase();
	if (/scope|discovery|kickoff/.test(n)) return "discovery";
	if (/review|revision/.test(n)) return "review";
	if (/handoff|launch|final/.test(n)) return "handoff";
	if (/build|design|production/.test(n)) return "build";
	return "generic";
}

/** Concrete deliverables per phase intent — the "what you get" bullets in the expanded stage card. */
const STAGE_DELIVERABLES: Record<PhaseKind, string[]> = {
	discovery: ["Agreed scope & success criteria", "Kickoff notes and a delivery timeline"],
	build: ["First-round output for review", "Working source files"],
	review: ["Feedback folded in across the agreed revision rounds", "Consolidated change log"],
	handoff: ["Production-ready final files", "Handoff guide & asset package"],
	generic: ["A reviewable milestone increment", "Updated project notes"],
};

/** Per-phase descriptive copy, keyed on intent and referencing the service. */
function serviceStageDescription(kind: PhaseKind, service: ServiceItem): string {
	const t = service.title.toLowerCase();
	switch (kind) {
		case "discovery":
			return `Kick off ${service.title}: align on the scope, the success criteria, and the plan every following stage delivers against.`;
		case "build":
			return `The core of the engagement — ${t} takes shape here as reviewable, on-brief output.`;
		case "review":
			return `Refine and revise: your feedback is folded in across the agreed revision rounds until the bar is met.`;
		case "handoff":
			return `Wrap up and hand over — production-ready files, documentation, and everything you need to launch.`;
		default:
			return `Deliver ${t} in a reviewable increment, accepted before the next stage begins.`;
	}
}

/**
 * The seller's declared free-revision allowance, or the corpus default when they have not set one.
 *
 * The fallback is deterministic (id hash) rather than zero, because zero is a CLAIM — "no revisions
 * are included" — and a listing that simply has not filled the field in has made no such claim.
 */
function freeRevisionsOf(service: ServiceItem): number {
	return service.freeRevisions ?? 1 + (hash(service.id) % 3);
}

/**
 * The per-round cost of a revision beyond the free allowance, as a {@link TicketPrice}.
 *
 * A revision is billed as a ticket, so it reuses the ticket shape rather than forking a second money
 * projection that could round the same amount differently. An undeclared price falls back to a
 * fraction of the stage's own ticket price — a revision costs less than the stage it revises — and a
 * DECLARED `0` is preserved as free rather than being treated as missing.
 */
function revisionPrice(service: ServiceItem, stageTicket: number): TicketPrice {
	const declared = service.extraRevisionPrice;
	if (declared === 0) return { min: 0, max: 0, label: "Free" };
	const amount = declared ?? Math.max(20, roundTo(stageTicket * 0.5, 10));
	return ticketFixed(amount);
}

/** The stage-level revision allowance a service stage inherits from its listing. */
function stageRevisions(service: ServiceItem, stageTicket: number): StageRevisions {
	return { free: freeRevisionsOf(service), extraPrice: revisionPrice(service, stageTicket) };
}

/** The trust row's one-line statement of the allowance — same classification as the stage ledger's. */
function revisionValue(revisions: StageRevisions): string {
	switch (revisionAllowanceKind(revisions)) {
		case "unlimited":
			return "Unlimited";
		case "metered":
			return "Billed per round";
		default:
			return `${revisions.free} included per stage`;
	}
}

/**
 * Derive the stage showcase for a **Pipeline** / **One-Off** service — a workflow the client previews
 * before buying (sequence · per-stage deliverables · turnaround · dependency · price), mirroring the
 * Projects view's Stage Flow. Unlike a project it recruits no seats, so the seat/role machinery is
 * zeroed (the visualizer hides it); a Pipeline prices each stage as a per-ticket range, a One-Off as a
 * fixed milestone amount.
 */
function serviceStages(service: ServiceItem, model: ServiceModel): ProjectStage[] {
	const isPipeline = model === "pipeline";
	const phases = isPipeline ? PIPELINE_PHASES : ONEOFF_MILESTONES;
	const total = parseMoney(service.price);
	const baseTicket = service.ticketPrice ?? roundTo(Math.max(80, total / (phases.length * 6)), 10);
	const milestone = roundTo(total / phases.length, 10) || baseTicket;

	return phases.map((name, i) => {
		const s = hash(`${service.id}:${name}:${i}`);
		const kind = phaseKind(name);
		const f = 0.8 + (s % 5) / 10; // 0.8×–1.2× per-stage variance
		const price = isPipeline
			? ticketRange(baseTicket * PIPELINE_LOW * f, baseTicket * PIPELINE_HIGH * f)
			: { min: milestone, max: milestone, label: money(milestone) };
		return {
			id: `stage-${i + 1}-${slugify(name)}`,
			index: i + 1,
			name,
			description: serviceStageDescription(kind, service),
			status: "upcoming" as ProjectStageStatus,
			seatKind: "seats" as StageSeatKind,
			openSeats: 0,
			seatsTotal: 0,
			seatsFilled: 0,
			roles: [],
			price,
			skills: stageSkills([], service.skills, s),
			deliverables: STAGE_DELIVERABLES[kind],
			turnaround: STAGE_TURNAROUNDS[s % STAGE_TURNAROUNDS.length],
			dependency: i > 0 ? `After ${phases[i - 1]}` : undefined,
			revisions: stageRevisions(service, price.min),
		};
	});
}

/** Named-role sets for a **Direct Deliverable** service's team breakdown, keyed by service category. */
const DIRECT_ROLE_SETS: Record<string, string[]> = {
	branding: ["Lead Designer", "Brand Strategist", "Production Artist"],
	design: ["Lead Designer", "Design Systems Specialist", "Reviewer"],
	product: ["Product Designer", "Engineer", "QA Reviewer"],
	motion: ["Art Director", "Motion Designer", "Sound Designer"],
	content: ["Lead Editor", "Copywriter", "Reviewer"],
	web: ["Lead Developer", "Designer", "QA Reviewer"],
};
const DIRECT_ROLE_FALLBACK = ["Lead", "Specialist", "Reviewer"];

/** A one-line remit for a defined role, inferred from its title. */
function roleSummary(name: string): string {
	const n = name.toLowerCase();
	if (/lead|director/.test(n)) return "Owns the direction and signs off the final deliverable.";
	if (/review|qa/.test(n)) {
		return "Checks the work against the brief and acceptance criteria before delivery.";
	}
	if (/strateg/.test(n)) return "Frames the approach and positioning the work delivers against.";
	if (/copy|editor|writ/.test(n)) {
		return "Writes and edits the words that ship with the deliverable.";
	}
	if (/engineer|developer/.test(n)) return "Builds and ships the working implementation.";
	if (/sound/.test(n)) return "Designs and mixes the audio for the deliverable.";
	return "Produces their part of the agreed scope to spec.";
}

/** Derive the defined project-team roles for a **Direct Deliverable** service (the right-column block). */
function serviceRoles(service: ServiceItem): ServiceRole[] {
	const names = DIRECT_ROLE_SETS[service.category.toLowerCase()] ?? DIRECT_ROLE_FALLBACK;
	const skills = service.skills;
	return names.map((name, i) => ({
		name,
		summary: roleSummary(name),
		skills: skills.length ? [...skills.slice(i), ...skills.slice(0, i)].slice(0, 2) : [],
		count: 1,
	}));
}

/** Compose the services-only view extension (delivery model + stage showcase / roles / booking flags). */
/**
 * Read a session listing's block size and slot length out of the copy it already publishes.
 *
 * `"6 × 45-minute sessions"` → `{ count: 6, minutes: 45 }`; `"60-minute session"` → `{ minutes: 60 }`.
 *
 * Derived from the listing's OWN words rather than from its id hash, and that is a correction rather
 * than a refinement. A hash decided whether a Session was a single booking or a block, which meant the
 * corpus's one Session listing landed on whichever branch its hash happened to give — measured, that
 * left `set_session` UNREACHABLE across the whole running app, so a whole booking flow was dead code
 * that no amount of clicking could find. It also let the CTA say "Book session" over a card whose
 * delivery line read "6 × 45-minute sessions".
 *
 * Anything the pattern does not match returns `null` and the caller falls back to the hash, so a
 * listing whose copy says nothing about cadence still gets a plausible slot length.
 */
function parseSessionCopy(delivery: string): { count?: number; minutes?: number } | null {
	const block = delivery.match(/(\d+)\s*[x×]\s*(\d+)\s*-?\s*min/i);
	if (block) return { count: Number(block[1]), minutes: Number(block[2]) };
	const single = delivery.match(/(\d+)\s*-?\s*min/i);
	if (single) return { minutes: Number(single[1]) };
	return null;
}

function serviceViewFor(service: ServiceItem): ServiceViewExtra {
	const model = SERVICE_MODEL[service.serviceType];
	const showcaseStages = model === "pipeline" || model === "one-off";
	const bookable = model === "session" || model === "group-session";
	const group = model === "group-session";
	const seed = hash(service.id);
	const seatsPerSession = group ? 8 + (seed % 9) : undefined; // 8–16

	/*
	 * Session length and block size.
	 *
	 * Both derive from the id so a listing's grid, its price-per-session and its "Book 6 sessions"
	 * label agree across every surface and across a resume. The block size is 1 for a group session —
	 * a cohort seat is one enrolment in a recurring series, not a package of bookings — and for a 1-1
	 * it is 1 unless the hash lands in the minority that makes the set-session flow reachable at all.
	 * Without that minority the whole `set_session` branch would be dead code in the corpus, which is
	 * how a flow ships untested.
	 */
	const declared = bookable ? parseSessionCopy(service.delivery) : null;
	const sessionMinutes = bookable ? declared?.minutes ?? [45, 60, 90][seed % 3] : undefined;
	const sessionCount = model === "session" ? declared?.count ?? 1 : undefined;

	const bookingSummary = bookable
		? group
			? `${service.delivery} · up to ${seatsPerSession} seats`
			: (sessionCount ?? 1) > 1
			? `${sessionCount} × ${sessionMinutes} min sessions`
			: service.delivery
		: undefined;

	return {
		model,
		modelLabel: service.serviceType,
		showcaseStages,
		stages: showcaseStages ? serviceStages(service, model) : [],
		roles: model === "direct" ? serviceRoles(service) : [],
		bookable,
		group,
		seatsPerSession,
		bookingSummary,
		sessionCount,
		sessionMinutes,
	};
}
// #endregion

// #region Article view derivation
/** Plain-English, platform-flavoured prose pool — composed deterministically per article. */
const ARTICLE_PARAS = [
	"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.",
	"The short version: you never pay for work you haven't seen, and freelancers never deliver work they won't be paid for. The platform sits in the middle and releases funds only when a stage is accepted.",
	"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.",
	"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.",
	"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.",
	"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.",
	"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.",
	"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.",
];

const ARTICLE_LISTS: string[][] = [
	[
		"Agree the scope and the definition of done before any money moves.",
		"Fund the first stage — it sits safely in escrow until you accept it.",
		"Review the submission, request revisions if needed, then release.",
		"Repeat for each stage; you only ever have one in flight.",
	],
	[
		"Keep the brief short and specific — one outcome per ticket.",
		"Use the stage channel for questions so the history stays in one place.",
		"Accept promptly once a stage meets the bar; it releases the escrow.",
		"Leave a review — it feeds both sides' reputation tracks.",
	],
];

/** A neutral, freely-embeddable placeholder clip for the demo YouTube facade (Big Buck Bunny, CC). */
const DEMO_VIDEO_ID = "aqz-KE-bpKQ";

const COMMENT_BODIES = [
	"This is the clearest explanation of escrow I've read — finally sent it to a client who was nervous about paying up front.",
	"The stage-by-stage bit is the part that clicked for me. Being able to stop after any stage is what sold me.",
	"Would love a follow-up on how revisions interact with the escrow release. Otherwise, really helpful.",
	"Bookmarking this. The ticket definition-of-done framing is exactly how I brief my own team now.",
	"Great read. The audio version was a nice touch for a commute.",
];

const COMMENT_REPLIES = [
	"Totally agree — the one-stage-in-flight rule is underrated.",
	"Glad it helped! There's a deeper guide on revisions coming soon.",
	"Same here, shared it with my whole studio.",
];

/** Derive the rich article body (headings, prose, image, YouTube, audio, list, quote) + TOC. */
function articleBlocksAndToc(
	article: ArticleItem,
): { blocks: ArticleBlock[]; toc: ArticleTocEntry[]; assets: ArticleAsset[] } {
	const seed = hash(article.id);
	const pick = (arr: string[], k: number) => arr[(seed + k) % arr.length];
	const cover = article.media ?? unsplash(GALLERY_POOL[seed % GALLERY_POOL.length], 1400, 800);
	const inlineImg = unsplash(GALLERY_POOL[(seed + 3) % GALLERY_POOL.length], 1400, 800);
	const videoPoster = unsplash(GALLERY_POOL[(seed + 6) % GALLERY_POOL.length], 1200, 675);
	const audioPoster = unsplash(GALLERY_POOL[(seed + 9) % GALLERY_POOL.length], 480, 480);
	const durationMs = 90000 + (seed % 120) * 1000;

	const blocks: ArticleBlock[] = [];
	const toc: ArticleTocEntry[] = [];
	let n = 0;
	const heading = (text: string, level: 2 | 3) => {
		const id = `${slugify(text)}-${++n}`;
		blocks.push({ type: level === 2 ? "heading" : "subheading", id, text });
		toc.push({ id, text, level });
	};

	// Intro (no heading — leads the body).
	blocks.push({
		type: "paragraph",
		text: `${article.summary} Here's the practical version, without the jargon.`,
	});
	blocks.push({ type: "paragraph", text: pick(ARTICLE_PARAS, 0) });

	heading("Why this matters", 2);
	blocks.push({ type: "paragraph", text: pick(ARTICLE_PARAS, 1) });
	blocks.push({ type: "paragraph", text: pick(ARTICLE_PARAS, 2) });
	blocks.push({
		type: "image",
		src: reshape(cover, 1400, 800),
		thumb: reshape(cover, 240, 240),
		alt: article.title,
		caption: `${article.title} — the flow at a glance.`,
	});

	heading("How it actually works", 2);
	heading("Step by step", 3);
	blocks.push({ type: "paragraph", text: pick(ARTICLE_PARAS, 3) });
	blocks.push({ type: "list", items: ARTICLE_LISTS[seed % ARTICLE_LISTS.length] });
	heading("In practice", 3);
	blocks.push({ type: "paragraph", text: pick(ARTICLE_PARAS, 4) });
	blocks.push({
		type: "image",
		src: reshape(inlineImg, 1400, 800),
		thumb: reshape(inlineImg, 240, 240),
		alt: `${article.topic} in practice`,
		caption: "Every stage carries its own channel, submissions, and escrow.",
	});
	blocks.push({
		type: "youtube",
		videoId: DEMO_VIDEO_ID,
		title: "Watch: a two-minute walkthrough",
		caption: "A quick visual walkthrough of the flow described above.",
		thumb: videoPoster,
	});

	heading("A worked example", 2);
	blocks.push({ type: "paragraph", text: pick(ARTICLE_PARAS, 5) });
	blocks.push({
		type: "audio",
		src: "#",
		title: "Listen: the example, narrated",
		durationMs,
		durationLabel: clock(durationMs),
		peaks: peaksFor(seed),
		thumb: audioPoster,
	});
	blocks.push({ type: "paragraph", text: pick(ARTICLE_PARAS, 6) });

	heading("Common questions", 2);
	heading("What if something goes wrong?", 3);
	blocks.push({ type: "list", items: ARTICLE_LISTS[(seed + 1) % ARTICLE_LISTS.length] });

	heading("Where to go next", 2);
	blocks.push({ type: "paragraph", text: pick(ARTICLE_PARAS, 7) });
	blocks.push({
		type: "quote",
		text:
			"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.",
	});

	// Collect every media asset used above for the bottom gallery carousel.
	const assets: ArticleAsset[] = [
		{
			kind: "image",
			src: reshape(cover, 1200, 900),
			thumb: reshape(cover, 480, 480),
			label: "Cover",
		},
		{
			kind: "image",
			src: reshape(inlineImg, 1200, 900),
			thumb: reshape(inlineImg, 480, 480),
			label: "In practice",
		},
		{
			kind: "video",
			src: videoPoster,
			thumb: reshape(videoPoster, 480, 480),
			label: "Walkthrough",
			durationLabel: "2:04",
		},
		{
			kind: "audio",
			src: "#",
			thumb: reshape(audioPoster, 480, 480),
			label: "Narrated example",
			durationLabel: clock(durationMs),
		},
	];

	return { blocks, toc, assets };
}

/** Compose the articles-only view extension (rich body + TOC + assets + comments). */
function articleViewFor(article: ArticleItem): ArticleViewExtra {
	const seed = hash(article.id);
	const { blocks, toc, assets } = articleBlocksAndToc(article);

	const comments: ArticleComment[] = [];
	const commentCount = 3 + (seed % 3); // 3–5
	for (let i = 0; i < commentCount; i++) {
		const author = REVIEW_AUTHORS[(seed + i * 5) % REVIEW_AUTHORS.length];
		const when = monthsAgo(1 + (seed + i) % 3);
		const hasReply = (seed + i) % 2 === 0;
		comments.push({
			id: `${article.id}-c-${i}`,
			author,
			body: COMMENT_BODIES[(seed + i) % COMMENT_BODIES.length],
			createdAt: when.iso,
			dateLabel: when.label,
			likes: 2 + ((seed + i * 7) % 24),
			replies: hasReply
				? [{
					id: `${article.id}-c-${i}-r0`,
					author: article.owner,
					body: COMMENT_REPLIES[(seed + i) % COMMENT_REPLIES.length],
					dateLabel: monthsAgo((seed + i) % 3).label,
					likes: 1 + ((seed + i) % 6),
				}]
				: [],
		});
	}

	return {
		thumbnail: article.media ?? unsplash(GALLERY_POOL[seed % GALLERY_POOL.length], 1400, 800),
		publishedAt: article.createdAt,
		publishedLabel: longDate(article.createdAt),
		readMinutes: article.readMinutes,
		topic: article.topic,
		blocks,
		toc,
		assets,
		comments,
	};
}
// #endregion

// #region Product view derivation
/**
 * Format resolution from the product's own category / title / skill vocabulary. Deterministic and
 * TOTAL — an unrecognised category resolves to `graphic` (a downloadable file with dimensions), never
 * to `undefined`, because the specification ledger IS the offer and a product with no ledger reads as
 * a listing with something to hide.
 */
const FORMAT_RULES: Array<[ProductFormat, RegExp]> = [
	["asset-3d", /3d|model|blender|render|sculpt|cgi/i],
	["audio", /audio|sound|music|stem|sample|foley|score|podcast/i],
	["video-preset", /video|lut|preset|grade|motion|footage/i],
	["code-kit", /code|kit|component|starter|boilerplate|sdk|script/i],
	["template", /template|deck|document|notion|figma|wireframe|framework/i],
];

const FORMAT_LABEL: Record<ProductFormat, string> = {
	"template": "Template",
	"asset-3d": "3D asset",
	"audio": "Audio stems",
	"video-preset": "Video preset",
	"code-kit": "Code kit",
	"graphic": "Graphic pack",
};

/** The file manifest each format delivers — extension, human label, base uncompressed size in MB. */
const FORMAT_FILES: Record<ProductFormat, Array<[string, string, number]>> = {
	"template": [
		[".fig", "Figma source", 18],
		[".pdf", "Print-ready export", 6],
		[".md", "Setup guide", 1],
	],
	"asset-3d": [
		[".blend", "Blender scene", 412],
		[".fbx", "FBX mesh + rig", 96],
		[".png", "4K PBR texture set", 240],
	],
	"audio": [
		[".wav", "24-bit / 48kHz stem", 386],
		[".mp3", "320kbps reference mix", 22],
		[".als", "Ableton session", 9],
	],
	"video-preset": [
		[".cube", "3D LUT", 2],
		[".aep", "After Effects project", 148],
		[".mov", "ProRes preview", 310],
	],
	"code-kit": [
		[".zip", "Source bundle", 14],
		[".ts", "Typed entry points", 1],
		[".md", "Integration guide", 1],
	],
	"graphic": [
		[".ai", "Vector source", 44],
		[".png", "Transparent exports", 128],
		[".svg", "Scalable set", 3],
	],
};

/** Host applications each format is verified against — the compatibility matrix. */
const FORMAT_COMPAT: Record<ProductFormat, ProductCompat[]> = {
	"template": [
		{ app: "Figma", versions: "Current web + desktop" },
		{ app: "Adobe Acrobat", versions: "2020 and later" },
	],
	"asset-3d": [
		{ app: "Blender", versions: "3.6 LTS - 4.2" },
		{ app: "Cinema 4D", versions: "R25 and later" },
		{ app: "Unreal Engine", versions: "5.1 - 5.4" },
	],
	"audio": [
		{ app: "Ableton Live", versions: "11 and later" },
		{ app: "Logic Pro", versions: "10.7 and later" },
		{ app: "Any DAW", versions: "WAV / MP3 import" },
	],
	"video-preset": [
		{ app: "After Effects", versions: "2022 and later" },
		{ app: "DaVinci Resolve", versions: "18 and later" },
		{ app: "Premiere Pro", versions: "2022 and later" },
	],
	"code-kit": [
		{ app: "Deno", versions: "2.x" },
		{ app: "Node.js", versions: "20 LTS and later" },
		{ app: "TypeScript", versions: "5.4 and later" },
	],
	"graphic": [
		{ app: "Illustrator", versions: "2021 and later" },
		{ app: "Affinity Designer", versions: "2 and later" },
	],
};

/** Format-specific technical specifications — the rows a buyer of THIS format actually checks. */
function formatSpecs(format: ProductFormat, seed: number): ProductSpec[] {
	switch (format) {
		case "asset-3d":
			return [
				{ label: "Poly count", value: `${18 + (seed % 40)}k tris (quad topology)` },
				{ label: "Texture resolution", value: "4096 x 4096 PBR (albedo, normal, roughness)" },
				{ label: "Rigged", value: seed % 2 === 0 ? "Yes - IK-ready armature" : "No - static mesh" },
				{ label: "UV layout", value: "Non-overlapping, single UDIM" },
			];
		case "audio":
			return [
				{ label: "Sample rate", value: "48 kHz / 24-bit" },
				{ label: "Stems included", value: `${4 + (seed % 6)} separated stems` },
				{ label: "Tempo", value: `${88 + (seed % 52)} BPM` },
				{ label: "Key", value: ["A minor", "C major", "F# minor", "D major"][seed % 4] },
			];
		case "video-preset":
			return [
				{ label: "Colour space", value: "Rec.709 with Log-to-Rec conversion included" },
				{ label: "Presets included", value: `${6 + (seed % 12)} looks` },
				{ label: "Resolution", value: "Resolution-independent (tested to 6K)" },
				{ label: "Frame rate", value: "Any - no baked timing" },
			];
		case "code-kit":
			return [
				{ label: "Language", value: "TypeScript (strict)" },
				{ label: "Runtime", value: "Deno 2.x, Node 20+" },
				{
					label: "Dependencies",
					value: seed % 2 === 0 ? "Zero runtime dependencies" : "2 peer dependencies",
				},
				{ label: "Tests", value: `${12 + (seed % 40)} unit tests included` },
			];
		case "template":
			return [
				{ label: "Pages / artboards", value: `${8 + (seed % 24)}` },
				{ label: "Grid", value: "12-column, 8pt baseline" },
				{ label: "Type styles", value: "Variable-font ready, tokenised" },
				{ label: "Dark mode", value: seed % 2 === 0 ? "Included" : "Light only" },
			];
		default:
			return [
				{ label: "Artboards", value: `${6 + (seed % 18)}` },
				{ label: "Max export", value: "6000 x 6000 px at 300 DPI" },
				{ label: "Colour profile", value: "sRGB plus CMYK variants" },
			];
	}
}

/**
 * The licence, stated as explicit allowed/denied permissions rather than a list of only the things
 * that are permitted. An omitted permission reads as an oversight; a denied one reads as a term, and
 * the buyer needs to see the terms. The tier derives from the price band, because a higher-priced
 * product carrying NARROWER rights is a relationship no buyer expects and a fixture must not invert.
 */
function licenceFor(product: ProductItem, seed: number): ProductLicence {
	const extended = (product.priceMinor ?? 0) >= 12_000 || seed % 3 === 0;
	return {
		name: extended ? "Extended commercial licence" : "Standard commercial licence",
		summary: extended
			? "Use in unlimited commercial projects, including work delivered to your own clients and products offered for resale."
			: "Use in your own commercial projects. Redistributing the source files, and reselling this as a competing product, are not permitted.",
		permissions: [
			{ label: "Personal use", allowed: true },
			{ label: "Commercial use", allowed: true },
			{ label: "Use in client deliverables", allowed: extended },
			{ label: "Modify and adapt", allowed: true },
			{ label: "Redistribute source files", allowed: false },
			{ label: "Resell as a competing product", allowed: false },
			// Phrased as a RIGHT, not an obligation. On an allowed/denied axis "Attribution required:
			// Included" puts a green check against a constraint, which inverts what the row means — every
			// row here has to be a thing the buyer GETS, or the column stops being readable.
			{ label: "Use without attribution", allowed: extended },
		],
	};
}

/** Human byte size - MB below a gigabyte, one decimal above. Formatted ONCE, server-side. */
function byteLabel(mb: number): string {
	return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

/** The live preview artefact for the 16:10 canvas, chosen by format. */
function previewFor(product: ProductItem, format: ProductFormat, seed: number): ProductPreview {
	const src = product.media ?? unsplash(GALLERY_POOL[seed % GALLERY_POOL.length], 1400, 875);
	if (format === "audio") {
		const peaks = Array.from({ length: 96 }, (_, i) => {
			const v = ((hash(`${product.id}:${i}`) % 100) / 100) * 0.8 + 0.2;
			return Math.round(v * 100) / 100;
		});
		const durationMs = (95 + (seed % 130)) * 1000;
		const total = Math.round(durationMs / 1000);
		return {
			kind: "audio",
			src: "#",
			poster: src,
			durationMs,
			durationLabel: `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`,
			peaks,
		};
	}
	if (format === "code-kit") {
		return {
			kind: "code",
			src,
			language: "typescript",
			code: [
				`import { createClient } from "./mod.ts";`,
				``,
				`const client = createClient({ retries: 3 });`,
				`const result = await client.send(payload);`,
				``,
				`if (!result.ok) throw new Error(result.error);`,
				`export default result.data;`,
			].join("\n"),
		};
	}
	if (format === "video-preset") return { kind: "video", src: "#", poster: src };
	if (format === "asset-3d") return { kind: "model", src, poster: src };
	return { kind: "image", src };
}

/**
 * Compose the products-only extension. Every figure a buyer reads is resolved here: the manifest is
 * scaled per product so two products of one format still differ, and the payload is summed ONCE so
 * the client never totals bytes.
 */
function productViewFor(product: ProductItem): ProductViewExtra {
	const seed = hash(product.id);
	const haystack = `${product.category} ${product.title} ${
		product.skills.map((s) => s.label).join(" ")
	}`;
	const format = FORMAT_RULES.find(([, re]) => re.test(haystack))?.[0] ?? "graphic";

	const scale = 0.7 + ((seed % 70) / 100);
	const files: ProductFile[] = FORMAT_FILES[format].map(([extension, label, baseMb]) => {
		const mb = Math.max(1, Math.round(baseMb * scale));
		return { extension, label, bytes: mb * 1024 * 1024, sizeLabel: byteLabel(mb) };
	});
	const payloadBytes = files.reduce((sum, f) => sum + f.bytes, 0);

	return {
		format,
		formatLabel: FORMAT_LABEL[format],
		files,
		payloadBytes,
		payloadLabel: byteLabel(Math.round(payloadBytes / (1024 * 1024))),
		specs: formatSpecs(format, seed),
		compatibility: FORMAT_COMPAT[format],
		licence: licenceFor(product, seed),
		preview: previewFor(product, format, seed),
	};
}
// #endregion

/** Compose the full Entity View payload for a resolved discovery item. */
export function buildViewPage(item: ExploreItem): EntityView {
	return {
		item,
		gallery: galleryFor(item),
		pricing: pricingFor(item),
		trust: trustFor(item),
		responseMinutes: responseMinutesFor(item),
		deliverables: deliverablesFor(item),
		// Projects/articles suppress the generic rails/reviews in their custom templates, but the payload
		// stays uniform — the shared screen simply doesn't read them for those types.
		moreByOwner: moreByOwner(item),
		similar: similarTo(item),
		reviews: reviewsFor(item),
		project: item.type === "projects" ? projectViewFor(item) : undefined,
		article: item.type === "articles" ? articleViewFor(item) : undefined,
		service: item.type === "services" ? serviceViewFor(item) : undefined,
		product: item.type === "products" ? productViewFor(item) : undefined,
	};
}
