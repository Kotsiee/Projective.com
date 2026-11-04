import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/calendar-chrome.css";
import "../styles/availability-page.css";
import { CalendarZoom, SCHEDULER_LAYERS } from "@projective/ui/calendar";
import { Button, SelectButton } from "@projective/ui/fields";
import type { PresetListResult } from "@projective/types/scheduling";
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
import { availabilityZoom, pageViewerOf, usePageScheduler } from "../core/availability-page.ts";
import { pageValueOf } from "../components/AvailabilityPageParts.tsx";

/** Props for {@link AvailabilityFooter}. */
export interface AvailabilityFooterProps {
	initial: PresetListResult | null;
	presetSlug: string | null;
	/** The viewer's `org.user_preferences.locale`, so the shared store is made the same everywhere. */
	locale?: string;
}

/**
 * AvailabilityFooter — the middle-nav FOOTER band on `/calendar?view=availability`, on the agenda
 * rig's three-part grid (Decision #377): the layer the grid paints (Hours or Calls) on the leading
 * edge, where the agenda keeps its display lens; the zoom ruler in the centre (Day · Week · Month, the
 * grid's Ctrl+wheel moving the same value); and what is unsaved, Discard, and Save — the band's one
 * filled commit — on the trailing edge.
 *
 * Save writes the open template, compiled for the booking gate and, for the default, mirrored into
 * the profile's weekly hours; Discard drops its edits. Other templates edited and not saved are
 * counted, so a reader moving between them knows what Save does not cover. A page that opened on a
 * restored local draft says so ("Local draft restored"), and its Discard becomes Discard changes,
 * which drops every unsaved template back to what is stored, and the draft with them.
 */
export default function AvailabilityFooter(props: AvailabilityFooterProps): JSX.Element {
	const store = usePageScheduler(
		pageValueOf(props.initial, props.presetSlug),
		pageViewerOf(props.locale),
	);
	// The toggle stays controlled through a local signal that follows the store's layer.
	const layer = useSignal<string>(store.layer.peek());
	useSignalEffect(() => {
		layer.value = store.layer.value;
	});

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
			<SelectButton
				class="cal-avfoot__layer"
				options={SCHEDULER_LAYERS}
				value={layer}
				size="sm"
				aria-label="Layer"
				onValueChange={(next) => {
					const picked = SCHEDULER_LAYERS.find((l) => l.value === next);
					if (picked) store.setLayer(picked.value);
				}}
			/>

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
					loading={busy}
					disabled={!dirty}
					onClick={() => void saveDraft()}
				/>
			</div>
		</div>
	);
}
