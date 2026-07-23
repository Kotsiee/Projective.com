import { signal } from "@preact/signals";
import { signInHref } from "./view-model.ts";
import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * view-state — the cross-island signal bridge for the Entity View templates. Islands that live in
 * different mount points (the body header vs the middle-nav header band; the side-nav lane vs the body
 * stage flow / article body) share these module-level signals, exactly like the profile
 * header↔sticky-header bridge (`profile-state.ts`) and the board/submissions footer↔body bridges. A
 * full navigation reloads the page and resets them, which is the intended transient scope.
 */

// #region Project — scroll-migrated header
/**
 * Whether the project body header has scrolled up under the sticky top bar. The body
 * `ProjectViewHeader` island flips it from a window-scroll probe (identical to the profile
 * `ProfileHeader` probe); the `ProjectStickyHeader` island in the `ui-middle-nav__header` band reads it
 * to slide the condensed identity in (and CSS expands the band from 0). This reuses the exact same
 * `.pf-stickyhead[data-condensed]` mechanics as the profile so the transition behaviour is identical.
 */
export const viewHeaderCondensed = signal(false);

/**
 * Whether the viewer has saved/followed this project — shared so the Save control reads consistently
 * across the body header, the migrated sticky header, and the side-nav lane. Optimistic/client-only
 * until the follow-write path lands.
 */
export const projectSaved = signal(false);

/**
 * Whether the viewer has applied to / expressed interest in this project — optimistic client stub
 * (the real application flow is a Phase-2 route). Shared so the header CTA, sticky header, and lane
 * all reflect the applied state together.
 */
export const projectApplied = signal(false);

/** Toggle the saved state; returns the new value. Shared by the header and the lane. */
export function toggleProjectSaved(): boolean {
	projectSaved.value = !projectSaved.value;
	return projectSaved.value;
}

/**
 * Apply to / express interest in a project. Guests bounce to sign-in (returning to this item);
 * signed-in viewers toggle the optimistic `projectApplied` stub. Returns the new applied state.
 */
export function applyToProject(item: ExploreItem, authed: boolean, ctx: HrefContext): boolean {
	if (!authed) {
		globalThis.location.href = signInHref(item, ctx);
		return false;
	}
	projectApplied.value = !projectApplied.value;
	return projectApplied.value;
}
// #endregion

// #region Project — stage flow ↔ side-nav quick jumps
/**
 * The stage the Stage Flow visualizer currently has expanded. The side-nav quick-jump list writes it
 * (and scrolls the flow into view); the `StageFlow` island reads it to expand + highlight that stage.
 * `null` before any interaction — the flow then defaults to expanding the active stage.
 */
export const selectedStageId = signal<string | null>(null);

/** The id of the stage-flow scroll container, so a quick-jump can bring it into view. */
export const STAGE_FLOW_ANCHOR = "view-stage-flow";

/**
 * Select a stage — the side-nav quick-jump entry point. Sets only the shared signal; the `StageFlow`
 * island reacts by expanding that stage AND scrolling it into view (it owns the scroll so a click
 * inside the flow and a click in the lane behave identically, with no double-scroll).
 */
export function jumpToStage(id: string): void {
	selectedStageId.value = id;
}
// #endregion

// #region Article — table of contents scrollspy
/** The heading id the article scrollspy currently marks active (drives the TOC highlight). */
export const activeTocId = signal<string | null>(null);
// #endregion

// #region Service — availability calendar toggle
/**
 * Whether the Services view's main left showcase currently shows the availability CALENDAR instead of
 * the media gallery. Session / Group Session services offer a `pf-availtoggle` pill in the side-nav
 * lane; toggling it flips this shared signal, which the body `ServiceShowcase` island reads to swap the
 * showcase for the `@projective/ui/calendar` viewport (so clients can pick a slot and book in place).
 * The lane and the showcase are separate mount points, exactly like the stage-flow ↔ lane bridge above.
 */
export const availabilityMode = signal(false);

/** Set the showcase mode (media vs availability calendar). */
export function setAvailabilityMode(next: boolean): void {
	availabilityMode.value = next;
}

/** Toggle the showcase mode; returns the new value. */
export function toggleAvailabilityMode(): boolean {
	availabilityMode.value = !availabilityMode.value;
	return availabilityMode.value;
}
// #endregion
