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
