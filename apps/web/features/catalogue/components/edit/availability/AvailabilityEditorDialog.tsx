import type { JSX } from "preact";
import { AvailabilityScheduler, type PresetBinding } from "@projective/ui/calendar";
import { Dialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { dateInZone } from "@projective/types/scheduling";
import type { ListingDetail } from "../../../types/catalogue-types.ts";
import { SCHEDULER_TEMPLATES, schedulerEngine } from "../../../core/scheduler-engine.ts";
import {
	bindingView,
	libraryPresets,
	schedulerPresetOf,
} from "../../../core/availability-model.ts";
import {
	availabilityBusy,
	availabilityNotice,
	boundPreset,
	closeEditor,
	editorOpen,
	intent,
	presets,
	revertToDefault,
	saveAsPreset,
	saveEditor,
	working,
} from "../../../core/availability-store.ts";

/**
 * AvailabilityEditorDialog — the rule-based scheduler (`@projective/ui/calendar`) in a full-height
 * dialog, so the Edit form stays scannable. It edits a copy: nothing is written until Save, which
 * saves the preset (compiling it for the booking gate) and then the listing's binding. The binding
 * line says whose hours these are — the library preset every linked listing follows, or this
 * service's own — with the actions plan §5.5 names.
 */
export function AvailabilityEditorDialog(props: { listing: ListingDetail }): JSX.Element {
	const { listing } = props;
	const value = working.value;
	const binding = listing.availabilityBinding;
	const view = bindingView(binding, boundPreset.value);
	const forked = binding?.mode === "override" || intent.value === "override";
	const presetName = view?.presetName ?? value?.name ?? "General";

	const barBinding: PresetBinding = forked
		? {
			mode: "forked",
			presetName,
			onRevert: binding?.mode === "override"
				? () => void revertToDefault()
				: () => (intent.value = "linked"),
			onSaveAsPreset: () => void saveAsPreset(`${listing.title.trim().slice(0, 50)} hours`),
		}
		: {
			mode: "linked",
			presetName,
			onEditPreset: () => (intent.value = "linked"),
			onOverride: boundPreset.value ? () => (intent.value = "override") : undefined,
		};

	const consequence = forked
		? "Saving makes these hours this service's own. Other listings keep theirs."
		: `Saving changes ${presetName} for every listing that uses it.`;

	return (
		<Dialog
			visible={editorOpen}
			onVisibleChange={(open) => {
				if (!open) closeEditor();
			}}
			header={`Availability · ${listing.title}`}
			width="min(72rem, calc(100vw - 2rem))"
			height="calc(100dvh - 2rem)"
			footer={
				<div class="cat-hours__dialog-foot">
					<p class="cat-hours__consequence" role="status">
						{availabilityNotice.value ?? consequence}
					</p>
					<div class="cat-sec__dialog-actions">
						<Button label="Cancel" severity="neutral" variant="outlined" onClick={closeEditor} />
						<Button
							label="Save"
							loading={availabilityBusy.value}
							onClick={() => void saveEditor()}
						/>
					</div>
				</div>
			}
		>
			{value && (
				<AvailabilityScheduler.Root
					value={value}
					onChange={(next) => (working.value = next)}
					engine={schedulerEngine}
					today={dateInZone(Date.now(), value.timezone)}
					label={`Availability for ${listing.title}`}
				>
					<AvailabilityScheduler.PresetBar
						templates={SCHEDULER_TEMPLATES}
						presets={libraryPresets(presets.value ?? []).map(schedulerPresetOf)}
						binding={barBinding}
					/>
					<AvailabilityScheduler.Toolbar />
					<AvailabilityScheduler.WeekCanvas />
					<AvailabilityScheduler.MonthPreview />
					<AvailabilityScheduler.RuleList />
					<AvailabilityScheduler.RuleEditor />
					<AvailabilityScheduler.Issues />
				</AvailabilityScheduler.Root>
			)}
		</Dialog>
	);
}
