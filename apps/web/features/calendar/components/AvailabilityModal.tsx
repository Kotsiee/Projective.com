import type { JSX } from "preact";
import "../styles/availability-modal.css";
import "../styles/availability-page.css";
import {
	AvailabilityScheduler,
	type LibraryItem,
	type PresetBinding,
} from "@projective/ui/calendar";
import { displayLocale } from "@projective/ui/display";
import { Dialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { dateInZone, type PresetUser } from "@projective/types/scheduling";
import type { ListingDetail } from "@features/catalogue/types/catalogue-types.ts";
import { SCHEDULER_TEMPLATES } from "@features/catalogue/core/scheduler-engine.ts";
import { workspaceSchedulerEngine } from "@features/catalogue/core/availability-conflict-store.ts";
import { pageViewerOf } from "../core/availability-page.ts";
import { schedulerPricing } from "../core/availability-pricing.ts";
import { TimeOffManager } from "./AvailabilityPageParts.tsx";
import {
	bindingView,
	libraryPresets,
	UNSAVED_PRESET_ID,
} from "@features/catalogue/core/availability-model.ts";
import {
	archiveWorking,
	availabilityBusy,
	availabilityNotice,
	boundPreset,
	closeEditor,
	drafts,
	editorOpen,
	intent,
	isUnsaved,
	newPreset,
	presets,
	presetsError,
	revertToDefault,
	saveAsPreset,
	saveEditor,
	schedule,
	selectPreset,
	storedOf,
	usage,
	working,
} from "@features/catalogue/core/availability-store.ts";

const OWNER_LABEL: Record<PresetUser["kind"], string> = {
	service: "",
	profile: "Profile",
	team: "Team",
	business: "Business",
};

/** A follower as the library's meta line names it. */
function userLabel(user: PresetUser): string {
	return user.kind === "service" ? user.name : OWNER_LABEL[user.kind];
}

/** Props for {@link AvailabilityModal}. */
export interface AvailabilityModalProps {
	/** The listing whose hours these are; omit to manage the owner's templates alone. */
	listing?: ListingDetail;
}

/**
 * AvailabilityModal — the availability editor in a dialog, opened from the listing workspace and
 * Settings → Scheduling & calls; `/calendar` and the profile's hours page use the full-page manager,
 * `/calendar?view=availability` (Decision #376), over the same store. A wide dialog over the scheduler's
 * three resizable panes: the templates (each with who follows it), the open template's settings and
 * rules on the left; the shared Calendar engine in the middle, Week first and zoomable from a day to
 * months with every rule applied; and the rule editor on the right while a rule is open.
 *
 * It edits copies: nothing is written until Save. Inside a listing the binding line names whose hours
 * these are and Save also binds the listing; without one, Save keeps the modal open on the saved
 * template so the next one can be edited. Time off, last in the side pane, is the schedule's rather
 * than a template's, so — as on the page's lane — booking or removing it writes at once.
 */
export function AvailabilityModal(props: AvailabilityModalProps): JSX.Element {
	const { listing } = props;
	const value = working.value;
	const stored = storedOf(value);
	const followers = usage.value;
	const pending = drafts.value;
	const dirty = value ? isUnsaved(value) : false;

	const items: LibraryItem[] = libraryPresets(presets.value ?? []).map((p) => ({
		id: p.id,
		name: p.name,
		isDefault: p.isDefault,
		usedBy: (followers[p.id] ?? []).map(userLabel),
		unsaved: Boolean(pending[p.id]) || (p.id === value?.id && dirty),
	}));
	const fresh = value?.id === UNSAVED_PRESET_ID ? value : pending[UNSAVED_PRESET_ID];
	if (fresh) items.push({ id: UNSAVED_PRESET_ID, name: fresh.name, unsaved: true });

	let barBinding: PresetBinding | undefined;
	let consequence = dirty ? "Unsaved changes" : "";
	if (listing) {
		const binding = listing.availabilityBinding;
		const view = bindingView(binding, boundPreset.value);
		const forked = binding?.mode === "override" || intent.value === "override";
		const presetName = view?.presetName ?? value?.name ?? "General";
		barBinding = forked
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
				onOverride: stored ? () => (intent.value = "override") : undefined,
			};
		consequence = forked ? "Saves for this service only." : "Saves for every service using it.";
	}
	const status = availabilityNotice.value ?? presetsError.value ?? consequence;
	// The dialog only renders once opened in the browser, where the shell has seeded the viewer's
	// locale (`org.user_preferences.locale`) into the display store.
	const viewer = pageViewerOf(displayLocale.value);

	return (
		<Dialog
			visible={editorOpen}
			onVisibleChange={(open) => {
				if (!open) closeEditor();
			}}
			header={listing ? `Availability · ${listing.title}` : "Availability"}
			width="var(--overlay-w-full)"
			height="calc(100dvh - 2rem)"
			class="av-modal"
			footer={
				<div class="av-modal__foot">
					<p class="av-modal__status" role="status">{status}</p>
					<Button label="Cancel" variant="text" onClick={closeEditor} />
					<Button
						label="Save"
						loading={availabilityBusy.value}
						disabled={!listing && !dirty}
						onClick={() => void saveEditor()}
					/>
				</div>
			}
		>
			{value && (
				<AvailabilityScheduler.Root
					value={value}
					onChange={(next) => (working.value = next)}
					engine={workspaceSchedulerEngine}
					today={dateInZone(Date.now(), value.timezone)}
					weekStartsOn={viewer.weekStartsOn}
					pricing={schedulerPricing(schedule.value)}
					label={`Availability · ${value.name}`}
				>
					<AvailabilityScheduler.Studio
						stateKey="availability-studio"
						side={
							<>
								<AvailabilityScheduler.Library
									items={items}
									activeId={value.id}
									onSelect={selectPreset}
									templates={SCHEDULER_TEMPLATES}
									onCreate={(t) => newPreset(t, value.timezone)}
								/>
								<AvailabilityScheduler.Details
									binding={barBinding}
									lockDefault={stored?.isDefault ?? false}
									onArchive={stored && !stored.isDefault ? () => void archiveWorking() : undefined}
								/>
								<AvailabilityScheduler.RuleList />
								<AvailabilityScheduler.Issues />
								<section class="ui-avsched__section" aria-labelledby="av-modal-timeoff">
									<div class="ui-avsched__section-head">
										<h3 class="ui-avsched__heading" id="av-modal-timeoff">Time off</h3>
									</div>
									<TimeOffManager
										settings={schedule.value}
										weekStartsOn={viewer.weekStartsOn}
									/>
								</section>
							</>
						}
					>
						<AvailabilityScheduler.Calendar />
					</AvailabilityScheduler.Studio>
				</AvailabilityScheduler.Root>
			)}
		</Dialog>
	);
}
