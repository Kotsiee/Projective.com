import { computed, signal } from "@preact/signals";
import type {
	ArchiveBlockerCode,
	WorkspaceDetail,
	WorkspaceKind,
} from "@projective/types/workspace";
import { peopleZoom, viewMode } from "./view-state.ts";
import type { RosterTab } from "./roster-model.ts";
import type { ModuleCommit } from "./header-model.ts";
import type { SaveState } from "./rig-model.ts";
import { MEMBERS_CHART, type SubView, subViewSearch } from "./sub-views.ts";

/**
 * workspace-state — the cross-island signal bridge for the `/teams` and `/businesses` surface.
 *
 * The surface renders as **four independent hydration roots**: the middle-nav lane, the header band, the
 * footer band, and the page body — plus `BodyPortal`-mounted overlays that live outside all four. None of
 * them is an ancestor of the others, so **there is nothing to prop-drill through**: a footer Save button
 * cannot receive a callback from the body, and the lane cannot be handed the detail the body just
 * refetched. Module-level signals are the sanctioned coordination channel (the documented footer↔body
 * pattern of `wallet/core/wallet-state.ts` and `projects/core/board-state.ts`).
 *
 * Two rules keep this file from becoming a second, competing store:
 *
 *   1. **Server truth is not duplicated here.** {@link liveDetail} is a *relay* for the projection the
 *      server already returned, never a locally-mutated copy. A band reads it; no band edits it.
 *   2. **Only cross-root state belongs here.** Anything one island owns alone stays a `useSignal` inside
 *      that island, so a module's local UI state cannot leak across a navigation.
 */

// #region Live detail relay (body → lane / header / footer)
/**
 * The freshest {@link WorkspaceDetail} the surface has seen, published by whichever root last received
 * one from the server.
 *
 * This exists because every mutation returns the FULL refreshed detail, and the bands that must react to
 * it are not in the body's tree. A role change rewrites `viewerCapabilities`, which decides the lane's
 * visible modules; an archive rewrites `status`, which the header band renders. Without a relay the lane
 * would keep offering a module the viewer just lost — a nav that disagrees with its own routes.
 *
 * `null` means "nothing published yet": a band must fall back to its SSR props rather than render empty,
 * because the first paint happens before any island has published.
 */
export const liveDetail = signal<WorkspaceDetail | null>(null);

/** Publish a server-returned detail so every band re-renders from the same truth. */
export function publishDetail(detail: WorkspaceDetail): void {
	liveDetail.value = detail;
}

/**
 * Clear the relay. Called when leaving an entity, so a stale detail can never bleed into the next
 * workspace's first paint and briefly show one entity's capabilities against another's name.
 */
export function clearDetail(): void {
	liveDetail.value = null;
}

/** The published detail's viewer capabilities, or an empty set before anything is published. */
export const liveCapabilities = computed(() => liveDetail.value?.viewerCapabilities ?? []);
// #endregion

// #region Archive refusal relay (Settings body → header band)
/** What a refused archive named, and the entity it refused. */
export interface ArchiveRefusal {
	/** The entity the server refused to archive (`WorkspaceDetail.id`). */
	id: string;
	/** The blocker codes the refusal named, in the server's order — never empty. */
	codes: readonly ArchiveBlockerCode[];
}

/**
 * The blockers a refused archive named since the last read, or `null` — the server's own answer, not
 * a local guess. Settings (Teams C6) publishes it the moment the archive door refuses: Settings shows
 * the codes in the button's place, and the header band withholds its Archive… for that entity, so no
 * root keeps offering a control the server has just refused, even when the re-read that would bring
 * the counted blockers fails. Settings clears it when it adopts a re-read detail (which carries the
 * blockers itself) and when it unmounts.
 */
export const archiveRefusal = signal<ArchiveRefusal | null>(null);
// #endregion

// #region Create modal (roster empty state · lane `＋` · header action)
/** Whether the Create-entity modal is open. */
export const createModalOpen = signal<boolean>(false);

/**
 * The kind the create modal opens seeded to. Pre-selected rather than asked, because the viewer arrived
 * from `/teams` or `/businesses` and already told us which they wanted — re-asking would be a question
 * whose answer we can see.
 */
export const createSeedKind = signal<WorkspaceKind>("team");

/** Open the Create-entity modal, seeding the kind from the surface the trigger sits on. */
export function openCreate(kind?: WorkspaceKind): void {
	if (kind) createSeedKind.value = kind;
	createModalOpen.value = true;
}

/** Close the Create-entity modal. */
export function closeCreate(): void {
	createModalOpen.value = false;
}
// #endregion

// #region Invite modal (members module · lane action · setup checklist)
/** Whether the Invite-member modal is open. */
export const inviteModalOpen = signal<boolean>(false);

/**
 * The role id the invite modal opens seeded to, or `null` for the entity's default. Seeded when the
 * trigger already implies a role — inviting from a role's own row should not make the sender pick it
 * again.
 */
export const inviteSeedRoleId = signal<string | null>(null);

/** Open the Invite-member modal, optionally seeding the offered role. */
export function openInvite(roleId?: string): void {
	inviteSeedRoleId.value = roleId ?? null;
	inviteModalOpen.value = true;
}

/** Close the Invite-member modal. */
export function closeInvite(): void {
	inviteModalOpen.value = false;
	inviteSeedRoleId.value = null;
}
// #endregion

// #region Module sub-view (header band tabs · lane context · footer rig → body)
/**
 * The console module's sub-view (`sub-views.ts`) — ONE value for every root that offers or honours it:
 * the header band's TabMenu, the lane's context control, the footer rig's Org chart toggle and the
 * body. Each control writes it through {@link selectModuleView}; none keeps a copy of its own.
 *
 * `null` until a control picks one. Each root renders its server-resolved `?view=` prop until then
 * ({@link viewOr}), so the first painted byte and the first hydrated frame agree, and a value written
 * during one request's SSR can never leak into the next request's render (nothing writes it on the
 * server). A workspace page has no client navigation, so the value always belongs to the module the
 * document was rendered for.
 */
export const moduleView = signal<string | null>(null);

/** The sub-view a root renders: the one a control picked, else its own server-resolved value. */
export function viewOr(resolved: string | null): string | null {
	return moduleView.value ?? resolved;
}

/**
 * Pick the module's sub-view on every root, and keep the address in step — `?view=` set, or dropped
 * for the default — with `replaceState`, so a reload or a copied link lands on the same view. Replaced
 * rather than pushed: the surface does not answer `popstate`, and a Back that rewrote the address
 * without the view would be an address that lies.
 */
export function selectModuleView(value: string, views: readonly SubView[]): void {
	moduleView.value = value;
	const location = globalThis.location;
	const history = globalThis.history;
	if (!location || !history) return;
	try {
		history.replaceState(
			history.state,
			"",
			`${location.pathname}${subViewSearch(location.search, views, value)}${location.hash}`,
		);
	} catch { /* an address that cannot be rewritten still leaves every root on the picked view */ }
}
// #endregion

// #region View modes (footer band density control → body)
/**
 * How the Members module presents its roster.
 *
 * `chart` is the org chart — a genuinely different READING of the same people, not a third density,
 * which is why it is a sub-view of its own while `cards`/`table` are two halves of the shared zoom.
 */
export type MembersView = "cards" | "table" | "chart";

/**
 * The Members module's presentation for a sub-view — DERIVED, never stored.
 *
 * The zoom axis runs table → cards; an org chart is not a denser or looser version of either, so it
 * is the `chart` sub-view, and while it is selected it wins over whatever the zoom selects —
 * releasing it drops the reader back exactly where their density was. One value (People's own
 * `zoom`, which opens on the table) and one sub-view mean no code path can set a presentation the
 * controls do not show. Reads the zoom signal, so a component calling it during render re-renders
 * with the zoom.
 */
export function membersViewFor(view: string | null): MembersView {
	if (view === MEMBERS_CHART) return "chart";
	return peopleZoom.viewMode.value === "grid" ? "cards" : "table";
}

/** How the roster index presents its entities. */
export type RosterView = "grid" | "table";

/**
 * The roster index's PARTITION (All · Owned · Member · Invitations · Archived) — ONE value for every
 * root that offers it: the lane's segmented control and the canvas's TabMenu both write it through
 * {@link selectRosterTab}, and each mirrors it into its own control's binding (the lane's segmented
 * value, the TabMenu's active index), so the two controls always show the same partition.
 *
 * `null` until a control on either root picks one. Each root renders its server-resolved `?view=`
 * prop until then ({@link rosterTabOr}), so the first painted byte and the first hydrated frame agree,
 * and a module-level value written during one request's SSR can never leak into the next request's
 * render. The canvas keeps the address in step (`replaceState`, from a `useSignalEffect`).
 */
export const rosterTab = signal<RosterTab | null>(null);

/** Pick the roster partition on every root that shows it. */
export function selectRosterTab(tab: RosterTab): void {
	rosterTab.value = tab;
}

/** The partition a root renders: the one a control picked, else its own server-resolved value. */
export function rosterTabOr(resolved: RosterTab): RosterTab {
	return rosterTab.value ?? resolved;
}

/**
 * Whether the roster index is in its FIRST RUN (`roster-model.ts` `isFirstRun`) — published by the
 * canvas, which alone sees a retried read or an answered invitation change it, and read by the lane,
 * whose footer withholds its create while the canvas's empty state carries it. `null` until the
 * canvas publishes; the lane then reads the same rule over its own SSR roster.
 */
export const rosterFirstRun = signal<boolean | null>(null);

/** Publish the canvas's first-run reading to the other roots. */
export function publishRosterFirstRun(firstRun: boolean): void {
	rosterFirstRun.value = firstRun;
}

/**
 * The roster index's current presentation — DERIVED from the shared zoom, never written.
 *
 * The zoom's own vocabulary is `list`/`grid`; the roster's list half is a TABLE, so the two names are
 * mapped here rather than either side being renamed — the zoom store is shared with four other
 * surfaces whose list half really is a list.
 */
export const rosterView = computed<RosterView>(() => viewMode.value === "grid" ? "grid" : "table");
// #endregion

// #region Module commit (body → header band)
/**
 * The open module's commit — the header band's ONE filled action ("Publish team" on a draft's
 * Settings) — or `null` when the module has none (Members has none). The module's island publishes it
 * through `useModuleCommit`, which also clears it when the module unmounts; the band only renders it.
 */
export const moduleCommit = signal<ModuleCommit | null>(null);
// #endregion

// #region Policy editor save bridge (footer band → body)
/**
 * A **pulse**, not a flag: the footer's Save button increments this and the body's policy editor reacts
 * to the change (`usePolicyBridge`).
 *
 * It is a counter rather than a boolean because a boolean can only fire once — a second Save while the
 * flag was still `true` would produce no signal change and silently do nothing, which on a money-policy
 * editor means a split the reader believes they saved. A monotonically increasing count always differs
 * from its predecessor, so every press lands.
 */
export const saveRequested = signal<number>(0);

/** Ask the mounted policy editor to persist. Safe to call when nothing is listening — it is a no-op. */
export function requestSave(): void {
	saveRequested.value = saveRequested.value + 1;
}

/**
 * The footer's Discard, as a pulse for the same reason as {@link saveRequested}: the editor answers it
 * by returning every field to its last saved value.
 */
export const discardRequested = signal<number>(0);

/** Ask the mounted policy editor to drop its unsaved changes. A no-op when nothing is listening. */
export function requestDiscard(): void {
	discardRequested.value = discardRequested.value + 1;
}

/**
 * Whether the mounted policy editor holds unsaved changes, published so the FOOTER can offer Save and
 * Discard only while there is something to save — the buttons live in a different root from the form.
 */
export const policyDirty = signal<boolean>(false);

/** The lifecycle of a policy save, so the footer renders progress instead of an instant, unproven tick. */
export type { SaveState };

/** The current save lifecycle state. */
export const saveState = signal<SaveState>("idle");

/**
 * Reset the save bridge. Called when a module unmounts or the viewer navigates, so a `dirty` flag or an
 * `error` state from one editor never greets the next one.
 */
export function resetSaveBridge(): void {
	policyDirty.value = false;
	saveState.value = "idle";
}
// #endregion
