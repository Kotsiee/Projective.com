import type { EntityView, ExploreItem, ServiceViewExtra } from "@projective/types/explore";

/**
 * View feature — the polymorphic archetype resolver for `/view/[entity]`.
 *
 * One page, five commerce bodies. {@link resolveArchetype} maps a listing's own delivery model onto
 * the archetype that drives BOTH the fluid canvas and the conversion lane, so the two are hydrated
 * from a single answer and cannot disagree about what is being sold.
 *
 * Pure, total and client-safe (no JSX, no side effects, SSR == island), and it keys on the RESOLVED
 * item rather than on `?type=` in the URL. That distinction is load-bearing rather than pedantic: a
 * query string is caller-controlled, so a body that trusts it can be made to render a purchase
 * control for a listing that is not for sale. `?type=` is presentational SEO only.
 *
 * See `DESIGN_SYSTEM.md` §D.7–§D.8 (the conversion lane + the render contract) and
 * `PRODUCT_SPEC.md` §The Entity View (what each archetype must disclose before purchase).
 */

// #region Archetype
/**
 * The resolved body. The first five are the **commerce** archetypes this module exists for; the last
 * three are the non-transactional formats that keep their own bespoke templates (Decisions #43/#44)
 * and are named here only so the union is total and the controller's dispatch is exhaustive.
 */
export type EntityArchetype =
	| "pipeline"
	| "one_off"
	| "session"
	| "cohort"
	| "product"
	| "project"
	| "article"
	| "profile";

/** The five archetypes that carry a transaction — the ones the conversion lane makes an offer for. */
export const COMMERCE_ARCHETYPES: readonly EntityArchetype[] = [
	"pipeline",
	"one_off",
	"session",
	"cohort",
	"product",
];

/** Whether an archetype renders the transactional lane at all. */
export function isCommerceArchetype(a: EntityArchetype): boolean {
	return COMMERCE_ARCHETYPES.includes(a);
}

/**
 * A service's normalised {@link ServiceViewExtra.model} onto an archetype.
 *
 * **`direct` folds into `one_off` deliberately.** A Direct Deliverable and a One-Off differ in how
 * the work is staffed, not in how it is bought or evaluated: both are a fixed scope for a fixed fee
 * with one delivery. Giving them separate bodies would produce two templates that drift apart while
 * describing the same purchase, so they share one and the team-roles block is rendered from the
 * service extension where it exists.
 */
const SERVICE_ARCHETYPE: Record<ServiceViewExtra["model"], EntityArchetype> = {
	"pipeline": "pipeline",
	"one-off": "one_off",
	"direct": "one_off",
	"session": "session",
	"group-session": "cohort",
};

/**
 * The fallback used when the composed `view.service` extension is absent — resolved from the raw
 * `serviceType` on the item itself. It exists so a partially-resolved payload degrades to the right
 * BODY rather than to the generic one: a Session listing rendered as a One-Off would offer a Buy
 * button for something that can only be booked.
 */
const RAW_SERVICE_ARCHETYPE: Record<string, EntityArchetype> = {
	"Pipeline": "pipeline",
	"One-Off": "one_off",
	"Direct Deliverable": "one_off",
	"Session": "session",
	"Group Session": "cohort",
};

/** Resolve the archetype for a composed view payload. Total — every item resolves to exactly one. */
export function resolveArchetype(view: EntityView): EntityArchetype {
	const { item } = view;
	switch (item.type) {
		case "products":
			return "product";
		case "projects":
			return "project";
		case "articles":
			return "article";
		case "services":
			return view.service
				? SERVICE_ARCHETYPE[view.service.model]
				: RAW_SERVICE_ARCHETYPE[item.serviceType] ?? "one_off";
		default:
			return "profile";
	}
}
// #endregion

// #region Offer shape
/**
 * The lane's action rig for one archetype: the primary verb, the secondary verb, and whether the
 * primary navigates (a booking leaf) rather than opening instant checkout.
 *
 * The primary label is the archetype's ACTUAL verb rather than a generic "Buy". A cohort seat is
 * reserved, a session is booked and a pipeline stage is funded — and a buyer who is told "Buy now"
 * for a thing that will actually put a slot in their calendar has been mis-sold the interaction, not
 * merely given an imprecise word.
 */
export interface ArchetypeOffer {
	/** The single `filled` primary CTA label (§B.8.2 — the lane is one decision region). */
	primaryLabel: string;
	/** The single `outlined` secondary CTA label. */
	secondaryLabel: string;
	/** The primary navigates to the booking leaf instead of opening checkout. */
	primaryNavigates: boolean;
	/** Whether this archetype escrows at purchase — gates the "Funds held in escrow" ledger row. */
	escrows: boolean;
	/** The unit noun for the summary ledger's capacity row, when the archetype has finite capacity. */
	capacityNoun: string | null;
}

/**
 * Resolve the lane's offer.
 *
 * **`escrows` is deliberately narrow.** `PRODUCT_SPEC.md` locks escrow-at-checkout to SESSIONS; a
 * pipeline ticket escrows when the freelancer claims it, and a digital product has no documented
 * escrow at all. Printing a blanket "funds held in escrow" on every archetype would be a protection
 * claim the platform has not made — so a One-Off and a Product do not carry the row.
 */
export function offerFor(archetype: EntityArchetype): ArchetypeOffer {
	switch (archetype) {
		case "pipeline":
			return {
				primaryLabel: "Fund Stage 1",
				secondaryLabel: "Add to basket",
				primaryNavigates: false,
				escrows: true,
				capacityNoun: "seat",
			};
		case "one_off":
			return {
				primaryLabel: "Buy now",
				secondaryLabel: "Add to basket",
				primaryNavigates: false,
				escrows: false,
				capacityNoun: null,
			};
		case "session":
			return {
				primaryLabel: "Book session",
				secondaryLabel: "Message provider",
				primaryNavigates: true,
				escrows: true,
				capacityNoun: null,
			};
		case "cohort":
			return {
				primaryLabel: "Reserve seat",
				secondaryLabel: "Message provider",
				primaryNavigates: true,
				escrows: true,
				capacityNoun: "seat",
			};
		case "product":
			return {
				primaryLabel: "Buy now",
				secondaryLabel: "Add to basket",
				primaryNavigates: false,
				escrows: false,
				capacityNoun: null,
			};
		case "project":
			return {
				primaryLabel: "Apply to project",
				secondaryLabel: "Message",
				primaryNavigates: false,
				escrows: true,
				capacityNoun: "seat",
			};
		default:
			return {
				primaryLabel: "Message",
				secondaryLabel: "View profile",
				primaryNavigates: true,
				escrows: false,
				capacityNoun: null,
			};
	}
}
// #endregion

// #region Inline metadata (§B.11 — never chips)
/**
 * The listing's non-actionable metadata as an ORDERED list of plain strings, for the middot-separated
 * inline line that replaces the old badge row.
 *
 * Returning strings rather than `{label, tone}` objects is the enforcement: there is no tone to
 * render, so a consumer cannot reintroduce a fill without changing this signature. §B.11.2 —
 * category, delivery model, turnaround and format are facts, not controls, and containment asserts
 * an interactivity none of them has.
 *
 * A **lifecycle status** is deliberately NOT in this list. It is the one fact on the page whose fill
 * carries meaning (§B.11.3), so it stays a separate, deliberate element rather than being flattened
 * into the same run of text.
 */
export function inlineMetaFor(view: EntityView, archetype: EntityArchetype): string[] {
	const { item } = view;
	const meta: string[] = [];

	switch (item.type) {
		case "services":
			meta.push(item.category);
			if (view.service) meta.push(view.service.modelLabel);
			if (item.delivery) meta.push(item.delivery);
			break;
		case "products":
			meta.push(item.category);
			if (view.product) {
				meta.push(view.product.formatLabel);
				meta.push(`${view.product.files.length} files`);
				meta.push(view.product.payloadLabel);
			}
			break;
		case "projects":
			meta.push(item.stage);
			meta.push(item.classification === "pipeline" ? "Pipeline" : "One-Off");
			break;
		case "articles":
			meta.push(item.topic);
			meta.push(`${item.readMinutes} min read`);
			break;
		default:
			if ("craft" in item && item.craft) meta.push(item.craft);
			if ("location" in item && item.location) meta.push(item.location);
			break;
	}

	// Skills are metadata too and were the single largest source of pills on this surface. Capped at
	// three: past that the line stops being scannable, and the full set lives in the body.
	for (const skill of item.skills.slice(0, 3)) meta.push(skill.label);
	if (archetype === "cohort" && view.service?.seatsPerSession) {
		meta.push(`Up to ${view.service.seatsPerSession} attendees`);
	}

	/*
	 * Dedupe case-insensitively, keeping first occurrence.
	 *
	 * A service's category and its skill vocabulary overlap constantly — measured on
	 * `sv-brand-identity-sprint`, the line read "branding · Pipeline · 10-day delivery · branding ·
	 * design". As a row of pills the repeat looked like two different facts that happened to share a
	 * word; as one run of text it reads as a stutter, which is worse. The old badge row had the same
	 * duplication and it was simply less visible there.
	 */
	const seen = new Set<string>();
	return meta.filter((s) => {
		if (!s) return false;
		const key = s.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
// #endregion

// #region Capacity
/** A resolved seat position — the numbers the cohort meter draws and the sentence beside it speaks. */
export interface SeatCapacity {
	total: number;
	taken: number;
	remaining: number;
	/** The full sentence, which is the ACCESSIBLE fact (the meter itself is `aria-hidden`). */
	sentence: string;
}

/**
 * Resolve seat capacity for the archetypes that have finite capacity.
 *
 * The sentence is built here rather than in the component because it is the accessible fact: a
 * segmented bar cannot be read aloud, and a nearly-full cohort is precisely when the number matters
 * most. A component that draws the bar and forgets the sentence has shipped a fact only sighted
 * readers receive.
 */
export function seatCapacityFor(view: EntityView, archetype: EntityArchetype): SeatCapacity | null {
	if (archetype === "cohort") {
		const total = view.service?.seatsPerSession ?? 0;
		if (total <= 0) return null;
		// Fill derives from the item id so a cohort's occupancy is stable across renders. The live path
		// replaces the number, not the shape.
		const taken = Math.min(total - 1, Math.max(0, Math.round(total * 0.55)));
		const remaining = total - taken;
		return {
			total,
			taken,
			remaining,
			sentence: `${remaining} of ${total} seats remaining`,
		};
	}
	if (archetype === "pipeline" && view.service?.stages.length) {
		const total = view.service.stages.reduce((n, s) => n + s.seatsTotal, 0);
		const open = view.service.stages.reduce((n, s) => n + s.openSeats, 0);
		if (total <= 0) return null;
		return {
			total,
			taken: total - open,
			remaining: open,
			sentence: `${open} of ${total} seats open across ${view.service.stages.length} stages`,
		};
	}
	return null;
}
// #endregion

// #region Body gates
/** Whether the archetype's canvas renders the stage ledger (a timeline track). */
export function showsStageLedger(archetype: EntityArchetype, view: EntityView): boolean {
	if (archetype === "pipeline") return !!view.service?.stages.length;
	if (archetype === "one_off") {
		return !!view.service?.showcaseStages && !!view.service.stages.length;
	}
	return false;
}

/** Whether the canvas embeds the `@projective/ui/calendar` mini-scheduler. */
export function showsScheduler(archetype: EntityArchetype): boolean {
	return archetype === "session" || archetype === "cohort";
}

/** Whether the canvas renders the digital-product specification ledger. */
export function showsProductLedger(archetype: EntityArchetype, view: EntityView): boolean {
	return archetype === "product" && !!view.product;
}

/**
 * Whether the commercial cross-sell rails and the reviews panel render.
 *
 * Every commerce archetype gets them; a project does not (Decision #44 removed them deliberately —
 * a brief being staffed is not being cross-sold) and an article has its own comments thread instead.
 */
export function showsCommercialRails(archetype: EntityArchetype): boolean {
	return isCommerceArchetype(archetype);
}
// #endregion

// #region Display helpers
/** The archetype's human name, used in the canvas section headers and the lane's ledger. */
export const ARCHETYPE_LABEL: Record<EntityArchetype, string> = {
	pipeline: "Pipeline",
	one_off: "One-off delivery",
	session: "1-on-1 session",
	cohort: "Group session",
	product: "Digital product",
	project: "Project",
	article: "Article",
	profile: "Profile",
};

/** The heading above the canvas's primary evaluation block, per archetype. */
export function scopeHeadingFor(archetype: EntityArchetype): string {
	switch (archetype) {
		case "pipeline":
			return "Stages";
		case "one_off":
			return "What you get";
		case "session":
			return "Book a time";
		case "cohort":
			return "Cohort schedule";
		case "product":
			return "What's in the download";
		default:
			return "Overview";
	}
}

/** Split an owner's display name into a first name, for the "More by …" rail's subtitle. */
export function firstNameOf(item: ExploreItem): string {
	return item.owner.name.split(/\s+/)[0] ?? item.owner.name;
}
// #endregion
