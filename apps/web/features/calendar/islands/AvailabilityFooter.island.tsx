import type { JSX } from "preact";
import "../styles/calendar-chrome.css";
import "../styles/availability-page.css";
import { CalendarZoom } from "@projective/ui/calendar";
import { Button } from "@projective/ui/fields";
import {
	availabilityBusy,
	availabilityNotice,
	discardWorking,
	drafts,
	isUnsaved,
	presetsError,
	working,
} from "@features/catalogue/core/availability-store.ts";
import { discardDraft, draftRestored, hasPending, saveDraft } from "../core/availability-draft.ts";
import { availabilityZoom } from "../core/availability-page.ts";

/**
 * AvailabilityFooter — the middle-nav FOOTER band on `/calendar?view=availability`, on the agenda
 * rig's three-part grid (Decision #377): the zoom ruler in the centre (Day · Week · Month, the grid's
 * Ctrl+wheel moving the same value), and what is unsaved, Discard, and Save — the band's one filled
 * commit, brand primary (§B.8.1 tier 3) — on the trailing edge. Availability is one layer (Decision
 * #408), so the leading edge, where the agenda keeps its display lens, holds no layer switch.
 *
 * Save writes the open template, compiled for the booking gate and, for the default, mirrored into
 * the profile's weekly hours; Discard drops its edits. Other templates edited and not saved are
 * counted, so a reader moving between them knows what Save does not cover. A page that opened on a
 * restored local draft says so ("Local draft restored"), and its Discard becomes Discard changes,
 * which drops every unsaved template back to what is stored, and the draft with them.
 */
export default function AvailabilityFooter(): JSX.Element {
	const value = working.value;
	const dirty = value ? isUnsaved(value) : false;
	const others = Object.keys(drafts.value).filter((id) => id !== value?.id).length;
	const busy = availabilityBusy.value;
	const restored = draftRestored.value;
	const status = availabilityNotice.value ?? presetsError.value ??
		(restored
			? "Local draft restored"
			: dirty
			? "Unsaved changes"
			: others
			? `${others} other template${others === 1 ? "" : "s"} not saved`
			: "");

	return (
		<div class="cal-rig cal-avfoot">
			<CalendarZoom
				class="cal-rig__zoom"
				mode="calendar"
				value={availabilityZoom.value}
				onValueChange={(u) => (availabilityZoom.value = u)}
			/>

			<div class="cal-rig__actions">
				<p class="cal-avfoot__status" role="status">{status}</p>
				{restored
					? (
						<Button
							label="Discard changes"
							size="sm"
							variant="text"
							severity="secondary"
							disabled={!hasPending() || busy}
							onClick={discardDraft}
						/>
					)
					: (
						<Button
							label="Discard"
							size="sm"
							variant="text"
							severity="secondary"
							disabled={!dirty || busy}
							onClick={discardWorking}
						/>
					)}
				<Button
					label="Save"
					size="sm"
					severity="primary"
					loading={busy}
					disabled={!dirty}
					onClick={() => void saveDraft()}
				/>
			</div>
		</div>
	);
}
