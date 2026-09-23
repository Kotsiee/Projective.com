import { signal } from "@preact/signals";
import type { HireProject } from "./profile-model.ts";
import type { ServiceItem } from "../types/profile-types.ts";

/**
 * profile-state — the cross-island signal bridge for the profile surface. Islands that live in
 * different mount points (the hero, the sticky header band, the story, the quick-message popover)
 * share these module-level signals, exactly like the board / submissions footer↔body bridges. A full
 * navigation (a tab anchor) reloads the page and resets them, which is the intended transient scope.
 *
 * Every signal here is written on the CLIENT only. A module-level signal is shared across every
 * request a server process is rendering, so one seeded from a request's props would be a data race
 * between two viewers (the Decision #69 finding); the SSR paint reads props, and these carry the
 * client's edits on top of them.
 */

/*
 * The scroll-migrated header's condensed state is NOT here: it is the shell's shared
 * `headerCondensed` (`@features/shell/core/migrating-header.ts`), one signal for every surface that
 * registers a band, so the profile and the entity view condense on one rule.
 */

// #region The rig's flows — opened from the hero OR the band, mounted once in the hero
/**
 * The listing picked in a Hire popover; non-null opens the service modal. Module-level because the
 * SAME modal answers a pick made in the hero's rig and one made in the band's — two mounted modals
 * for one listing would be two places the buyer's inputs could diverge.
 */
export const pickedService = signal<ServiceItem | null>(null);

/** The project picked in an Add-to-project popover; non-null opens the assignment modal. */
export const pickedProject = signal<HireProject | null>(null);

/**
 * Whether the **Hire** popover is open — ONE fact for the two rigs. The popover itself is anchored
 * to whichever rig is currently the page's (the hero's until the band takes over, then the
 * band's), so an open popover FOLLOWS the control as the reader scrolls instead of trailing the
 * hero's button under the sticky header. Each rig mirrors this into its own `Popover` and presents
 * it only while it is the active rig (`ProfileRig`).
 */
export const hireMenuOpen = signal(false);

/** The same, for the **Add to project** popover. */
export const addMenuOpen = signal(false);

/** Whether the consultation booking modal is open. */
export const consultOpen = signal(false);

/** Whether the create-project wizard is open. */
export const wizardOpen = signal(false);

/**
 * Whether a follow was just acknowledged — the decorative settle + burst every Follow control
 * plays. Shared so the hero's control and the band's control agree, whichever one was pressed.
 */
export const followCelebrating = signal(false);

/** The rig's live-region text — one status line in the hero announces every rig action. */
export const rigStatus = signal("");

/**
 * The control that opened the flow currently in progress — for FOCUS RETURN when its modal closes.
 * A plain holder rather than a signal: a DOM node is not renderable state, and nothing should
 * re-render when it changes.
 */
export const flowOpener: { current: HTMLElement | null } = { current: null };
// #endregion

/**
 * Whether the viewer follows this profile, as the CLIENT last set it — `null` until they press
 * Follow, so every reader falls through to the server's answer (`profile.viewer.follows`) and the
 * SSR paint and the hydrated one agree. Shared so the hero's control and the band's read one fact.
 */
export const following = signal<boolean | null>(null);

/**
 * Whether the profile's floating quick-message popover is open. The hero's Message control sets it;
 * the single `ProfileMessagePopover` mounted beside the hero reads it. Resets on navigation.
 */
export const quickMessageOpen = signal(false);
