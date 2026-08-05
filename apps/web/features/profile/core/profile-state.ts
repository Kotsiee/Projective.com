import { signal } from "@preact/signals";

/**
 * profile-state — the cross-island signal bridge for the profile shell. Two islands that live in
 * different mount points (the body header vs the middle-nav header band; the action lane vs the body)
 * share these module-level signals, exactly like the board / submissions footer↔body bridges. A full
 * navigation (a tab anchor) reloads the page and resets them, which is the intended transient scope.
 */

/**
 * Whether the main body profile header has scrolled up past the sticky top bar. The body
 * `ProfileHeader` island flips it from an IntersectionObserver on a sentinel at the header's foot; the
 * `ProfileStickyHeader` island in the `ui-middle-nav__header` band reads it to slide the condensed
 * header in (and CSS expands the band from 0). Reduced-motion collapses the transition (global rule).
 */
export const headerCondensed = signal(false);

/**
 * Whether the OWNER has toggled "Edit Profile" in the action lane. Flips the lane from its default
 * contextual actions to the management side-nav (Services · Products · … + Profile/Availability/
 * Settings quick-links, root CLAUDE.md Part 3.2). Inline editing (story, + New Service) is NOT gated on
 * this — it is always available to the owner (Part 3.3); this only reshapes the lane.
 */
export const editMode = signal(false);

/**
 * Whether the viewer follows this profile — shared so the Follow control reads consistently wherever
 * it appears (body header · migrated sticky header · action lane). Optimistic/client-only until the
 * follow-write path lands. Resets on navigation (new page = fresh module scope), which is fine — the
 * SSR'd initial state is re-seeded by the header island on mount.
 */
export const following = signal(false);

/**
 * Whether the profile's floating quick-message popover is open (task §3). The Message buttons — in the
 * action lane (rail + stack) and in the body/sticky `ProfileActions` header — set it; the single
 * `ProfileMessagePopover` mounted in the action lane reads it. A shared signal because the triggers live
 * in different islands from the popover. Resets on navigation (new page = fresh module scope).
 */
export const quickMessageOpen = signal(false);

/**
 * The OWNER's in-place image edits — the cover and the profile picture chosen through the Asset
 * Picker, or `null` while the server's projection is still what everyone is looking at.
 *
 * Shared rather than local to the body header because the same avatar is drawn in TWO islands: the
 * body header and the condensed `ProfileStickyHeader` in the middle-nav band. A local signal would
 * change one of them, and the mismatch would surface at exactly the moment the owner scrolled to check
 * their change had taken.
 *
 * `null` means "unchanged" rather than "empty", so a reader falls through to the server's value and
 * nothing here can blank a profile picture that exists. Optimistic and session-local, like every other
 * inline profile edit, pending the profile write path.
 */
export const editedBanner = signal<string | null>(null);
export const editedAvatar = signal<string | null>(null);
