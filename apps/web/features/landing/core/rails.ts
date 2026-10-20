/**
 * rails — "Ways to work" as data (`flows/LANDING.md` §4.5, §2.1 notes 14–15; layout F): the three
 * ways to run the work with the link each one leads to, the small print, and the live marketplace
 * rails sliced from the landing payload.
 *
 * Server-only. The thin controller reads the payload (`ExploreBackendService.landing()`) and the page
 * hands {@link sliceRails}'s result to the section, so no island ever receives the feed: each rail
 * carries only what its cards print — a title, a link, the owner's name, a picture or two and, only
 * where the listing carries a real one, a price. Every link is built by Explore's own helpers
 * ({@link itemHref}, {@link explorePath}, {@link serializeExploreParams}), never by hand.
 */
import type {
	ExploreCategory,
	LandingPayload,
	ProfileItem,
	ProjectItem,
	ServiceItem,
} from "@projective/types/explore";
import { currencyExponent } from "@projective/types/finance";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";
import { DEFAULT_SORT, serializeExploreParams } from "@features/explore/core/explore-state.ts";
import { itemHref } from "@features/explore/core/routing.ts";
import {
	freelancerFloorAmount,
	type PriceAmount,
	projectBudgetAmount,
	serviceStartingPrice,
} from "@features/explore/core/pricing.ts";
import { explorePath } from "@features/marketing/core/megamenu-data.ts";
import { PROJECT_CREATE_HREF } from "@features/shell/core/actions-model.ts";

// #region Ways to work
/** The section's anchor and its heading's id: the section is labelled by its one h2. */
export const WAYS_SECTION_ID = "ways-to-work";
/** The h2's id (`aria-labelledby`). */
export const WAYS_TITLE_ID = "ways-to-work-title";

/** The section's fixed copy (§4.5). `[L4]` `[L3]` */
export const WAYS_COPY = {
	/** The section header: the section's name. */
	eyebrow: "Ways to work",
	title: "Work the way you want.",
	subline: "Pick a single job, an ongoing workflow or a live session.",
	/** The small print under the three ways. */
	note: "Need just one thing done? Start with a single task: one deliverable, one price.",
} as const;

/** One way to run the work: a column of text and its one link. */
export interface WayToWork {
	/** A stable key (`job` · `workflow` · `session`), also the column's schematic. */
	id: "job" | "workflow" | "session";
	title: string;
	/** What it is. */
	body: string;
	/** When the money moves: the column's second, quieter paragraph. */
	money: string;
	/** The link's visible words (its accessible name). */
	label: string;
	href: string;
}

/**
 * The services "Delivery model" facet (`features/explore/core/filter-config.ts`), honoured by the
 * search query: a pipeline listing is ongoing work, a session or group session is live time.
 */
function deliveryModelHref(models: readonly string[]): string {
	return serializeExploreParams({
		q: "",
		category: "services",
		sort: DEFAULT_SORT,
		filters: { model: [...models] },
	});
}

/**
 * The three ways (§4.5, verbatim). "A single job" posts one — the project Quick-Init modal
 * (`/projects?create=1`; a guest signs in and returns through `redirectTo`) — rather than linking to
 * one-off listings, which checkout does not sell (#281 flag q). The other two open Explore on the
 * services' delivery model: `?category=services&model=Pipeline`, and both session models, byte for
 * byte the Explore Home "Sessions" chip.
 */
export const WAYS: readonly WayToWork[] = [
	{
		id: "job",
		title: "A single job",
		body: "One clear piece of work, delivered in milestones.",
		money: "Each milestone is paid for as it starts.",
		label: "Post a single job",
		href: PROJECT_CREATE_HREF,
	},
	{
		id: "workflow",
		title: "An ongoing workflow",
		body: "Ongoing work, task by task, across several stages.",
		money: "Each task is paid for when someone picks it up.",
		label: "Browse ongoing work",
		href: deliveryModelHref(["Pipeline"]),
	},
	{
		id: "session",
		title: "A live session",
		body: "Book time with an expert: one session, a block, or a seat in a group.",
		money:
			"Your payment is held. It goes to them 24 hours after each session ends, unless you report a no-show. For a group seat, that's 24 hours after the last session.",
		label: "Browse live sessions",
		href: deliveryModelHref(["Session", "Group Session"]),
	},
];
// #endregion

// #region Rails — contract
/** The rails, in the order the page shows them (§4.5). No products rail (#281: not delivered). */
export const RAIL_IDS = ["services", "projects", "teams", "freelancers"] as const;
export type RailId = typeof RAIL_IDS[number];

/** A rail shows only from this many items; below it the rail is left out (no empty state). */
export const RAIL_MIN_ITEMS = 4;
/** At most this many cards per rail: a sample of the marketplace, never the feed. */
export const RAIL_MAX_ITEMS = 8;

/** One card: only what it prints. */
export interface RailItem {
	id: string;
	/**
	 * A service (`listing`: its picture, "by {ownerName}"), a project (`brief`: text-forward, since a
	 * brief has no media of its own) or a freelancer or team (`profile`: its cover, name and headline).
	 */
	kind: "listing" | "brief" | "profile";
	/** The listing's title, or the profile's name. */
	title: string;
	/** Explore's click matrix: `/view/[id]?type=` for a listing, `/@handle` for a profile. */
	href: string;
	/** Who is behind it: the byline's name. */
	ownerName: string;
	/** The owner's picture, else {@link DEFAULT_AVATAR_URL}. */
	avatar: string;
	/** The service's picture or the profile's cover, from the payload; `null` for none (and a brief). */
	cover: string | null;
	/** A brief's own description; `null` for the other kinds. */
	summary: string | null;
	/**
	 * Inline meta text: a profile's headline (its craft), a brief's stages ("Discovery · Design");
	 * `null` for a service.
	 */
	detail: string | null;
	/**
	 * The price line, only when the payload carries a real figure: "from £47.50 / ticket" (a range's
	 * floor), "£80 / session", a freelancer's "from £120", a brief's budget. `null` otherwise — never
	 * a made-up zero.
	 */
	price: string | null;
}

/** One rail as the section renders it. */
export interface Rail {
	id: RailId;
	/** The rail's heading. */
	title: string;
	/** The "See all" link's words and its Explore address (`explorePath`). */
	seeAllLabel: string;
	seeAllHref: string;
	/** {@link RAIL_MIN_ITEMS}…{@link RAIL_MAX_ITEMS} cards. */
	items: RailItem[];
}

/**
 * Each rail's words and the Explore category its "See all" opens (§4.5). `[U4]` Every title names
 * what the rail holds and claims nothing the data cannot back: the services come from
 * `home.recommended.services`, ranked by the marketplace's quality score (which damps review volume
 * and lifts new talent), so nothing measures popularity and the rail is "Services", not §4.5's
 * "Popular services" (Decision #301 (C), held for the owner).
 */
export const RAIL_COPY: Readonly<
	Record<RailId, { title: string; seeAll: string; category: ExploreCategory }>
> = {
	services: { title: "Services", seeAll: "See all services", category: "services" },
	projects: { title: "Open projects", seeAll: "See all projects", category: "projects" },
	teams: { title: "Ready-made teams", seeAll: "See all teams", category: "teams" },
	freelancers: { title: "Freelancers", seeAll: "See all freelancers", category: "freelancers" },
};

/** The rail's region name (§4.5 microcopy): "Services, 8 items". */
export function railLabel(rail: Pick<Rail, "title" | "items">): string {
	return `${rail.title}, ${rail.items.length} items`;
}

/** The scroll buttons' names (§4.5 microcopy): "Scroll Services back" / "… forward". */
export function railStepLabel(title: string, direction: "back" | "forward"): string {
	return `Scroll ${title} ${direction}`;
}

/** A card's byline (§4.5 microcopy): "by {ownerName}". */
export function railByline(ownerName: string): string {
	return `by ${ownerName}`;
}

/**
 * The initials a card's picture frame shows when there is neither a picture nor a real avatar:
 * the first letters of the name's first and last words ("Tomasz Wójcik" → "TW"), upper-cased.
 */
export function railMonogram(name: string): string {
	const words = name.split(/\s+/).map((word) => word.replace(/^[^\p{L}\p{N}]+/u, ""))
		.filter((word) => word !== "");
	if (words.length === 0) return "";
	const first = Array.from(words[0])[0];
	const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
	return `${first}${last}`.toLocaleUpperCase("en-GB");
}

/** The DOM id of a rail's scroller, which its scroll buttons control. */
export function railTrackId(id: RailId): string {
	return `lp-rail-${id}`;
}
// #endregion

// #region Rails — money
/**
 * A listing's figure in its own currency (never converted: the landing has no rate table), en-GB,
 * whole amounts without their zero pence: "£120", "£47.50", "US$90". `null` for a currency `Intl`
 * does not know.
 */
export function railMoney(amount: PriceAmount): string | null {
	const exponent = currencyExponent(amount.currency);
	const whole = amount.minor % 10 ** exponent === 0;
	try {
		return new Intl.NumberFormat("en-GB", {
			style: "currency",
			currency: amount.currency.toUpperCase(),
			minimumFractionDigits: whole ? 0 : exponent,
			maximumFractionDigits: whole ? 0 : exponent,
		}).format(amount.minor / 10 ** exponent);
	} catch {
		return null;
	}
}

/** A real, positive figure, formatted; `null` for none, a zero or an unknown currency. */
function figure(amount: PriceAmount | null): string | null {
	return amount && amount.minor > 0 ? railMoney(amount) : null;
}

/**
 * A service's price line by the rule Explore's card prints (`serviceStartingPrice`): one starting
 * figure, "from" only when it is a range's floor (a pipeline's per-ticket price), and its unit.
 */
export function servicePriceLine(item: ServiceItem): string | null {
	const price = serviceStartingPrice(item);
	const shown = figure(price.amount);
	if (shown === null) return null;
	const unit = price.unit ? ` / ${price.unit}` : "";
	return `${price.isFloor ? "from " : ""}${shown}${unit}`;
}

/** A freelancer's fenced floor across their active services (`freelancerFloorAmount`). */
function freelancerPriceLine(item: ProfileItem): string | null {
	const shown = figure(freelancerFloorAmount(item));
	return shown === null ? null : `from ${shown}`;
}
// #endregion

// #region Rails — slicing
/** A payload picture, or `null` for an empty string. */
function picture(url: string | undefined): string | null {
	return url && url.trim() !== "" ? url : null;
}

/** Payload text, or `null` when it is blank. */
function text(value: string | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}

function avatarOf(item: ServiceItem | ProjectItem | ProfileItem): string {
	return picture(item.owner.avatar) ?? DEFAULT_AVATAR_URL;
}

function serviceCard(item: ServiceItem): RailItem {
	return {
		id: item.id,
		kind: "listing",
		title: item.title,
		href: itemHref(item),
		ownerName: item.owner.name,
		avatar: avatarOf(item),
		cover: picture(item.media),
		summary: null,
		detail: null,
		price: servicePriceLine(item),
	};
}

/**
 * A brief, text-forward as Explore's project card is (a brief has no media of its own): who posted
 * it, its description, its stages as inline meta text and its budget, the whole figure.
 */
function projectCard(item: ProjectItem): RailItem {
	const stages = item.phases.map((phase) => phase.trim()).filter((phase) => phase !== "");
	return {
		id: item.id,
		kind: "brief",
		title: item.title,
		href: itemHref(item),
		ownerName: item.owner.name,
		avatar: avatarOf(item),
		cover: null,
		summary: text(item.summary),
		detail: stages.length > 0 ? stages.join(" · ") : null,
		price: figure(projectBudgetAmount(item)),
	};
}

function profileCard(item: ProfileItem): RailItem {
	return {
		id: item.id,
		kind: "profile",
		title: item.title,
		href: itemHref(item),
		ownerName: item.owner.name,
		avatar: avatarOf(item),
		cover: picture(item.cover),
		summary: null,
		detail: text(item.craft),
		price: item.type === "freelancers" ? freelancerPriceLine(item) : null,
	};
}

/**
 * The first {@link RAIL_MAX_ITEMS} unpromoted items as cards, or `null` below
 * {@link RAIL_MIN_ITEMS}. A paid placement is left out: the landing carries no "Promoted" disclosure.
 */
function bounded<T extends { sponsored?: boolean }>(
	items: readonly T[],
	card: (item: T) => RailItem,
): RailItem[] | null {
	const kept = items.filter((item) => item.sponsored !== true).slice(0, RAIL_MAX_ITEMS);
	return kept.length >= RAIL_MIN_ITEMS ? kept.map(card) : null;
}

/**
 * The landing's live rails (`LandingPayload.home`, §4.5 `[U4]`): Services · Open projects ·
 * Ready-made teams · Freelancers, each in the marketplace's own recommended order (the order the
 * "See all" page opens in), each left out below {@link RAIL_MIN_ITEMS} items and cut to
 * {@link RAIL_MAX_ITEMS}. No products rail. `[]` when the payload is `null` (the read failed).
 */
export function sliceRails(payload: LandingPayload | null): Rail[] {
	if (!payload) return [];
	const { recommended } = payload.home;
	const sources: Record<RailId, RailItem[] | null> = {
		services: bounded(recommended.services, serviceCard),
		projects: bounded(recommended.projects, projectCard),
		teams: bounded(recommended.people.filter((item) => item.type === "teams"), profileCard),
		freelancers: bounded(
			recommended.people.filter((item) => item.type === "freelancers"),
			profileCard,
		),
	};
	const rails: Rail[] = [];
	for (const id of RAIL_IDS) {
		const items = sources[id];
		if (!items) continue;
		const copy = RAIL_COPY[id];
		rails.push({
			id,
			title: copy.title,
			seeAllLabel: copy.seeAll,
			seeAllHref: explorePath(copy.category),
			items,
		});
	}
	return rails;
}
// #endregion
