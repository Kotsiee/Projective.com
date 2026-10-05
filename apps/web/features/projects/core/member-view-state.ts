import { signal } from "@preact/signals";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import { createZoomStore } from "@web/utils/zoom-store.ts";

/**
 * Members view-state — the roster's instance of the shared cross-island density model
 * (`@web/utils/zoom-store.ts`), plus the footer ↔ body bridge for the one action the footer owns.
 *
 * The footer rig (`MemberViewControlRig`) and the roster body (`MemberRoster`) are separate islands;
 * they coordinate through these module-level signals exactly as the File Explorer's do. One continuous
 * `zoom` drives both the list⇄card switch (the centre marker) and the card width within the grid half.
 * A member card carries an avatar seam, a name, a role line and a foot, so its ramp starts wider than a
 * file tile's; a list row stays tall enough for a 2.5rem avatar.
 */

// #region Store
const store = createZoomStore({
	storageKey: LocalKeys.MEMBERS_ZOOM,
	/** The default density: a comfortable card grid. */
	initial: 0.62,
	gridColumn: { min: 224, max: 340 },
	listRow: { min: 52, max: 76 },
});

export const { zoom, viewMode, gridColWidth, listRowHeight } = store;

/** The whole store, for the shared `ViewZoomRig` / `useCtrlWheelZoom`, which take it as one value. */
export const membersZoom = store;
// #endregion

// #region Invite bridge
/**
 * Whether the acting viewer may invite on the roster being shown — published by the body once its
 * capabilities resolve, read by the footer to render the Invite trigger at all.
 */
export const inviteAvailable = signal<boolean>(false);

/** The Invite modal's open state — the footer trigger sets it, the body's modal binds it. */
export const inviteOpen = signal<boolean>(false);

/** Publish whether inviting is available; closes the modal when it stops being so. */
export function setInviteAvailable(available: boolean): void {
	inviteAvailable.value = available;
	if (!available) inviteOpen.value = false;
}

/** Open the Invite modal (the footer trigger). No-op unless inviting is available. */
export function openInvite(): void {
	if (inviteAvailable.value) inviteOpen.value = true;
}
// #endregion
