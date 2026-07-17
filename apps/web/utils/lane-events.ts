/**
 * Cross-island lane events — shared window `CustomEvent` names used to coordinate between the
 * middle-nav lane content (a feature island) and the shell's `MiddleNavSplitter` island that owns the
 * lane width. Kept in the app-shared `utils` layer so neither feature imports the other.
 */

/**
 * Dispatched on `window` when the lane's footer collapse/expand toggle is pressed. The
 * `MiddleNavSplitter` (via `useSplitter`'s `collapseEventName`) listens for it and toggles the lane
 * between its collapsed rail width and the last expanded width. Detail carries the desired state so a
 * source can force a direction; omit `detail` to plain-toggle.
 */
export const MIDDLE_LANE_TOGGLE_EVENT = "projective:middle-lane-toggle";

/** Optional `detail` payload for {@link MIDDLE_LANE_TOGGLE_EVENT}. */
export interface MiddleLaneToggleDetail {
	/** Force a direction; omit to toggle. */
	collapsed?: boolean;
}
