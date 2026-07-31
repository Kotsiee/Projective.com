import { computed, signal } from "@preact/signals";
import type { WorkspaceDetail, WorkspaceKind } from "@projective/types/workspace";
import { viewMode } from "./view-state.ts";

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

// #region View modes (footer band density control → body)
/**
 * How the Members module presents its roster.
 *
 * `chart` is the org chart — a genuinely different READING of the same people, not a third density,
 * which is why it alone survives as an explicit mode while `cards`/`table` became two halves of the
 * shared zoom (see {@link membersChart}).
 */
export type MembersView = "cards" | "table" | "chart";

/**
 * The org-chart override.
 *
 * The zoom axis runs table → cards; an org chart is not a denser or looser version of either, so it
 * cannot live on that axis. It stays a plain toggle in the footer band, and while it is engaged it
 * wins over whatever the zoom currently selects — releasing it drops the reader back exactly where
 * their density was, rather than to a remembered default they never chose.
 */
export const membersChart = signal<boolean>(false);

/**
 * The Members module's current presentation — DERIVED, never written.
 *
 * Deriving it is what keeps the footer's slider and the body's grid from disagreeing: there is one
 * value (`zoom`) and one override (`membersChart`), so no code path can set a presentation the
 * control does not show.
 */
export const membersView = computed<MembersView>(() =>
	membersChart.value ? "chart" : viewMode.value === "grid" ? "cards" : "table"
);

/** How the roster index presents its entities. */
export type RosterView = "grid" | "table";

/**
 * The roster index's current presentation — DERIVED from the shared zoom, never written.
 *
 * The zoom's own vocabulary is `list`/`grid`; the roster's list half is a TABLE, so the two names are
 * mapped here rather than either side being renamed — the zoom store is shared with four other
 * surfaces whose list half really is a list.
 */
export const rosterView = computed<RosterView>(() => viewMode.value === "grid" ? "grid" : "table");
// #endregion

// #region Policy editor save bridge (footer band → body)
/**
 * A **pulse**, not a flag: the footer's Save button increments this and the body's policy editor reacts
 * to the change.
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
 * Whether the mounted policy editor holds unsaved changes, published so the FOOTER's Save button can be
 * honestly enabled or disabled — the button lives in a different root from the form it saves.
 */
export const policyDirty = signal<boolean>(false);

/** The lifecycle of a policy save, so the footer renders progress instead of an instant, unproven tick. */
export type SaveState = "idle" | "saving" | "saved" | "error";

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
