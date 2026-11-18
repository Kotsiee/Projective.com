import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { CalendarDropState } from "../hooks/useCalendarDrop.ts";

/**
 * CalendarDropOverlay — what the calendar body shows while a file is held over it (Decision #442): the
 * scrim tone over the grid and one drop target in the middle, saying what a drop will do, or that the
 * file held is not one it can read. Nothing renders while no file is in the air.
 *
 * The scrim is the overlay family's own (`--scrim` at `--scrim-tint`), and the target is a full
 * dashed border because it is the one interactive thing on screen while the drag lasts (§B.4).
 */
export function CalendarDropOverlay({ state }: { state: CalendarDropState }): JSX.Element | null {
	if (!state) return null;
	const ok = state === "ok";
	return (
		<div class="cal-drop" data-state={state}>
			<div class="cal-drop__target" role="status" aria-live="polite">
				<Icon name="upload" size="md" class="cal-drop__glyph" aria-hidden="true" />
				<p class="cal-drop__title">
					{ok ? "Drop to import into your calendar" : "That isn’t one calendar file"}
				</p>
				<p class="cal-drop__note">
					{ok
						? "Its events are saved as your own, to edit like any other."
						: "Drop a single .ics, .ical or .vcs file."}
				</p>
			</div>
		</div>
	);
}
