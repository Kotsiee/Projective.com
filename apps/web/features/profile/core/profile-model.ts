import type { UserContext } from "@projective/types/auth";
import type { ProjectSummary } from "@projective/types/projects";
import type { PublicCallOffer } from "@projective/types/scheduling";
import { formatMoney } from "@projective/types/finance";
import {
	LEGACY_TAB_TARGET,
	LegacyProfileTab,
	type MemberEntry,
	normalizeHandle,
	type ProfileHiddenReason,
	type ProfileKind,
	type ProfileStandingFactors,
	ProfileTab,
	type ProfileView,
	type ReviewEntry,
} from "@projective/types/profile";
import type { RatingTrack } from "@projective/types/explore";
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
 * certifications belong to a person, and a team / business / enterprise has no such ledger, so
 * rendering the tab for them would be an empty section with a name on it.
 */
export function tabsFor(kind: ProfileKind): ProfileTab[] {
	switch (kind) {
		case "freelancer":
		case "client":
			return ["work", "experience", "reviews", "posts"];
		case "team":
		case "business":
		case "enterprise":
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
 * A member who may edit a TEAM's profile (`manages` — `edit_profile`, the owner and admin presets or
 * a custom role that grants it, Decision #250 (b)) sees **Manage team**, a tier-4 link to its
 * console, in Hire's place (Teams P1): hiring their own team is not a thing they came to do. Add to
 * project stays, as it would for any signed-in viewer. A team's Message reaches its owner, as a
 * business's does (a direct message is person-to-person), so a read that names no owner withholds
 * the Message icon (`messageable: false`) rather than opening a thread nobody reads.
 *
 * A BUYER entity cannot be hired or assigned. A client or an enterprise keeps Message as its text
 * primary with Follow as a text secondary. A **business** (BP1, Decision #244) leads with Message as
 * the one filled control — the tier-3 teal pill Hire takes on a seller, because it is the only way
 * in — with Follow as the icon-only secondary; and for a member who may edit it (`manages`), a
 * "Manage business" link to its console takes Message's place, since they would be messaging their
 * own business. A business's Message reaches its owner (a direct message is person-to-person), so
 * when the read names no owner to reach (`messageable: false`) Message is withheld rather than
 * opening a thread nobody reads, and Follow stands alone.
 *
 * Hire renders for a guest exactly as it does for a member — a listing's preview and a provider's
 * availability are public information, and a control that appears only after signing in is one a
 * guest never learns exists — but a guest's PRESS on it opens the sign-in prompt in place of the
 * popover (the hero owns that gate; `rigFor` only decides what renders).
 */
export interface ProfileRig {
	/**
	 * `seller` draws Hire ⁄ Add-to-project + the icon pair; `buyer` the Message + Follow text pair;
	 * `business` the filled Message (or Manage business) + the icon-only Follow.
	 */
	layout: "seller" | "buyer" | "business";
	/** Whether the Hire control renders. */
	hire: boolean;
	/** Whether the Add-to-project control renders. */
	addToProject: boolean;
	/**
	 * Whether a Message control renders — the seller's icon, the business's filled pill, the buyer's
	 * text pill. `false` only when the entity's Message has nobody to reach, or (a business) its
	 * editor sees Manage business in that slot.
	 */
	message: boolean;
	/**
	 * Which control carries the primary slot (`manage` is a tier-4 link to the console, never filled —
	 * a business's or a team's editor; `none` is a business with nobody for Message to reach, whose
	 * slot stays empty).
	 */
	primary: "hire" | "add" | "message" | "manage" | "none";
}

/** The facts about the SELLER that {@link rigFor} branches on. */
export interface RigInput {
	/** Whether the seller has active listings — rows for the Hire popover. */
	hasServices: boolean;
	/** Whether the seller takes discovery calls — the popover's consultation row. */
	offersConsultation: boolean;
	/** Whether the viewer is signed in — Add-to-project lists THEIR projects, so a guest has none. */
	authed: boolean;
	/**
	 * Whether the viewer is a restricted (13–17) account, who cannot hire or bring anyone into a
	 * project (Decision #192). Absent reads as unrestricted.
	 */
	restricted?: boolean;
	/**
	 * Whether the viewer is a member who may edit this workspace's profile — they get its console
	 * link in place of a business's Message or a team's Hire.
	 */
	manages?: boolean;
	/**
	 * Whether the profile's Message reaches anybody — a team's or a business's reaches its owner, and
	 * a read that names none has nobody to reach (Decision #244; Teams P1). Absent reads as reachable.
	 */
	messageable?: boolean;
}

/**
 * Whether a Message from a profile of this kind is delivered to the entity's OWNER rather than to the
 * profile itself — a team or a business, because a direct message is person-to-person and
 * `dm-{slug}` resolves nobody (Decision #244 (C); Teams P1).
 */
export function messagesViaOwner(kind: ProfileKind): boolean {
	return kind === "team" || kind === "business";
}

/**
 * Whether the profile's Message has somebody to reach: always for a person; for a team or a business,
 * only while the read names its owner (`messageTo`).
 */
export function messageReachable(profile: Pick<ProfileView, "kind" | "messageTo">): boolean {
	return !messagesViaOwner(profile.kind) || !!profile.messageTo;
}

/** The action rig a VISITOR sees for a profile kind — see {@link ProfileRig}. */
export function rigFor(kind: ProfileKind, input: RigInput): ProfileRig {
	const messageable = input.messageable !== false;
	if (kind === "business") {
		const primary = input.manages ? "manage" : messageable ? "message" : "none";
		return {
			layout: "business",
			hire: false,
			addToProject: false,
			message: primary === "message",
			primary,
		};
	}
	if (!isSellerKind(kind)) {
		return {
			layout: "buyer",
			hire: false,
			addToProject: false,
			message: true,
			primary: "message",
		};
	}
	// A team's editor manages it rather than hiring it (Teams P1): Manage team takes Hire's slot.
	const manage = kind === "team" && !!input.manages;
	const hire = !manage && !input.restricted && (input.hasServices || input.offersConsultation);
	const addToProject = input.authed && !input.restricted;
	// With neither control (a guest on a seller with nothing to hire for) the row holds only the
	// icon pair; `primary` then names a control that does not render, and the hero draws nothing
	// filled — an honest absence, not a promoted secondary.
	const primary = manage ? "manage" : hire ? "hire" : input.restricted ? "message" : "add";
	return { layout: "seller", hire, addToProject, message: messageable, primary };
}

/** A filled control a rig draws, by its Button-matrix tier (DESIGN_SYSTEM §B.8.1, Decision #183). */
export type RigFill = "hire" | "add" | "message";

/**
 * The FILLED controls a rig draws, in reading order: Hire (tier 3, the teal pill), Add to project
 * (tier 2, the monochrome pill) and a business's Message (tier 3). Every other control is tier 4 —
 * the icon pair, the buyer's text pair and Manage team / Manage business, which is a link and never a
 * fill. One fill per decision region, with the profile seller rig's teal + monochrome pair the one
 * owner-directed exception (Decision #183 flag (a)) — so this never holds two tier-3 fills.
 * `ProfileRig` gates every filled control it draws on this list, so the rule tested here is the one
 * the page renders.
 */
export function rigFills(rig: ProfileRig): RigFill[] {
	const fills: RigFill[] = [];
	if (rig.hire) fills.push("hire");
	if (rig.addToProject) fills.push("add");
	if (rig.layout === "business" && rig.message) fills.push("message");
	return fills;
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

// #region Workspace profiles — the member's view of a team or business page
/**
 * The member notice above a business page outsiders cannot open (BP1, Decision #244): why they
 * cannot. Stated for the member, who is the only reader ever told — as a fact, never as a promise of
 * what one step would change: a business is created `draft` AND `invite_only`, so publishing alone
 * leaves the page missing to outsiders.
 */
export function hiddenNoticeText(reason: ProfileHiddenReason, name: string): string {
	switch (reason) {
		case "draft":
			return `${name} is a draft. Only members can see this page.`;
		case "archived":
			return `${name} is archived. Only members can see this page.`;
		case "invite_only":
			return `${name} is invite-only. Only members can see this page.`;
	}
}

/**
 * The member notice above a TEAM page outsiders cannot open (Teams P1). A draft team whose reach is
 * already public or unlisted opens the moment it is published, so its notice says exactly that
 * ("until the team is published"). A team is CREATED draft and invite-only, and publishing alone
 * would leave that one missing to outsiders, so its notice names both conditions rather than
 * promising what one step would change (#244's rule). An archived or invite-only team states the
 * fact and nothing more.
 */
export function teamHiddenNoticeText(
	reason: ProfileHiddenReason,
	name: string,
	visibility: ProfileView["visibility"],
): string {
	switch (reason) {
		case "draft":
			return visibility === "private"
				? `${name} is a draft. Only members can see this until the team is published and no longer invite-only.`
				: `${name} is a draft. Only members can see this until the team is published.`;
		case "archived":
			return `${name} is archived. Only members can see this page.`;
		case "invite_only":
			return `${name} is invite-only. Only members can see this page.`;
	}
}

/** What a member reads above a hidden team or business page — see {@link memberNoticeFor}. */
export interface MemberNotice {
	/** The one-line fact the InlineNotice states. */
	text: string;
	/**
	 * The console's Settings — the tier-4 link beside the line (BP1 and Teams P1 SPEC 1) — for a
	 * member holding `manage_settings`, once that kind's Settings can publish it and change its
	 * visibility ({@link SETTINGS_PUBLISHES}); `null` for everyone else.
	 */
	settingsHref: string | null;
}

/** A workspace kind — the two whose member notice can carry a Settings link. */
export type WorkspaceProfileKind = "team" | "business";

/**
 * Whether a workspace kind's console Settings can do what the member notice is about — publish the
 * entity, restore it and change its visibility. The notice's tier-4 Settings link renders only where
 * it can, so that it lands on a surface that can act (root CLAUDE.md §3.11). A team's can: Teams C6
 * put Publish, Restore and Visibility on its Settings screen. A business's cannot yet — its Settings
 * module is still a `ModulePlaceholder` — so its link stays withheld by Decision #244 (d); the read
 * keeps carrying `settingsHref` for a `manage_settings` holder, so it returns with this one entry.
 */
export const SETTINGS_PUBLISHES: Readonly<Record<WorkspaceProfileKind, boolean>> = {
	team: true,
	business: false,
};

/**
 * The member notice for a profile, or `null` when there is nothing to tell — a page anybody may
 * open, or a kind with no workspace facts. Only a member ever reaches a hidden page (the database
 * answers it as missing to everyone else), so the notice is never a stranger's to read. The Settings
 * link rides along only for a kind whose Settings can publish (`publishes`, by default
 * {@link SETTINGS_PUBLISHES}).
 */
export function memberNoticeFor(
	profile: Pick<ProfileView, "kind" | "name" | "visibility" | "workspace">,
	publishes: Readonly<Record<WorkspaceProfileKind, boolean>> = SETTINGS_PUBLISHES,
): MemberNotice | null {
	const facts = profile.workspace;
	if (!facts?.hiddenReason) return null;
	const kind = profile.kind;
	const text = kind === "team"
		? teamHiddenNoticeText(facts.hiddenReason, profile.name, profile.visibility)
		: hiddenNoticeText(facts.hiddenReason, profile.name);
	const linked = (kind === "team" || kind === "business") && publishes[kind];
	return { text, settingsHref: linked ? facts.settingsHref : null };
}

/**
 * The owner header's Preview note on a business page for a member who may edit it: the rig they see
 * is not quite the visitors' one (Decision #244 amends #119 (B) for business editors).
 */
export const BUSINESS_PREVIEW_NOTE =
	"This is how your business looks to visitors. They see Message where you see Manage business.";

/**
 * The same note on a team page (Teams P1): Manage team stands in Hire's place for the team's editors
 * only. It does not promise visitors a Hire — a team with nothing to hire for offers none.
 */
export const TEAM_PREVIEW_NOTE =
	"This is how your team looks to visitors, who never see Manage team.";

/**
 * The Preview note for a workspace editor (a viewer whose read carries the console door), or
 * `undefined` for everyone else — the owner nav then shows its plain note.
 */
export function previewNoteFor(
	profile: Pick<ProfileView, "kind" | "workspace">,
): string | undefined {
	if (!profile.workspace?.consoleHref) return undefined;
	if (profile.kind === "business") return BUSINESS_PREVIEW_NOTE;
	if (profile.kind === "team") return TEAM_PREVIEW_NOTE;
	return undefined;
}

/**
 * "Since 2026" — a roster row's membership start, by its UTC year. `null` for an absent or
 * unreadable date, so the row simply leaves the fact out.
 */
export function memberSinceLabel(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return null;
	return `Since ${at.getUTCFullYear()}`;
}

/** One fact on a profile MetaLine — text, or a changing figure set in `tabular-nums`. */
export type ProfileMetaFact = string | { text: string; tabular: true };

/**
 * A roster row's second line, in the order it reads (§B.11 — text, never chips). A team row is its
 * public role · "Since 2025" · its top skill · its next skill (Teams P1); a business row is the
 * title or role · "Since 2026" (BP1). `null` for an enterprise, whose row keeps its plain role line.
 * No stake and no workload is ever part of it.
 */
export function rosterMetaFacts(
	member: Pick<MemberEntry, "role" | "since" | "skills">,
	kind: ProfileKind,
): ProfileMetaFact[] | null {
	if (kind !== "team" && kind !== "business") return null;
	const since = memberSinceLabel(member.since);
	const facts: ProfileMetaFact[] = [member.role];
	if (since) facts.push({ text: since, tabular: true });
	if (kind === "team") facts.push(...(member.skills ?? []).slice(0, 2));
	return facts;
}
// #endregion

// #region Standing — the rung and what it stands on
/** `0.957` → `96%`. */
function percent(rate: number): string {
	return `${Math.round(rate * 100)}%`;
}

/**
 * The factors beneath a TEAM's Standing rung, as MetaLine facts (Teams P1 SPEC 4): on-time
 * delivery, completion and disputes — the client-valued inputs PRODUCT_SPEC §Standing "What moves a
 * rung" names. A team's only: a person's rates are not published, so any other kind gets none. The
 * database answers factors only from the volume floor of the ladder's first earned rung, so one
 * flawless engagement never reads "100% on time · No disputes"; a read without any (or one that
 * somehow counts no stage) gets none here either — a rate over nothing is not a fact. A dispute rate
 * that rounds to nothing still reads 1%, so a record with disputes never claims "No disputes".
 */
export function standingFactorFacts(
	factors: ProfileStandingFactors | undefined,
	kind: ProfileKind,
): ProfileMetaFact[] {
	if (kind !== "team" || !factors || factors.stagesCompleted < 1) return [];
	const disputed = Math.max(1, Math.round(factors.disputeRate * 100));
	const disputes: ProfileMetaFact = factors.disputeRate === 0
		? "No disputes"
		: { text: `${disputed}% disputed`, tabular: true };
	return [
		{ text: `${percent(factors.onTimeRate)} on time`, tabular: true },
		{ text: `${percent(factors.completionRate)} completion`, tabular: true },
		disputes,
	];
}
// #endregion

// #region Reviews — the summary per kind
/** One summary track the Reviews section draws: its label and the aggregate behind it. */
export interface ReviewSummaryTrack {
	label: string;
	track: RatingTrack;
}

/** How the Reviews section summarises a profile of one kind — see {@link reviewSummaryFor}. */
export interface ReviewSummaryLayout {
	tracks: ReviewSummaryTrack[];
	/** Whether the review count is a count Badge beside the stars (a team), rather than `(N)`. */
	countBadge: boolean;
	/** Whether the stance filter applies — only a profile reviewed from both sides has one. */
	stances: boolean;
}

/**
 * The Reviews summary for a profile kind. A person is reviewed on two tracks and filters by
 * stance. A business is only ever the client (BP1). A TEAM's reviews are its collective ones —
 * reviews whose subject is the team, never its members' own (Teams P1) — so it draws ONE aggregate
 * RatingStars with a count Badge and no stance filter: a team is only ever the provider.
 */
export function reviewSummaryFor(
	kind: ProfileKind,
	summary: { asHelper?: RatingTrack; asClient?: RatingTrack } | undefined,
): ReviewSummaryLayout {
	const helper = summary?.asHelper;
	const client = summary?.asClient;
	if (kind === "team") {
		return {
			tracks: helper ? [{ label: "Team rating", track: helper }] : [],
			countBadge: true,
			stances: false,
		};
	}
	const tracks: ReviewSummaryTrack[] = [];
	if (helper) tracks.push({ label: "As a freelancer", track: helper });
	if (client) tracks.push({ label: "As a client", track: client });
	return { tracks, countBadge: false, stances: kind !== "business" };
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
