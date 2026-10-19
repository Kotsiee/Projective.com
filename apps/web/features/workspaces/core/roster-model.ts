import type { MetaLineEntry } from "@ui/display/core/meta-line.tsx";
import { currencyExponent, type MoneyView } from "@projective/types/finance";
import {
	kindCopy,
	roleLabel,
	workspaceBase,
	type WorkspaceKind,
	type WorkspaceStat,
	type WorkspaceStatus,
	type WorkspaceSummary,
} from "@projective/types/workspace";
import { type CreateTier, isFilled } from "./create-model.ts";

/**
 * roster-model — the `/teams` and `/businesses` INDEX canvas as pure functions of what the viewer is
 * looking at (Teams work order R1).
 *
 * The canvas (`islands/WorkspaceRoster.island.tsx`), its cards and its table are bindings over these:
 * the partition vocabulary and the address that remembers it, which of the five canvas states is on
 * screen, which buttons each state draws and at which tier of the Button Interaction Matrix (and so
 * how many of them fill), what the head and each card say, and the lifecycle `Tag` that appears only
 * when an entity is NOT active. Keeping them here is what lets the acceptance rules — one filled
 * control per state, the lane's create withheld in first run, no chip on any metadata — be tested
 * without a DOM, and keeps `/businesses` on the same rules as `/teams` (Decision #61): every kind
 * difference is a lookup in {@link kindCopy} or in this file's own per-kind tables.
 *
 * Pure: no signals, no DOM, no registry import, so `deno test` loads it directly (the module registry
 * reaches CSS through its glyphs). Money is never computed here — the card's figure is the server's
 * pre-formatted stat, rendered verbatim (Decision #55).
 */

// #region Partitions
/**
 * The roster index's partitions. `invitations` is a genuinely different list (invitations addressed to
 * the VIEWER, not entities they belong to), which is why it is a partition rather than a filter, and
 * `archived` keeps a finished entity reachable — nothing is ever hard-deleted (root CLAUDE.md §5).
 */
export type RosterTab = "all" | "owned" | "member" | "invitations" | "archived";

/** One partition as the canvas's TabMenu and the lane's segmented control name it. */
export interface RosterTabOption {
	value: RosterTab;
	label: string;
}

/**
 * The canvas's partitions, in TabMenu order. The lane's segmented control offers the same words minus
 * Archived (`lane-model.ts`), so the two controls over the ONE shared partition never disagree on a
 * label.
 */
export const ROSTER_TABS: readonly RosterTabOption[] = [
	{ value: "all", label: "All" },
	{ value: "owned", label: "Owned" },
	{ value: "member", label: "Member" },
	{ value: "invitations", label: "Invitations" },
	{ value: "archived", label: "Archived" },
];

/** Coerce a raw query value to a partition, else `all`. */
export function toRosterTab(raw: string | null | undefined): RosterTab {
	return ROSTER_TABS.some((tab) => tab.value === raw) ? raw as RosterTab : "all";
}

/** A partition's position in {@link ROSTER_TABS} — the TabMenu's active index. */
export function rosterTabIndex(tab: RosterTab): number {
	return Math.max(0, ROSTER_TABS.findIndex((option) => option.value === tab));
}

/**
 * Filter the roster for a partition and an optional search term.
 *
 * Archived entities are excluded from every partition except `archived`: nothing is ever hard-deleted,
 * so an archived entity must remain reachable — but leaving it in the default list would make a tidied
 * roster look untidied. The `invitations` partition shows no entities at all (its rows are the incoming
 * invites the strip renders), so it returns empty rather than the full list.
 */
export function filterRoster(
	items: readonly WorkspaceSummary[],
	tab: RosterTab,
	search = "",
): WorkspaceSummary[] {
	const needle = search.trim().toLowerCase();
	return items.filter((item) => {
		if (tab === "invitations") return false;
		if (tab === "archived") {
			if (item.status !== "archived") return false;
		} else if (item.status === "archived") return false;
		if (tab === "owned" && !item.isOwner) return false;
		if (tab === "member" && item.isOwner) return false;
		if (!needle) return true;
		return item.name.toLowerCase().includes(needle) ||
			item.handle.toLowerCase().includes(needle) ||
			item.tagline.toLowerCase().includes(needle);
	});
}

/**
 * A partition's count `Badge` in the TabMenu — every partition carries its size, so Owned, Member and
 * Archived are counted somewhere (the head counts only the live total and the invitations waiting). A
 * count is one of the containers §B.11 allows; an empty partition carries none rather than a `0`.
 */
export function rosterTabBadge(
	tab: RosterTab,
	counts: Readonly<Record<RosterTab, number>>,
): number | undefined {
	const count = counts[tab];
	return count > 0 ? count : undefined;
}

/** How many rows each partition would show — computed once from one pass. */
export function rosterTabCounts(
	items: readonly WorkspaceSummary[],
	invitations: readonly { id: string }[],
): Record<RosterTab, number> {
	const live = items.filter((i) => i.status !== "archived");
	return {
		all: live.length,
		owned: live.filter((i) => i.isOwner).length,
		member: live.filter((i) => !i.isOwner).length,
		invitations: invitations.length,
		archived: items.filter((i) => i.status === "archived").length,
	};
}

/**
 * Whether the reader has narrowed the roster — a partition other than All, or a search term. Only then
 * does an empty result earn a Clear filters: an unfiltered roster that shows nothing has nothing to
 * clear.
 */
export function isFiltered(tab: RosterTab, search: string): boolean {
	return tab !== "all" || search.trim().length > 0;
}
// #endregion

// #region The address
/**
 * The query key the partition rides in. It is the console's sub-view key too, so a TabMenu's choice
 * is `?view=` everywhere on the surface.
 */
export const ROSTER_VIEW_PARAM = "view";

/** The key the partition rode in before R1 — still READ, so an old link lands where it pointed; never written. */
export const LEGACY_ROSTER_TAB_PARAM = "tab";

/** The canvas's search term. */
export const ROSTER_SEARCH_PARAM = "q";

/**
 * A one-shot flash a redirect leaves (`?notice=unavailable`, `console-route.ts`). The canvas shows it
 * from the server-resolved prop and the address drops it, so a reload does not say it again.
 */
export const ROSTER_NOTICE_PARAM = "notice";

/** The partition an address asks for: `?view=`, else the legacy `?tab=`, else All. */
export function rosterTabFromSearch(params: URLSearchParams): RosterTab {
	return toRosterTab(params.get(ROSTER_VIEW_PARAM) ?? params.get(LEGACY_ROSTER_TAB_PARAM));
}

/**
 * The search string an address should carry for a partition and a search term, from the current one:
 * `?view=` set (dropped for All), `?q=` set (dropped when blank), the legacy `?tab=` and the one-shot
 * `?notice=` dropped, every other parameter kept. Returns `""` or `"?…"`, so a caller compares it with
 * `location.search` directly.
 */
export function rosterSearch(current: string, tab: RosterTab, query: string): string {
	const params = new URLSearchParams(current);
	params.delete(LEGACY_ROSTER_TAB_PARAM);
	params.delete(ROSTER_NOTICE_PARAM);
	if (tab === "all") params.delete(ROSTER_VIEW_PARAM);
	else params.set(ROSTER_VIEW_PARAM, tab);
	const term = query.trim();
	if (term) params.set(ROSTER_SEARCH_PARAM, term);
	else params.delete(ROSTER_SEARCH_PARAM);
	const out = params.toString();
	return out ? `?${out}` : "";
}

/** The roster index's address for one partition — `/teams?view=archived`; All is the bare base. */
export function rosterHref(kind: WorkspaceKind, tab: RosterTab = "all"): string {
	return `${workspaceBase(kind)}${rosterSearch("", tab, "")}`;
}
// #endregion

// #region Lifecycle
/** A lifecycle status as a `Tag`'s words and tone — the one container a status may take (§B.11). */
export interface LifecycleTag {
	label: string;
	severity: "warning" | "success" | "secondary";
}

/** Every lifecycle status as a `Tag` — the console's header strip names the active state too. */
export function statusTag(status: WorkspaceStatus): LifecycleTag {
	if (status === "draft") return { label: "Draft", severity: "warning" };
	if (status === "archived") return { label: "Archived", severity: "secondary" };
	return { label: "Active", severity: "success" };
}

/**
 * The roster's lifecycle `Tag` — ONLY for an entity that is not active (Draft, Archived). Active is
 * the norm, and a Tag on every healthy card or row would teach the reader to ignore the one that is
 * not.
 */
export function lifecycleTag(status: WorkspaceStatus): LifecycleTag | null {
	return status === "active" ? null : statusTag(status);
}
// #endregion

// #region Canvas state
/**
 * What the canvas body shows:
 *
 *   - `error` — no roster read has succeeded: the failure and Try again, nothing else. "You have no
 *     teams yet" drawn for somebody whose teams merely failed to load would be a false statement.
 *   - `first-run` — the read succeeded and the viewer has no entity of this kind at all (archived
 *     included) and no invitation waiting: the selling `EmptyState` with the one structural create.
 *   - `invitations` — the Invitations partition, where the invitation strip IS the list.
 *   - `empty` — a partition or a search that leaves nothing.
 *   - `populated` — cards or a table.
 */
export type RosterCanvasState = "error" | "first-run" | "invitations" | "empty" | "populated";

/** What the canvas state is decided on. */
export interface RosterCanvasInput {
	/** Whether a roster read has succeeded since the page loaded. */
	loaded: boolean;
	/** Every entity of this kind the viewer belongs to, archived included. */
	entityCount: number;
	/** Invitations still waiting on the viewer (answered ones excluded). */
	invitationCount: number;
	/** The rows the partition and the search leave. */
	rowCount: number;
	/** Whether the invitation strip is the list (`invitationStripIsTheList`). */
	stripIsTheList: boolean;
}

/**
 * First run: a successful read with no entity of this kind and nothing to answer. The lane reads the
 * same rule (from its own SSR roster until the canvas publishes), so the two can never disagree about
 * who carries the one create action.
 */
export function isFirstRun(
	input: Pick<RosterCanvasInput, "loaded" | "entityCount" | "invitationCount">,
): boolean {
	return input.loaded && input.entityCount === 0 && input.invitationCount === 0;
}

/** The canvas state — total over its inputs. */
export function rosterCanvasState(input: RosterCanvasInput): RosterCanvasState {
	if (!input.loaded) return "error";
	if (isFirstRun(input)) return "first-run";
	if (input.stripIsTheList) return "invitations";
	return input.rowCount === 0 ? "empty" : "populated";
}

/**
 * Whether the head's search field and the partition TabMenu are drawn. Not in first run (there is
 * nothing to partition) and not while nothing has loaded (there is nothing to filter).
 */
export function rosterToolsShown(state: RosterCanvasState): boolean {
	return state !== "first-run" && state !== "error";
}
// #endregion

// #region Copy
/** The first-run state's words, per kind. */
export interface RosterFirstRunCopy {
	title: string;
	/** One sentence on what the entity is — from PRODUCT_SPEC, no new claims. */
	description: string;
	/** The one structural create's label. */
	action: string;
	/**
	 * Business only — what it does for the viewer, as a short body list under the sentence (BU1). Each
	 * entry is one plain sentence; the team's first run has none.
	 */
	points?: readonly string[];
}

/**
 * The first-run words. The team sentence is PRODUCT_SPEC's "Virtual Agency" (§Teams, "No Incorporation
 * Required"); the business sentence is its "What is a Projective Business?" — both restated, not
 * extended. The business keeps the title its empty state has always had: it hires, where a team
 * delivers.
 *
 * The business's three points restate the same section's pillars (one buying identity, a pooled
 * wallet several people fund and spend from, governed spending) and claim nothing a free business
 * lacks: per-member caps and an approval threshold are Business Pro (Decision #230 (e)), so the third
 * point says so rather than promising "limits you set" to everyone.
 */
const FIRST_RUN: Record<WorkspaceKind, RosterFirstRunCopy> = {
	team: {
		title: "Start a team",
		description:
			"Form a group, invite members and start accepting enterprise-level projects without setting up a legal entity or a joint bank account.",
		action: "Create a team",
	},
	business: {
		title: "Hire as a company",
		description:
			"A business acts as the employer of record for the work your colleagues request, and gives you one central place to manage it.",
		action: "Create a business",
		points: [
			"One company identity your whole staff hires under.",
			"Several people can add money to one pooled wallet and spend from it.",
			"You decide who may spend from it — and, on Business Pro, how much each person may spend and what needs approval first.",
		],
	},
};

/**
 * The first-run copy. When the viewer's plan admits no entity of this kind, the server's own reason
 * (it carries the plan's number) follows the sentence — the create is withheld rather than drawn dead,
 * so the reason is the only place the page says why.
 */
export function rosterFirstRunCopy(
	kind: WorkspaceKind,
	blockedReason: string | null = null,
): RosterFirstRunCopy {
	const copy = FIRST_RUN[kind];
	const reason = blockedReason?.trim();
	return reason ? { ...copy, description: `${copy.description} ${reason}` } : copy;
}

/** A partition or a search that leaves nothing — what it says. */
export interface RosterEmptyCopy {
	title: string;
	description: string;
	/** Whether a tier-5 Clear filters returns the reader to everything — only when something is filtered. */
	clear: boolean;
}

/** What an empty partition's words are decided on. */
export interface RosterEmptyInput {
	tab: RosterTab;
	search: string;
	/** Archived entities of this kind — All points at them when it is otherwise empty. */
	archivedCount: number;
	/**
	 * Whether the invitation strip is on screen above the body (`invitationStripShown`). Once the reader
	 * dismisses it, nothing is above, so an empty All points at the Invitations partition instead.
	 */
	stripShown: boolean;
}

/**
 * The words for an empty partition. Never the first-run pitch: somebody who has just filtered does
 * not need to be told what a team is, and never a create — the lane's footer carries it outside
 * first run.
 */
export function rosterEmptyCopy(kind: WorkspaceKind, input: RosterEmptyInput): RosterEmptyCopy {
	const { noun, plural } = kindCopy(kind);
	const clear = isFiltered(input.tab, input.search);
	if (input.search.trim()) {
		return {
			title: "Nothing matches that",
			description: `Try a shorter term, or clear the filters to see every ${noun}.`,
			clear,
		};
	}
	switch (input.tab) {
		case "owned":
			return {
				title: `You don't own a ${noun}`,
				description: `A ${noun} you create is listed here.`,
				clear,
			};
		case "member":
			return {
				title: `You're not a member of anyone else's ${noun}`,
				description: `A ${noun} you join by invitation is listed here.`,
				clear,
			};
		case "archived":
			return {
				title: "Nothing archived",
				description:
					`A ${noun} you are finished with is archived rather than deleted, and listed here.`,
				clear,
			};
		case "invitations":
			return {
				title: "No invitations waiting",
				description: `When someone invites you to a ${noun}, it appears here.`,
				clear,
			};
		case "all":
			return input.archivedCount > 0
				? {
					title: `No active ${plural}`,
					description: `Your archived ${plural} are under Archived.`,
					clear,
				}
				: {
					title: `You're not in a ${noun} yet`,
					description: input.stripShown
						? "Answer an invitation above to join one."
						: "Your invitations are under Invitations.",
					clear,
				};
	}
}
// #endregion

// #region Controls
/** A button the canvas draws. */
export type RosterControlKey = "create" | "clear" | "retry";

/**
 * One canvas button and its tier in the Button Interaction Matrix (DESIGN_SYSTEM §B.8.1): the
 * first-run create is tier 2 (the monochrome structural fill), Try again tier 4 (the matrix's own
 * utility example), Clear filters tier 5 (an escape hatch). The island spreads `tierProps(tier)` onto
 * each and spells no tone of its own, so the tier here is the tier on screen.
 */
export interface RosterControl {
	key: RosterControlKey;
	label: string;
	tier: CreateTier;
}

/** What the canvas's buttons are decided on. */
export interface RosterControlsInput {
	kind: WorkspaceKind;
	state: RosterCanvasState;
	/** Whether the viewer may create another entity of this kind (the roster's `canCreate`). */
	canCreate: boolean;
	/** Whether the reader has narrowed the roster ({@link isFiltered}). */
	filtered: boolean;
	/** Whether the last roster read failed — the error notice and its Try again are up. */
	readError: boolean;
}

/**
 * The canvas's buttons, in render order. The head holds none (the lane footer's create is the
 * index's one structural commit — the canvas never duplicates it); first run moves that commit here,
 * and the lane (`lane-model.ts`) and the footer band's rig (`rig-model.ts`) both withhold theirs, so
 * the page offers exactly one create.
 */
export function rosterCanvasControls(input: RosterControlsInput): RosterControl[] {
	const out: RosterControl[] = [];
	if (input.readError) out.push({ key: "retry", label: "Try again", tier: 4 });
	if (input.state === "first-run" && input.canCreate) {
		out.push({ key: "create", label: FIRST_RUN[input.kind].action, tier: 2 });
	}
	if (input.state === "empty" && input.filtered) {
		out.push({ key: "clear", label: "Clear filters", tier: 5 });
	}
	return out;
}

/** How many of a set of controls draw filled. */
export function filledCount(controls: readonly { tier: CreateTier }[]): number {
	return controls.filter((control) => isFilled(control.tier)).length;
}
// #endregion

// #region The head
/**
 * A count with its noun, kind-aware — `1 team` / `3 teams`. Uses the SSOT's per-kind copy table so a
 * screen never inlines the word "team".
 */
export function countLabel(kind: WorkspaceKind, count: number): string {
	const copy = kindCopy(kind);
	return `${count} ${count === 1 ? copy.noun : copy.plural}`;
}

/** What the head's MetaLine reads from. */
export interface RosterHeadInput {
	state: RosterCanvasState;
	/** Entities that are not archived. */
	liveCount: number;
	invitationCount: number;
	/** The entity of this kind the session is acting as, by name, or `null`. */
	actingName: string | null;
}

/**
 * The head's facts — `3 teams · 1 invitation waiting · Acting as North Loop`, every figure tabular.
 * Nothing in first run or before a read has succeeded: the canvas body says everything there is to
 * say then, and "0 teams" over a pitch to start one would only repeat it.
 */
export function rosterHeadMeta(kind: WorkspaceKind, input: RosterHeadInput): MetaLineEntry[] {
	if (input.state === "first-run" || input.state === "error") return [];
	const out: MetaLineEntry[] = [{ text: countLabel(kind, input.liveCount), tabular: true }];
	if (input.invitationCount > 0) {
		out.push({
			text: `${input.invitationCount} invitation${input.invitationCount === 1 ? "" : "s"} waiting`,
			tabular: true,
		});
	}
	if (input.actingName) out.push(`Acting as ${input.actingName}`);
	return out;
}

/**
 * The live count line over a narrowed roster — `1 team`, `2 teams matching` — or `""` when nothing is
 * narrowed (the head already says the total) or nothing is listed (the empty state, or the invitation
 * strip on Invitations, already says what there is). The line is a polite live region, so it stays
 * mounted and only its words change.
 */
export function rosterCountLine(
	kind: WorkspaceKind,
	input: { state: RosterCanvasState; tab: RosterTab; search: string; rowCount: number },
): string {
	if (input.state !== "populated" || !isFiltered(input.tab, input.search)) return "";
	const matching = input.search.trim() ? " matching" : "";
	return `${countLabel(kind, input.rowCount)}${matching}`;
}
// #endregion

// #region The card
/** `1 member` / `4 members`. */
function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * A card's facts as ONE MetaLine — `Owner · 4 members · 2 live projects`, then `Acting` while the
 * session acts as the entity. Role and counts are metadata, never chips (§B.11); the counts are
 * tabular.
 */
export function cardMeta(summary: WorkspaceSummary): MetaLineEntry[] {
	const out: MetaLineEntry[] = [
		roleLabel(summary.role),
		{ text: plural(summary.memberCount, "member"), tabular: true },
		{ text: plural(summary.activeProjects, "live project"), tabular: true },
	];
	if (summary.isActing) out.push("Acting");
	return out;
}

/**
 * The card's one figure: the kind's 30-day money stat — what a team earned, what a business spent —
 * already formatted by the server. It is the third of `rosterStats`' three (members and live projects
 * are the MetaLine's), or `null` when the projection carries none.
 */
export function cardFigure(summary: WorkspaceSummary): WorkspaceStat | null {
	return summary.stats[2] ?? null;
}

/** The card's member faces, in the shape the ui `AvatarStack` draws. */
export interface CardPeople {
	/** The faces the server sent (up to five), in its order — every one drawn. */
	people: { name: string; avatar: string | null }[];
	/** The whole membership, so the stack's `+N` counts everyone not drawn. */
	total: number;
	/** The stack's one composed name: `3 members: Ada, Ben, Cy` or `5 of 12 members: …`. */
	label: string;
}

/**
 * Who is on the entity: the server's sample of member faces and a `+N` for the rest of the
 * membership. The MetaLine states the head count; the faces say WHO — circles, because those are
 * people, beside the entity's square mark. `null` when the projection carries no faces, so a card never
 * draws an empty stack.
 */
export function cardPeople(
	summary: Pick<WorkspaceSummary, "faces" | "memberCount">,
): CardPeople | null {
	const faces = summary.faces;
	if (faces.length === 0) return null;
	const total = Math.max(summary.memberCount, faces.length);
	const names = faces.map((face) => face.name).join(", ");
	const count = faces.length === total
		? plural(total, "member")
		: `${faces.length} of ${plural(total, "member")}`;
	return {
		people: faces.map((face) => ({ name: face.name, avatar: face.avatar || null })),
		total,
		label: `${count}: ${names}`,
	};
}

/** Draft-First setup as a whole percentage, for the ProgressBar and the words beside it. */
export function setupPercent(progress: number): number {
	return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

/**
 * Whether the card still shows the setup meter — it leaves at 100%, a finished checklist is noise. The
 * meter's fill is the kind token (`--wsp-kind`, set on the ProgressBar's accent by the roster sheet), so
 * it follows the team / business tone under every colour-vision overlay (Decision #251) — business is
 * `--tertiary` in every mode (Decision #230 (j)) — never a fixed ProgressBar severity.
 */
export function setupUnfinished(progress: number): boolean {
	return setupPercent(progress) < 100;
}
// #endregion

// #region The grid
/**
 * The card grid's track width for a zoom-driven card width (`gridColWidth`, in px), as the `Grid`'s
 * `minChildWidth`.
 *
 * The grid lays `fit="exact"` tracks — every card exactly the zoom's width — so the zoom scales cards
 * continuously instead of in column-count jumps. Once two tracks no longer fit, though, that leaves a
 * single card stranded beside an empty strip (a 278px card in a 358px phone column). The track is
 * therefore the zoom's width while two fit and the full row otherwise:
 * `clamp(w, (2w + gap − 100%) × 10⁵, 100%)` — the middle term is hugely negative when two tracks fit
 * (so the floor `w` wins) and hugely positive when they do not (so the ceiling, the whole row, wins).
 * Pure CSS: no width observer, so the server's first paint and the hydrated frame agree.
 */
export function rosterTrackWidth(px: number, gap = "var(--space-4)"): string {
	const w = Math.max(0, Math.round(px));
	return `clamp(${w}px, calc((${2 * w}px + ${gap} - 100%) * 100000), 100%)`;
}
// #endregion

// #region The table
/** One column of the roster's `DataTable`, as the contract the table builds its descriptors from. */
export interface RosterColumn {
	id: "name" | "role" | "members" | "projects" | "spent" | "status" | "updated";
	header: string;
	/** Counts sit right-aligned, in tabular figures. */
	align: "start" | "end";
	/**
	 * Importance when the table is too narrow — the `DataTable` hides the LOWEST first; unset never
	 * hides.
	 */
	priority?: number;
}

/**
 * A team's table columns, in order: Name · Your role · Members · Live projects · Status · Updated (a
 * business adds Spent (30d), {@link BUSINESS_ROSTER_COLUMNS}). Every one sorts; Status shows a `Tag` only for a non-active entity ({@link lifecycleTag}); selection is
 * none — a row opens its console.
 *
 * A narrowing table gives up the least essential column first: Updated, then Your role (the acting
 * row keeps its tint), then Live projects, then Members. Name and Status never hide, so a Draft or
 * Archived `Tag` is on screen at every width.
 */
export const ROSTER_COLUMNS: readonly RosterColumn[] = [
	{ id: "name", header: "Name", align: "start" },
	{ id: "role", header: "Your role", align: "start", priority: 2 },
	{ id: "members", header: "Members", align: "end", priority: 4 },
	{ id: "projects", header: "Live projects", align: "end", priority: 3 },
	{ id: "status", header: "Status", align: "start" },
	{ id: "updated", header: "Updated", align: "start", priority: 1 },
];

/**
 * A business's columns (BU1): Name · Your role · Members · Live projects · Spent (30d) · Status ·
 * Updated. Spent is what the business spent in the last 30 days, one server-formatted figure per
 * currency (never summed, never converted, no period delta); it sits right-aligned in tabular figures
 * beside the other counts. Updated stays, as R1 made it for both kinds, and still leaves first.
 *
 * A narrowing table gives up Updated, then Your role, then Live projects, then Members, and Spent
 * last: on a phone a business row still says what it spent, and Name and Status never hide.
 */
export const BUSINESS_ROSTER_COLUMNS: readonly RosterColumn[] = [
	{ id: "name", header: "Name", align: "start" },
	{ id: "role", header: "Your role", align: "start", priority: 2 },
	{ id: "members", header: "Members", align: "end", priority: 4 },
	{ id: "projects", header: "Live projects", align: "end", priority: 3 },
	{ id: "spent", header: "Spent (30d)", align: "end", priority: 5 },
	{ id: "status", header: "Status", align: "start" },
	{ id: "updated", header: "Updated", align: "start", priority: 1 },
];

/** The table's columns for a kind — a team's {@link ROSTER_COLUMNS}, a business's {@link BUSINESS_ROSTER_COLUMNS}. */
export function rosterColumns(kind: WorkspaceKind): readonly RosterColumn[] {
	return kind === "business" ? BUSINESS_ROSTER_COLUMNS : ROSTER_COLUMNS;
}

/**
 * The Spent (30d) cell's figures: the server's per-currency `money30d`, in its order (largest first),
 * or `null` when nothing moved — the table then draws its own empty mark. Each figure is drawn in its
 * own currency; the client never totals or converts them (Decision #55).
 */
export function rosterSpent(
	summary: Pick<WorkspaceSummary, "money30d">,
): readonly MoneyView[] | null {
	return summary.money30d.length > 0 ? summary.money30d : null;
}

/**
 * The Spent column's SORT KEY: the row's largest figure in major units, compared across currencies
 * the way the backend picks the card's figure (`largestAmount`) so a JPY total is not read as a
 * hundred times a USD one. It only orders rows — it is never shown, never converted and never summed —
 * and a row that spent nothing sorts below every row that did (`-1`).
 */
export function spentSortValue(summary: Pick<WorkspaceSummary, "money30d">): number {
	let best = -1;
	for (const figure of summary.money30d) {
		const major = figure.minor / 10 ** currencyExponent(figure.currency);
		if (major > best) best = major;
	}
	return best;
}

/**
 * The status column's sort order — the lifecycle's own order (draft, active, archived), not the
 * alphabet, so "sort by status" groups entities the way their lives run.
 */
export function statusSortValue(status: WorkspaceStatus): number {
	return status === "draft" ? 0 : status === "active" ? 1 : 2;
}
// #endregion
