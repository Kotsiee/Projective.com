import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { NumberInput, Select, ToggleSwitch } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import type { OwnerAvailability, OwnerCallSettings } from "@projective/types/scheduling";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import { ProfileService } from "@features/profile/core/ProfileService.ts";
import {
	FormFooter,
	IDLE,
	OutLink,
	type SaveState,
	SectionHead,
	SettingsBlock,
	SettingsRow,
	useSectionDraft,
	useSynced,
} from "../SettingsParts.tsx";
import { sectionMeta } from "../../core/settings-registry.ts";

/**
 * Settings → Scheduling & calls (Decision #150; PRODUCT_SPEC §Discovery & Courtesy Calls "the
 * configuration … lives under Settings"): whether clients may book a discovery call, the free courtesy
 * call's length, weekly cap and per-person cooldown, and the buffers and notice around every call.
 *
 * A `page-only` section — the contextual modal shows its status and escalates here. The weekly hours
 * themselves are a matrix and stay in the Availability editor, which this page summarises and links
 * to. Saved through the editor's own route (`PUT /api/profile/[handle]/availability`, one
 * transaction in `scheduling.save_owner_availability`): the bands and timezone travel back exactly as
 * they were read, only `call` changes.
 */

// #region Options
const LENGTHS = [15, 20, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} minutes` }));

const NOTICE = [
	{ value: "0", label: "No minimum" },
	{ value: "60", label: "1 hour" },
	{ value: "120", label: "2 hours" },
	{ value: "240", label: "4 hours" },
	{ value: "720", label: "12 hours" },
	{ value: "1440", label: "1 day" },
	{ value: "2880", label: "2 days" },
	{ value: "10080", label: "1 week" },
];

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock(minute: number): string {
	return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${
		String(minute % 60).padStart(2, "0")
	}`;
}

/** "Mon 09:00–17:00" lines for the working bands, Monday first. */
function hoursLines(availability: OwnerAvailability): string[] {
	const order = [1, 2, 3, 4, 5, 6, 0];
	return order.flatMap((day) => {
		const bands = availability.bands
			.filter((b) => b.weekday === day && b.kind === "working_hours")
			.sort((a, b) => a.startMinute - b.startMinute);
		return bands.length
			? [
				`${DAY[day]} ${
					bands.map((b) => `${clock(b.startMinute)}–${clock(b.endMinute)}`).join(", ")
				}`,
			]
			: [];
	});
}
// #endregion

// #region Bound controls
function CallSwitch(
	props: { label: string; value: boolean; descId?: string; onChange: (on: boolean) => void },
): JSX.Element {
	const sig = useSynced(props.value);
	return (
		<ToggleSwitch
			value={sig}
			aria-label={props.label}
			aria-describedby={props.descId}
			onValueChange={props.onChange}
		/>
	);
}

function CallNumber(
	props: {
		label: string;
		value: number;
		min: number;
		max: number;
		suffix: string;
		onChange: (n: number) => void;
	},
): JSX.Element {
	const sig = useSynced<number | null>(props.value);
	return (
		<NumberInput
			value={sig}
			min={props.min}
			max={props.max}
			step={1}
			suffix={props.suffix}
			aria-label={props.label}
			onValueChange={(n) =>
				props.onChange(Math.min(props.max, Math.max(props.min, Math.round(n ?? props.min))))}
		/>
	);
}

function CallSelect(
	props: {
		label: string;
		value: number;
		options: { value: string; label: string }[];
		onChange: (n: number) => void;
	},
): JSX.Element {
	const sig = useSynced<string>(String(props.value));
	return (
		<Select
			options={props.options}
			value={sig}
			aria-label={props.label}
			onValueChange={(v) => props.onChange(Number(v))}
		/>
	);
}
// #endregion

export interface SchedulingSectionProps {
	data: SettingsSectionDataOf<"scheduling">;
}

export function SchedulingSection(props: SchedulingSectionProps): JSX.Element {
	const meta = sectionMeta("scheduling");
	const availability = useSignal<OwnerAvailability | null>(props.data.availability);
	const baseline = availability.value?.call ?? null;
	const { draft, dirty, set, clear } = useSectionDraft<OwnerCallSettings | null>(
		"scheduling",
		baseline,
	);
	const busy = useSignal(false);
	const status = useSignal<SaveState>(IDLE);
	const handle = props.data.handle;
	const a = availability.value;
	const editorHref = handle ? `/${handle}/edit/availability` : "/settings";

	if (!a || !handle) {
		return (
			<div class="stg-section">
				<SectionHead title={meta.label} description={meta.description} />
				<InlineNotice align="start" text="Your schedule couldn't be loaded just now." />
			</div>
		);
	}

	const c = draft.value;
	const patch = (part: Partial<OwnerCallSettings>) => c && set({ ...c, ...part });

	async function save(): Promise<void> {
		const current = availability.peek();
		if (!current || !draft.peek()) return;
		busy.value = true;
		status.value = { tone: "busy", text: "Saving…" };
		const res = await ProfileService.saveAvailability(handle!, { ...current, call: draft.peek() });
		busy.value = false;
		if (!res.ok || !res.data) {
			status.value = {
				tone: "error",
				text: res.message ?? "Your call settings couldn't be saved.",
			};
			return;
		}
		availability.value = res.data.availability;
		clear(res.data.availability.call);
		status.value = { tone: "saved", text: "Saved." };
	}

	const lines = hoursLines(a);

	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />

			<SettingsBlock
				anchor="working-hours"
				title="Working hours"
				description={`${
					a.published ? "Published on your profile" : "Not published yet"
				} · Times in ${a.timezone}`}
			>
				{lines.length
					? (
						<ul class="stg-hours">
							{lines.map((line) => <li key={line} class="stg-tabular">{line}</li>)}
						</ul>
					)
					: <p class="stg-note">You haven't set any working hours yet.</p>}
				<OutLink href={editorHref}>Edit working hours</OutLink>
			</SettingsBlock>

			{c === null
				? (
					<SettingsBlock anchor="calls" title="Discovery calls">
						<p class="stg-note">
							Discovery calls are for people who sell on Projective. Clients book them from your
							profile.
						</p>
					</SettingsBlock>
				)
				: (
					<>
						<SettingsBlock
							anchor="calls"
							title="Discovery calls"
							description="A short call a client books before hiring you. It's never a deliverable, and never billed unless you offer paid calls."
						>
							<SettingsRow
								label="Accept discovery calls"
								descId="stg-calls-desc"
								description="Clients can request a call inside your published hours."
								control={
									<CallSwitch
										label="Accept discovery calls"
										descId="stg-calls-desc"
										value={c.acceptsCalls}
										onChange={(acceptsCalls) => patch({ acceptsCalls })}
									/>
								}
							/>
							<p class="stg-note">
								Paid consultations and their fee are set in the{" "}
								<a href={editorHref}>availability editor</a>.
							</p>
						</SettingsBlock>

						<SettingsBlock
							anchor="courtesy"
							title="Free courtesy calls"
							description="A free first call. No payment, and no verification needed to book one."
						>
							<div
								class="stg-subform"
								data-off={c.acceptsCalls ? undefined : "true"}
								inert={!c.acceptsCalls}
							>
								<SettingsRow
									label="Offer a free call"
									control={
										<CallSwitch
											label="Offer a free call"
											value={c.courtesyEnabled}
											onChange={(courtesyEnabled) => patch({ courtesyEnabled })}
										/>
									}
								/>
								<SettingsRow
									label="Length"
									control={
										<CallSelect
											label="Courtesy call length"
											value={c.courtesyDurationMinutes}
											options={LENGTHS}
											onChange={(courtesyDurationMinutes) => patch({ courtesyDurationMinutes })}
										/>
									}
								/>
								<SettingsRow
									label="Weekly limit"
									description="0 means no limit."
									control={
										<CallNumber
											label="Free calls per week"
											value={c.courtesyMaxPerWeek}
											min={0}
											max={100}
											suffix=" a week"
											onChange={(courtesyMaxPerWeek) => patch({ courtesyMaxPerWeek })}
										/>
									}
								/>
								<SettingsRow
									label="Wait before the same person books again"
									description="0 means they can book again any time."
									control={
										<CallNumber
											label="Cooldown in days"
											value={c.courtesyCooldownDays}
											min={0}
											max={365}
											suffix=" days"
											onChange={(courtesyCooldownDays) => patch({ courtesyCooldownDays })}
										/>
									}
								/>
							</div>
						</SettingsBlock>

						<SettingsBlock
							anchor="buffers"
							title="Buffers & notice"
							description="Keep breathing room around calls and decide how soon someone can book."
						>
							<div
								class="stg-subform"
								data-off={c.acceptsCalls ? undefined : "true"}
								inert={!c.acceptsCalls}
							>
								<SettingsRow
									label="Before a call"
									control={
										<CallNumber
											label="Buffer before a call, in minutes"
											value={c.bufferBeforeMinutes}
											min={0}
											max={240}
											suffix=" min"
											onChange={(bufferBeforeMinutes) => patch({ bufferBeforeMinutes })}
										/>
									}
								/>
								<SettingsRow
									label="After a call"
									control={
										<CallNumber
											label="Buffer after a call, in minutes"
											value={c.bufferAfterMinutes}
											min={0}
											max={240}
											suffix=" min"
											onChange={(bufferAfterMinutes) => patch({ bufferAfterMinutes })}
										/>
									}
								/>
								<SettingsRow
									label="Minimum notice"
									control={
										<CallSelect
											label="Minimum booking notice"
											value={c.minNoticeMinutes}
											options={NOTICE}
											onChange={(minNoticeMinutes) => patch({ minNoticeMinutes })}
										/>
									}
								/>
								<SettingsRow
									label="Book up to"
									control={
										<CallNumber
											label="How far ahead calls can be booked, in days"
											value={c.maxAdvanceDays}
											min={1}
											max={365}
											suffix=" days ahead"
											onChange={(maxAdvanceDays) => patch({ maxAdvanceDays })}
										/>
									}
								/>
							</div>
						</SettingsBlock>

						<FormFooter
							dirty={dirty}
							busy={busy.value}
							state={status.value}
							onSave={save}
							onDiscard={() => {
								clear(availability.peek()?.call ?? null);
								status.value = IDLE;
							}}
						/>
					</>
				)}
		</div>
	);
}
