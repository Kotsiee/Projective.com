import type { UserContext } from "@projective/types/auth";
import type { ProjectSummary } from "@projective/types/projects";
import type { PublicCallOffer } from "@projective/types/scheduling";
import { formatMoney } from "@projective/types/finance";
import {
	LEGACY_TAB_TARGET,
	LegacyProfileTab,
	normalizeHandle,
	type ProfileKind,
	ProfileTab,
	type ProfileView,
	type ReviewEntry,
} from "@projective/types/profile";
import { FAST_REPLY_MINUTES } from "@features/explore/core/card-signals.ts";
import { type PriceAmount, serviceStartingPrice } from "@features/explore/core/pricing.ts";
import type { ServiceItem } from "../types/profile-types.ts";

/**
 * profile-model — the pure, JSX-free brains of the `/[handle]` profile: the four-section tab matrix,
 * labels + route segments, active-tab / legacy-redirect / own-profile resolution, the action-rig rule, the
 * review-stance filter, and the at-a-glance derivations (reply speed, estimated spend). Imported
 * freely by islands, components, and routes (no DOM, no server deps).
 */

// #region Tab labels + segments
/** Human label per section (the tab-bar text + the sub-route title). */
export const TAB_LABEL: Record<ProfileTab, string> = {
	work: "Work",
	experience: "Experience",
	reviews: "Reviews",
	posts: "Posts",
};

/** Route segment per section. `work` is the index (`/[handle]`); the rest are `/[handle]/<segment>`. */
export function tabSegment(tab: ProfileTab): string {
	return tab === "work" ? "" : tab;
}
// #endregion

// #region Entity tab matrix
/**
 * The sections shown for a profile kind (root CLAUDE.md §8 Decision #96). Work · Reviews · Posts are
 * universal; **Experience is an individual's section** — a career history, degrees and personal
 * certifications belong to a person, and a team / business / organisation has no such ledger, so
 * rendering the tab for them would be an empty section with a name on it.
 */
export function tabsFor(kind: ProfileKind): ProfileTab[] {
	switch (kind) {
		case "freelancer":
		case "client":
			return ["work", "experience", "reviews", "posts"];
		case "team":
		case "business":
		case "organisation":
			return ["work", "reviews", "posts"];
	}
}

/** The section the bare `/[handle]` index renders — Work, for every kind. */
export function defaultTabFor(_kind: ProfileKind): ProfileTab {
	return "work";
}
// #endregion

// #region Active tab + paths
/** DOM id of the tab-sections region — the hero's rating figure scroll-links here. */
export const TABS_ANCHOR = "profile-sections";

/** DOM id of the standalone Services row above the sections — the hero's Hire control lands here. */
export const SERVICES_ANCHOR = "profile-services";

/** DOM id of the standalone Products masonry directly beneath the Services row. */
export const PRODUCTS_ANCHOR = "profile-products";

/**
 * Parse the active section from a pathname. `null` when there is no sub-segment (the `/@handle`
 * index, which the caller resolves to {@link defaultTabFor}) or the segment is not a section.
 */
export function activeTabOf(pathname: string): ProfileTab | null {
	const segs = pathname.split("/").filter(Boolean); // [handle, segment?, …]
	const segment = segs[1];
	if (!segment) return null;
	const parsed = ProfileTab.safeParse(segment);
	return parsed.success ? parsed.data : null;
}

/**
 * Where a RETIRED tab segment now lives, or `null` when the segment was never a profile tab. The
 * `[tab]` route answers a legacy segment with a 308 to this target — a bookmark to
 * `/@handle/portfolio` lands on Work rather than "Section not found". `work` itself is also
 * canonicalised to the bare index so one section has one address.
 */
export function legacyTabTarget(segment: string): ProfileTab | null {
	if (segment === "work") return "work";
	const parsed = LegacyProfileTab.safeParse(segment);
	return parsed.success ? LEGACY_TAB_TARGET[parsed.data] : null;
}

/** Build the deep-link for a section. `handle` carries the leading `@` (canonical, Decision #3). */
export function tabHref(handle: string, tab: ProfileTab): string {
	const seg = tabSegment(tab);
	return seg ? `/${handle}/${seg}` : `/${handle}`;
}

/**
 * Deep-link to the Reviews section that also SCROLLS the tab region into view — the hero's rating
 * figure targets it, so a full navigation lands on the reviews rather than at the top of the hero.
 */
export function reviewsHref(handle: string): string {
	return `${tabHref(handle, "reviews")}#${TABS_ANCHOR}`;
}
// #endregion

// #region Ownership + the action rig
/**
 * Whether the acting user owns this profile — unlocks the owner chrome (inline story editing, the
 * image pickers, the Settings CTA). Matches on the hydrated `userId` OR the acting `@handle` (skeleton
 * tokens may carry only one). Guests never match.
 */
export function isOwnProfile(
	profile: ProfileView,
	context: UserContext | undefined | null,
): boolean {
	if (!context || context.role === "guest") return false;
	if (context.userId && context.userId === profile.userId) return true;
	if (context.handle && normalizeHandle(context.handle) === normalizeHandle(profile.handle)) {
		return true;
	}
	return false;
}

/** Whether the kind is a seller — the only kind that can be hired or brought into a project. */
export function isSellerKind(kind: ProfileKind): boolean {
	return kind === "freelancer" || kind === "team";
}

/**
 * The hero's action rig for a VISITOR (root CLAUDE.md §8 Decision #108).
 *
 * A SELLER (freelancer · team) gets up to two conversion controls and the compact icon-only
 * Message + Follow pair beside them:
 *
 *  - **Hire** — the primary — opens a popover of the seller's listings (and a "Book consultation"
 *    row when they take calls). It renders when there is something to hire FOR: a listing or a
 *    consultation. A seller with neither has nothing for the popover to show, so the control is
 *    withheld rather than opened onto an empty menu.
 *  - **Add to project** — present on a seller for a SIGNED-IN viewer, because its menu always has
 *    at least one row for them: the "Create new project" item. With no Hire beside it, it takes
 *    the primary treatment (§B.8.2 — one `filled` control per decision region, and it is then the
 *    only conversion control). A GUEST does not get it: its rows are the viewer's OWN projects, of
 *    which a guest has none, and its create row would mint a project for nobody — every path
 *    through it ends at the sign-in prompt, so the control is withheld rather than offered and then
 *    refused (product owner, 2026-09-20).
 *
 * A BUYER entity (client · business · organisation) cannot be hired or assigned, so Message stays
 * its text primary with Follow as a text secondary.
 *
 * Hire renders for a guest exactly as it does for a member — a listing's preview and a provider's
 * availability are public information, and a control that appears only after signing in is one a
 * guest never learns exists — but a guest's PRESS on it opens the sign-in prompt in place of the
 * popover (the hero owns that gate; `rigFor` only decides what renders).
 */
export interface ProfileRig {
	/** `seller` draws Hire ⁄ Add-to-project + the icon pair; `buyer` the Message + Follow text pair. */
	layout: "seller" | "buyer";
	/** Whether the Hire control renders. */
	hire: boolean;
	/** Whether the Add-to-project control renders. */
	addToProject: boolean;
	/** Which control carries the filled primary treatment. */
	primary: "hire" | "add" | "message";
}

/** The facts about the SELLER that {@link rigFor} branches on. */
export interface RigInput {
	/** Whether the seller has active listings — rows for the Hire popover. */
	hasServices: boolean;
	/** Whether the seller takes discovery calls — the popover's consultation row. */
	offersConsultation: boolean;
	/** Whether the viewer is signed in — Add-to-project lists THEIR projects, so a guest has none. */
	authed: boolean;
}

export function rigFor(kind: ProfileKind, input: RigInput): ProfileRig {
	if (!isSellerKind(kind)) {
		return { layout: "buyer", hire: false, addToProject: false, primary: "message" };
	}
	const hire = input.hasServices || input.offersConsultation;
	const addToProject = input.authed;
	// With neither control (a guest on a seller with nothing to hire for) the row holds only the
	// icon pair; `primary` then names a control that does not render, and the hero draws nothing
	// filled — an honest absence, not a promoted secondary.
	return { layout: "seller", hire, addToProject, primary: hire ? "hire" : "add" };
}

/**
 * One project a signed-in client can bring a seller into — the row the Add-to-project popover
 * draws. A slim, serialisable slice of {@link ProjectSummary}, because it crosses the island
 * boundary.
 */
export interface HireProject {
	slug: string;
	title: string;
	/** The owning workspace ("Personal" · "Northwind Studio"), so two workspaces' projects read apart. */
	scopeLabel: string;
	status: ProjectSummary["status"];
	/**
	 * Whether the project is PUBLISHED — anything past `draft`. A published project's assignment is
	 * an invitation at the project's stated terms; an unpublished one takes a placeholder
	 * assignment that is priced when the project is published.
	 */
	published: boolean;
	/**
	 * The ISO instant an ACTIVE re-invitation cooldown lifts — this seller declined an invitation to
	 * this project inside the last `INVITE_COOLDOWN_DAYS` — or `null`. A locked row renders disabled
	 * with the date; the server refuses the send regardless (`hireInvitationRefusal`).
	 */
	cooldownUntil: string | null;
}

/** The lifecycle states a project can still be hired into. */
const OPEN_PROJECT_STATUSES: readonly ProjectSummary["status"][] = ["draft", "active", "on_hold"];

/** Whether a project is still open to new members. */
export function isOpenProject(project: Pick<ProjectSummary, "status">): boolean {
	return OPEN_PROJECT_STATUSES.includes(project.status);
}

/**
 * Project the viewer's feed rows onto the popover's rows — open engagements only, PUBLISHED FIRST.
 *
 * Published before draft, and stable within each group (the feed's own order), because a client
 * hiring somebody almost always means into a project that is already live; the drafts follow so
 * they are never lost, but they never push the live work down the list.
 *
 * `cooldowns` is the server's per-slug answer to "is this seller locked out here" — a locked project
 * keeps its place in the list (absence would read as "you have no such project") and renders
 * disabled with the date.
 */
export function hireProjectsFrom(
	items: readonly ProjectSummary[],
	cooldowns: Readonly<Record<string, string>> = {},
): HireProject[] {
	const rows = items.filter(isOpenProject).map((p) => ({
		slug: p.slug,
		title: p.title,
		scopeLabel: p.scopeLabel,
		status: p.status,
		published: p.status !== "draft",
		cooldownUntil: cooldowns[p.slug] ?? null,
	}));
	return [...rows.filter((r) => r.published), ...rows.filter((r) => !r.published)];
}

/**
 * Where the invitations an assignment sends can be managed afterwards — the project's roster, whose
 * pending queue lists them. The popover row itself never navigates here: picking a project opens
 * the assignment modal in place, and this is the address the modal's success note points at.
 */
export function hireProjectHref(project: Pick<HireProject, "slug">): string {
	return `/projects/${project.slug}/members`;
}

/**
 * The consultation row's price word. "Free" whenever a courtesy call is offered — even beside a
 * paid option, because the free intro is the one a visitor is being invited to — else the paid
 * fee in the provider's own currency; `null` when the provider takes no calls (no row).
 */
export function consultationPriceLabel(
	offer:
		| Pick<PublicCallOffer, "courtesyEnabled" | "paidEnabled" | "feeAmountMinor" | "feeCurrency">
		| null,
): string | null {
	if (!offer) return null;
	if (offer.courtesyEnabled) return "Free";
	if (offer.paidEnabled && offer.feeAmountMinor !== null && offer.feeCurrency) {
		return formatMoney(offer.feeAmountMinor, offer.feeCurrency);
	}
	return null;
}
// #endregion

// #region Reviews — stance filter
/**
 * The Reviews segmented filter: every review, or only those received in ONE of the profile's two
 * stances. `ReviewEntry.role` records the AUTHOR's side — a review whose author was the client is a
 * review of this profile AS A FREELANCER, and vice versa — so the filter is the author's role
 * inverted. Written once here rather than in the island, because inverting it in two places is how
 * "As freelancer" comes to show a freelancer's reviews of their client.
 */
export type ReviewStance = "all" | "freelancer" | "client";

/** The stance THIS profile held in the engagement a review is about. */
export function reviewStanceOf(review: Pick<ReviewEntry, "role">): "freelancer" | "client" {
	return review.role === "client" ? "freelancer" : "client";
}

/** The reviews matching a stance (`all` returns the input untouched). */
export function reviewsForStance<T extends Pick<ReviewEntry, "role">>(
	reviews: readonly T[],
	stance: ReviewStance,
): T[] {
	if (stance === "all") return [...reviews];
	return reviews.filter((review) => reviewStanceOf(review) === stance);
}

/** How many reviews each stance holds, for the segment labels. */
export function reviewStanceCounts(
	reviews: readonly Pick<ReviewEntry, "role">[],
): Record<ReviewStance, number> {
	let freelancer = 0;
	let client = 0;
	for (const review of reviews) {
		if (reviewStanceOf(review) === "freelancer") freelancer++;
		else client++;
	}
	return { all: reviews.length, freelancer, client };
}

/** Parse a `?as=` query value into a stance; anything else is `all`. */
export function parseReviewStance(value: string | null | undefined): ReviewStance {
	return value === "freelancer" || value === "client" ? value : "all";
}
// #endregion

// #region At a glance — reply speed + estimated spend
/**
 * `~45 min` · `~2 hrs` · `~1 day` — the compact figure beside "Avg. response". Rounded to the unit a
 * reader plans around; never more precise than the measurement deserves.
 */
export function responseLabel(minutes: number): string {
	if (minutes < 60) return `~${Math.max(1, Math.round(minutes))} min`;
	if (minutes < 24 * 60) {
		const hours = Math.round(minutes / 60);
		return `~${hours} ${hours === 1 ? "hr" : "hrs"}`;
	}
	const days = Math.round(minutes / (24 * 60));
	return `~${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * "Fast responder" is the discovery card's "Fast replies" gate applied to the profile: the SAME
 * `FAST_REPLY_MINUTES` threshold, so the mark here and the chip on the card that linked here agree.
 * An unmeasured profile (`null`) never earns it.
 */
export function isFastResponder(minutes: number | null | undefined): boolean {
	return typeof minutes === "number" && minutes <= FAST_REPLY_MINUTES;
}

/** The "Est. project spend" floor — the cheapest starting rate across the seller's listings. */
export interface EstimatedSpend {
	amount: PriceAmount;
	/** The per-unit noun of the listing that set the floor (`ticket` · `session` · `project`). */
	unit: string | null;
}

/**
 * The lowest starting rate across a seller's active listings, resolved through the SAME
 * `serviceStartingPrice` the service cards print — so the figure in the context bar is one a reader
 * can find on a card directly beneath it. Compared within the first listing's currency (a mixed-
 * currency catalogue is compared in whichever currency leads), and `null` when no listing carries a
 * structured price — a "Contact us" catalogue gets no invented floor.
 */
export function estimatedSpendFor(services: readonly ServiceItem[]): EstimatedSpend | null {
	let best: EstimatedSpend | null = null;
	for (const service of services) {
		const price = serviceStartingPrice(service);
		if (!price.amount) continue;
		if (best && price.amount.currency !== best.amount.currency) continue;
		if (!best || price.amount.minor < best.amount.minor) {
			best = { amount: price.amount, unit: price.unit ?? null };
		}
	}
	return best;
}
// #endregion
