import { signal } from "@preact/signals";
import { signInHref } from "./view-model.ts";
import { scrollToElement } from "./scroll-to.ts";
import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * view-state — the cross-island signal bridge for the Entity View templates. Islands that live in
 * different mount points (the body header vs the middle-nav header band; the side-nav lane vs the body
 * stage flow / article body) share these module-level signals, exactly like the profile
 * header↔sticky-header bridge (`profile-state.ts`) and the board/submissions footer↔body bridges. A
 * full navigation reloads the page and resets them, which is the intended transient scope.
 */

// #region Entity view — scroll-migrated header
/**
 * Whether the body identity region has scrolled up under the sticky chrome, so the middle-nav header
 * band should reveal the condensed identity.
 *
 * Every non-article archetype — the five commerce bodies and a project — shares it: the body
 * `EntityHeroProbe` flips it and `EntityStickyHeader` in the band reads it. That is safe because
 * `viewHeaderFor` returns exactly ONE band per URL, so only one producer and one consumer are ever
 * mounted together.
 *
 * The band expands from 0 via `min-block-size`/`max-block-size` — never `block-size`, which the
 * frame's grid context overrides (recorded in `profile-skeleton.css`). Reusing the `.pf-stickyhead` skeleton is
 * load-bearing rather than cosmetic: the GUEST shell keys its glass underlay, hairline and elevation
 * off the literal selector `.guest-shell__subheader:has(.pf-stickyhead[data-condensed="true"])`, so a
 * band that drops that class renders unstyled for guests while looking correct when signed in.
 */
export const viewHeaderCondensed = signal(false);

/**
 * Whether the viewer has applied to / expressed interest in this project — optimistic client stub
 * (the real application flow is a Phase-2 route). Shared so the header CTA, sticky header, and lane
 * all reflect the applied state together.
 */
export const projectApplied = signal(false);

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

// #region Stage quick-jumps
/**
 * Select a stage — the quick-jump entry point used by every conversion lane.
 *
 * Every archetype that shows a stage run — a pipeline service, a one-off showcase, and now a project
 * — renders the SAME `StageProgressLedger`, a **server component** built on native `<details>`. It
 * has no signals and cannot observe anything, so a jump drives the DOM directly: open the stage, then
 * bring it into view. This used to write a signal an island observed as well, and the island is gone;
 * a signal nobody reads is a control that appears to work and reaches nothing (root CLAUDE.md §3
 * gate 11), so the write went with it.
 *
 * It uses `scrollToElement` rather than `scrollIntoView`, for two reasons that are both defects it
 * used to have. `scrollIntoView({ block: "start" })` aligns the target with the top of the SCROLLPORT,
 * which on this surface is underneath ~112–152px of pinned chrome — so the stage a reader asked for
 * landed behind the header band. And the scroll was `auto`, which arrived but did not animate;
 * `scrollToElement` requests `smooth` and keeps a watchdog so arrival is still guaranteed in an
 * environment that does not composite frames (see its docblock).
 */
export function jumpToStage(id: string): void {
	try {
		const target = document.getElementById(`stage-${id}`);
		if (!target) return;
		target.querySelector("details")?.setAttribute("open", "");
		scrollToElement(target);
	} catch { /* SSR / no document — nothing to jump to */ }
}
// #endregion

// #region Entity view — seller inquiry (SUPERSEDED)
/*
 * The `inquiryOpen` signal and its `openInquiry` gate lived here, driving `EntityInquiryPopover` — a
 * standalone first-contact composer mounted by the lane, the buy bar and the sticky header.
 *
 * It is gone, and this note is what is left of it. The Contact Me menu
 * (`islands/ContactPopover.island.tsx`) replaced it and covers strictly more: the same inline
 * question composer, plus a discovery-call booking and a structured custom-quote request. Keeping
 * both would have meant two implementations of "message this seller" on one page, with two guest
 * gates and two ways for the composed text to be lost — and the old one had already shipped that
 * defect once (Decision #79: it called `create({ contactIds })` with no body while its own docblock
 * claimed the draft survived).
 *
 * The guest gate moved with it. It is CLIENT-side by necessity and that has not changed:
 * `/api/messaging/*` carries no auth middleware, so a guest's POST would succeed against the fixture
 * stub; and every messaging call rides `apiFetch`, which hard-redirects to `/login` on an
 * unrecoverable 401 — so letting a guest compose would navigate the page out from under them and
 * discard what they typed. The offer's `requiresSignIn` / `signInHref` now carry it, resolved
 * server-side.
 */
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
