import { signal } from "@preact/signals";
import type { SchedulerEngine } from "@ui/calendar/islands/availability-scheduler/types.ts";
import {
	type DevAvailabilityConflict,
	readDevSeam,
	subscribeDevSeam,
} from "@web/utils/dev-seam.ts";
import { schedulerEngine } from "./scheduler-engine.ts";
import { withConflict } from "./availability-conflict.ts";

/**
 * availability-conflict-store — the `availabilityConflict` dev axis as workspace state: the signal
 * the Availability section and the scheduler read, fed from the dev seam. Production never writes the
 * seam, so it stays `auto`.
 */

// #region State
/** The active conflict; `auto` until a workspace mounts {@link watchAvailabilityConflict}. */
export const availabilityConflict = signal<DevAvailabilityConflict>("auto");

/**
 * Follow the dev seam into {@link availabilityConflict}. Call from a mount effect (never during
 * render, so SSR and the first client paint agree); returns the unsubscribe.
 */
export function watchAvailabilityConflict(): () => void {
	availabilityConflict.value = readDevSeam()?.availabilityConflict ?? "auto";
	return subscribeDevSeam((seam) => {
		availabilityConflict.value = seam?.availabilityConflict ?? "auto";
	});
}
// #endregion

/** The workspace's scheduler engine, honouring the conflict axis. Stable, so the scheduler store keeps it. */
export const workspaceSchedulerEngine: SchedulerEngine = withConflict(
	schedulerEngine,
	() => availabilityConflict.value,
);
