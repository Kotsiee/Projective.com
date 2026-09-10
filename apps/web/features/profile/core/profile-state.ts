import { signal } from "@preact/signals";

/**
 * profile-state — the cross-island signal bridge for the profile surface. Islands that live in
 * different mount points (the hero, the story, the quick-message popover) share these module-level
 * signals, exactly like the board / submissions footer↔body bridges. A full navigation (a tab anchor)
 * reloads the page and resets them, which is the intended transient scope.
 */

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
