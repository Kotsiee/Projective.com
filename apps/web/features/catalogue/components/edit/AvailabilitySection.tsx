import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import "../../styles/hours.css";
import { InlineNotice } from "@projective/ui/feedback";
import { Button, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { dateInZone } from "@projective/types/scheduling";
import type { ListingDetail } from "../../types/catalogue-types.ts";
import { upcomingWindows } from "../../core/workspace-store.ts";
import {
	bindingView,
	libraryPresets,
	mirroredNote,
	READINESS_DAYS,
	upcomingWindowCount,
} from "../../core/availability-model.ts";
import {
	availabilityBusy,
	availabilityNotice,
	boundPreset,
	chooseLibraryPreset,
	editorOpen,
	loadPresets,
	mirrored,
	openEditor,
	presets,
	presetsError,
} from "../../core/availability-store.ts";
import { EditSectionFrame } from "./EditSectionFrame.tsx";
import { UpcomingStrip } from "./availability/UpcomingStrip.tsx";
import { AvailabilityEditorDialog } from "./availability/AvailabilityEditorDialog.tsx";

const CUSTOM = "custom";
const DEFAULT = "default";
const PICK_ID = "cat-hours-preset";
const PICK_HINT_ID = "cat-hours-preset-hint";

function browserZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/**
 * AvailabilitySection — when a Session or Group Session can be booked (plan §5.5): which hours it
 * books against (the schedule's default, a library preset, or its own copy), the next fortnight of
 * those hours at a glance, and the scheduler, opened in a full-height dialog. It feeds the publish
 * gate the number of bookable windows in the next 30 days. A restricted (13–17) account books
 * nothing (#208), so for one the whole section is a single notice.
 */
export function AvailabilitySection(
	props: { listing: ListingDetail; restricted: boolean },
): JSX.Element {
	const { listing } = props;

	useEffect(() => {
		if (!props.restricted && presets.peek() === null) void loadPresets();
	}, []);

	useSignalEffect(() => {
		const preset = boundPreset.value;
		upcomingWindows.value = preset
			? upcomingWindowCount(preset, dateInZone(Date.now(), preset.timezone))
			: undefined;
	});

	if (props.restricted) {
		return (
			<EditSectionFrame section="availability">
				<InlineNotice
					align="start"
					text="Bookable hours open when your account is 18 or over. Until then this listing can't take bookings."
				/>
			</EditSectionFrame>
		);
	}

	const binding = listing.availabilityBinding;
	const preset = boundPreset.value;
	const view = bindingView(binding, preset);
	const library = libraryPresets(presets.value ?? []);
	const loading = presets.value === null && presetsError.value === null;
	const pickValue = binding?.mode === "override"
		? CUSTOM
		: binding?.mode === "preset"
		? binding.presetId ?? DEFAULT
		: DEFAULT;
	const defaultName = library.find((p) => p.isDefault)?.name;
	const pickOptions = [
		{ value: DEFAULT, label: defaultName ? `Your default (${defaultName})` : "Your default" },
		...library.filter((p) => !p.isDefault).map((p) => ({ value: p.id, label: p.name })),
		...(binding?.mode === "override" ? [{ value: CUSTOM, label: "Custom for this service" }] : []),
	];
	const windows = upcomingWindows.value;
	const note = mirroredNote(mirrored.value);

	return (
		<EditSectionFrame
			section="availability"
			intro="When buyers can book this. Sessions are booked inside your working hours."
		>
			{presetsError.value
				? (
					<InlineNotice
						align="start"
						text={presetsError.value}
						actionLabel="Retry"
						onAction={() => void loadPresets()}
					/>
				)
				: (
					<>
						<p class="cat-hours__binding" aria-live="polite">
							{loading ? "Loading your hours…" : view?.sentence ?? "No hours set yet."}
						</p>

						{library.length > 1 && (
							<div class="cat-sec__field">
								<label class="cat-sec__label" for={PICK_ID}>Hours to use</label>
								<Select
									id={PICK_ID}
									options={pickOptions}
									value={pickValue}
									onValueChange={(v) => {
										if (v === CUSTOM || v === pickValue) return;
										void chooseLibraryPreset(v === DEFAULT ? null : v);
									}}
									disabled={availabilityBusy.value}
									aria-describedby={PICK_HINT_ID}
								/>
								<p class="cat-sec__hint" id={PICK_HINT_ID}>
									A preset's changes reach every listing that uses it.
								</p>
							</div>
						)}

						{preset && (
							<UpcomingStrip preset={preset} today={dateInZone(Date.now(), preset.timezone)} />
						)}

						{windows === 0 && (
							<p class="cat-offer__problem">
								Nothing is bookable in the next {READINESS_DAYS}{" "}
								days, so this listing can't be published yet.
							</p>
						)}
						{note && <p class="cat-sec__hint">{note}</p>}
						{!editorOpen.value && availabilityNotice.value && (
							<p class="cat-sec__hint" role="status">{availabilityNotice.value}</p>
						)}

						<div>
							<Button
								label={preset ? "Edit availability" : "Set your availability"}
								icon={<Icon name="calendar" size="xs" />}
								severity="neutral"
								variant="outlined"
								size="sm"
								disabled={loading}
								onClick={() => openEditor(preset?.timezone ?? browserZone())}
							/>
						</div>
					</>
				)}
			<AvailabilityEditorDialog listing={listing} />
		</EditSectionFrame>
	);
}
