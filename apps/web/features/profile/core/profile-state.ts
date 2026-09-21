import { signal } from "@preact/signals";
import type { PublicCallOffer } from "@projective/types/scheduling";
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

// #region Scroll-migrated header
/**
 * Whether the hero's action rig has scrolled up under the shell's chrome, so the middle-nav header
 * band should reveal the condensed identity + the same rig. The hero flips it from its scroll probe
 * (`hooks/useCondenseProbe.ts`); the `ProfileStickyHeader` island in the band reads it — the same
 * producer/consumer shape as the entity view's `viewHeaderCondensed`.
 */
export const profileHeaderCondensed = signal(false);
// #endregion

// #region The rig's flows — opened from the hero OR the band, mounted once in the hero
/**
 * The listing picked in a Hire popover; non-null opens the service modal. Module-level because the
 * SAME modal answers a pick made in the hero's rig and one made in the band's — two mounted modals
 * for one listing would be two places the buyer's inputs could diverge.
 */
export const pickedService = signal<ServiceItem | null>(null);

/** The project picked in an Add-to-project popover; non-null opens the assignment modal. */
export const pickedProject = signal<HireProject | null>(null);

/** Whether the consultation booking modal is open. */
export const consultOpen = signal(false);

/** Whether the create-project wizard is open. */
export const wizardOpen = signal(false);

/**
 * The seller's LIVE call offer once the Dev Context Switcher's `callOffer` axis has re-read it, or
 * `undefined` while the server's own answer (each island's prop) still stands. Never seeded from
 * props: see the module note above.
 */
export const liveConsultation = signal<PublicCallOffer | null | undefined>(undefined);

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
 * Whether the viewer follows this profile — shared so the Follow control reads consistently wherever
 * it appears. Optimistic/client-only until the follow-write path lands. Resets on navigation (new
 * page = fresh module scope), which is fine — the SSR'd initial state is re-seeded by the hero on mount.
 */
export const following = signal(false);

/**
 * Whether the profile's floating quick-message popover is open. The hero's Message control sets it;
 * the single `ProfileMessagePopover` mounted beside the hero reads it. Resets on navigation.
 */
export const quickMessageOpen = signal(false);

/**
 * The OWNER's in-place image edit — the profile picture chosen through the Asset Picker, or `null`
 * while the server's projection is still what everyone is looking at.
 *
 * `null` means "unchanged" rather than "empty", so a reader falls through to the server's value and
 * nothing here can blank a profile picture that exists. Optimistic and session-local, like every other
 * inline profile edit, pending the profile write path.
 */
export const editedAvatar = signal<string | null>(null);

/**
 * The OWNER's in-place showcase edit — a cover image chosen through the Asset Picker. Same `null`
 * contract as {@link editedAvatar}. Only an IMAGE can be chosen this way today; a showreel upload
 * lands with the live write path.
 */
export const editedShowcase = signal<string | null>(null);
