import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	Button,
	CurrencySelect,
	FormControl,
	InputNumber,
	Select,
	ToggleSwitch,
} from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	type OwnerAvailability,
	type OwnerCallSettings,
	PAID_CALLS_LIVE,
	type SaveOwnerAvailability,
	SaveOwnerAvailabilitySchema,
} from "@projective/types/scheduling";
import { DISPLAY_CURRENCIES, toMajorUnits, toMinorUnits } from "@projective/types/finance";
import "../styles/profile.css";
import { weekHours } from "../core/availability-model.ts";
import { errorsFromIssues } from "../core/edit-model.ts";
import { ProfileService } from "../core/ProfileService.ts";
import { calendarModeHref } from "@features/calendar/core/availability-view.ts";

/**
 * AvailabilityEditor — the owner's **Availability** page (`/[handle]/edit/availability`): for a
 * seller, the discovery-call offer (a free intro call, a paid consultation) and the burnout guards
 * every call is booked within; for every owner, the time zone, whether the hours are published, and
 * the stored weekly hours as a summary beside the way to the calendar that edits them.
 *
 * The weekly hours are the default availability template's, edited on one full page,
 * `/calendar?view=availability` (Decisions #376, #408), so this page never writes them: one Save sends
 * the time zone, publishing and call settings ({@link SaveOwnerAvailabilitySchema}) to
 * `scheduling.save_owner_availability`, which keeps the bands as they are. The same checks run here
 * first, so a refusal is shown where it applies; leaving with unsaved changes asks first.
 *
 * While paid calls are off ({@link PAID_CALLS_LIVE}, Decision #343 ruling C1) the paid switch is
 * locked at whatever the owner stored and says why, and its fee fields are not drawn: a setting that
 * nothing reads is not one to offer (gate 11), and a save writes the stored values back unchanged.
 */
export interface AvailabilityEditorProps {
	handle: string;
	initial: OwnerAvailability;
	/** Whether this profile takes calls at all (a buyer entity does not). */
	takesCalls: boolean;
	/**
	 * The weekday the owner's week starts on, 0 = Sunday — from their `org.user_preferences.locale`
	 * (default Monday). Only the order the summary reads in; each day keeps its own number.
	 */
	weekStartsOn?: number;
}

const TIME_ZONES = (() => {
	try {
		return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
	} catch {
		return ["UTC"];
	}
})();

const DURATIONS = [15, 20, 30, 45, 60, 90, 120].map((m) => ({ label: `${m} minutes`, value: String(m) }));
const BUFFERS = [0, 5, 10, 15, 30, 60].map((m) => ({ label: m === 0 ? "None" : `${m} minutes`, value: String(m) }));
const NOTICE = [
	{ label: "No minimum", value: "0" },
	{ label: "1 hour", value: "60" },
	{ label: "4 hours", value: "240" },
	{ label: "12 hours", value: "720" },
	{ label: "1 day", value: "1440" },
	{ label: "2 days", value: "2880" },
	{ label: "1 week", value: "10080" },
];
const ADVANCE = [7, 14, 30, 60, 90, 180, 365].map((d) => ({ label: `${d} days`, value: String(d) }));
const PAID_NOTE_ID = "pf-avail-paid-note";

function savedPart(v: OwnerAvailability): SaveOwnerAvailability {
	return { timezone: v.timezone, published: v.published, call: v.call };
}

export default function AvailabilityEditor(props: AvailabilityEditorProps): JSX.Element {
	const { handle, takesCalls } = props;
	const baseline = useSignal<OwnerAvailability>(props.initial);
	const value = useSignal<OwnerAvailability>(props.initial);
	const formKey = useSignal(0);
	const errors = useSignal<Record<string, string>>({});
	const saving = useSignal(false);
	const status = useSignal("");
	const dirtyRef = useRef(false);

	const v = value.value;
	const call = v.call;
	const dirty = JSON.stringify(savedPart(v)) !== JSON.stringify(savedPart(baseline.value));
	dirtyRef.current = dirty;
	const hours = weekHours(baseline.value.bands, props.weekStartsOn ?? 1);

	function setCall(patch: Partial<OwnerCallSettings>): void {
		const current = value.peek();
		if (!current.call) return;
		value.value = { ...current, call: { ...current.call, ...patch } };
	}

	async function save(): Promise<void> {
		if (saving.peek()) return;
		const parsed = SaveOwnerAvailabilitySchema.safeParse(savedPart(value.peek()));
		if (!parsed.success) {
			errors.value = errorsFromIssues(parsed.error.issues);
			status.value = Object.values(errors.value)[0] ?? "Some settings need fixing before they can be saved.";
			return;
		}
		saving.value = true;
		status.value = "Saving…";
		const res = await ProfileService.saveAvailability(handle, parsed.data);
		saving.value = false;
		if (!res.ok || !res.data) {
			errors.value = res.errors ?? {};
			status.value = res.message ?? "Your availability couldn't be saved.";
			return;
		}
		errors.value = {};
		baseline.value = res.data.availability;
		value.value = res.data.availability;
		formKey.value += 1;
		status.value = "Availability saved.";
	}

	function discard(): void {
		value.value = baseline.peek();
		errors.value = {};
		formKey.value += 1;
		status.value = "Changes discarded.";
	}

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				void save();
			}
		};
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (!dirtyRef.current) return;
			e.preventDefault();
			e.returnValue = "";
		};
		globalThis.addEventListener("keydown", onKey);
		globalThis.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			globalThis.removeEventListener("keydown", onKey);
			globalThis.removeEventListener("beforeunload", onBeforeUnload);
		};
	}, []);

	const err = errors.value;

	return (
		<div class="pf-edit">
			<header class="pf-edit__head">
				<h1 class="pf-edit__h1">Availability</h1>
				<p class="pf-edit__lede">
					{takesCalls
						? "How people book a call with you, and the limits that keep your week your own."
						: "Your time zone, and whether your working hours show on your profile."}
				</p>
			</header>

			<div class="pf-edit__form" key={formKey.value}>
				{takesCalls && call && (
					<details class="pf-edit__section" open>
						<summary class="pf-edit__summary">
							<span class="pf-edit__heading">
								<span class="pf-edit__title">Discovery calls</span>
								<span class="pf-edit__desc">A short call before someone hires you — free, paid, or both.</span>
							</span>
							<Icon name="chevron-down" size="sm" class="pf-edit__caret" aria-hidden />
						</summary>
						<div class="pf-edit__body">
							<ToggleSwitch
								value={call.acceptsCalls}
								label="Take discovery calls"
								onValueChange={(on) => setCall({ acceptsCalls: on })}
							/>

							{call.acceptsCalls && (
								<>
									<h3 class="pf-edit__subhead">Free intro call</h3>
									<ToggleSwitch
										value={call.courtesyEnabled}
										label="Offer a free intro call"
										onValueChange={(on) => setCall({ courtesyEnabled: on })}
									/>
									{call.courtesyEnabled && (
										<div class="pf-edit__grid">
											<FormControl label="Length">
												{({ id }) => (
													<Select
														id={id}
														options={DURATIONS.filter((d) => Number(d.value) <= 240)}
														value={String(call.courtesyDurationMinutes)}
														fluid
														onValueChange={(d) => setCall({ courtesyDurationMinutes: Number(d) })}
													/>
												)}
											</FormControl>
										</div>
									)}

									<h3 class="pf-edit__subhead">Paid consultation</h3>
									<ToggleSwitch
										value={call.paidEnabled}
										label="Offer a paid consultation"
										disabled={!PAID_CALLS_LIVE}
										aria-describedby={PAID_CALLS_LIVE ? undefined : PAID_NOTE_ID}
										onValueChange={(on) =>
											setCall({ paidEnabled: on, feeCurrency: value.peek().call?.feeCurrency ?? "GBP" })}
									/>
									{!PAID_CALLS_LIVE && (
										<p id={PAID_NOTE_ID} class="pf-edit__hint">
											Paid consultations open once clients can pay for them, so this can't be
											changed for now.
										</p>
									)}
									{PAID_CALLS_LIVE && call.paidEnabled && (
										<div class="pf-edit__grid">
											<FormControl label="Length">
												{({ id }) => (
													<Select
														id={id}
														options={DURATIONS}
														value={String(call.paidDurationMinutes)}
														fluid
														onValueChange={(d) => setCall({ paidDurationMinutes: Number(d) })}
													/>
												)}
											</FormControl>
											<FormControl
												label="Fee"
												required
												hint="Your price for a consultation. A working-hours rule on your calendar can set its own."
												error={err["call.feeAmountMinor"]}
												status={err["call.feeAmountMinor"] ? "invalid" : "default"}
											>
												{({ id, describedBy, status: s, required }) => (
													<InputNumber
														id={id}
														aria-describedby={describedBy}
														status={s}
														required={required}
														value={toMajorUnits(call.feeAmountMinor, call.feeCurrency ?? "GBP")}
														mode="decimal"
														min={0}
														maxFractionDigits={2}
														fluid
														onValueChange={(n) =>
															setCall({ feeAmountMinor: toMinorUnits(n, call.feeCurrency ?? "GBP") })}
													/>
												)}
											</FormControl>
											<FormControl label="Currency">
												{({ id }) => (
													<CurrencySelect
														id={id}
														currencies={DISPLAY_CURRENCIES}
														value={call.feeCurrency ?? "GBP"}
														fluid
														onValueChange={(c) => setCall({ feeCurrency: c })}
													/>
												)}
											</FormControl>
										</div>
									)}

									<h3 class="pf-edit__subhead">Requests</h3>
									<ul class="pf-edit__switches" role="list">
										<li>
											<ToggleSwitch
												value={call.autoConfirm}
												label="Confirm bookings automatically"
												onValueChange={(on) => setCall({ autoConfirm: on })}
											/>
										</li>
										<li>
											<ToggleSwitch
												value={call.agendaRequired}
												label="Ask people what the call is about"
												onValueChange={(on) => setCall({ agendaRequired: on })}
											/>
										</li>
									</ul>
								</>
							)}
						</div>
					</details>
				)}

				{takesCalls && call && call.acceptsCalls && (
					<details class="pf-edit__section" open>
						<summary class="pf-edit__summary">
							<span class="pf-edit__heading">
								<span class="pf-edit__title">Burnout guards</span>
								<span class="pf-edit__desc">
									The limits every call is booked within, so calls can't crowd your week.
								</span>
							</span>
							<Icon name="chevron-down" size="sm" class="pf-edit__caret" aria-hidden />
						</summary>
						<div class="pf-edit__body">
							<div class="pf-edit__grid">
								<FormControl
									label="Gap before a call"
									hint="Kept clear before every call, so calls are never back to back."
								>
									{({ id, describedBy }) => (
										<Select
											id={id}
											aria-describedby={describedBy}
											options={BUFFERS}
											value={String(call.bufferBeforeMinutes)}
											fluid
											onValueChange={(n) => setCall({ bufferBeforeMinutes: Number(n) })}
										/>
									)}
								</FormControl>
								<FormControl
									label="Gap after a call"
									hint="Kept clear after every call, to wrap up before the next thing."
								>
									{({ id, describedBy }) => (
										<Select
											id={id}
											aria-describedby={describedBy}
											options={BUFFERS}
											value={String(call.bufferAfterMinutes)}
											fluid
											onValueChange={(n) => setCall({ bufferAfterMinutes: Number(n) })}
										/>
									)}
								</FormControl>
								<FormControl
									label="Notice needed"
									hint="How close to its start a call can still be booked."
								>
									{({ id, describedBy }) => (
										<Select
											id={id}
											aria-describedby={describedBy}
											options={NOTICE}
											value={String(call.minNoticeMinutes)}
											fluid
											onValueChange={(n) => setCall({ minNoticeMinutes: Number(n) })}
										/>
									)}
								</FormControl>
								<FormControl label="Bookable up to" hint="How far ahead people can book.">
									{({ id, describedBy }) => (
										<Select
											id={id}
											aria-describedby={describedBy}
											options={ADVANCE}
											value={String(call.maxAdvanceDays)}
											fluid
											onValueChange={(n) => setCall({ maxAdvanceDays: Number(n) })}
										/>
									)}
								</FormControl>
								{call.courtesyEnabled && (
									<>
										<FormControl
											label="Free calls per week"
											hint="The most free intro calls you take in a week. 0 means no limit."
										>
											{({ id, describedBy }) => (
												<InputNumber
													id={id}
													aria-describedby={describedBy}
													value={call.courtesyMaxPerWeek}
													min={0}
													max={100}
													fluid
													onValueChange={(n) =>
														setCall({ courtesyMaxPerWeek: Math.max(0, Math.round(n ?? 0)) })}
												/>
											)}
										</FormControl>
										<FormControl
											label="Days before the same person can book again"
											hint="How long someone waits before another free call with you. 0 means no wait."
										>
											{({ id, describedBy }) => (
												<InputNumber
													id={id}
													aria-describedby={describedBy}
													value={call.courtesyCooldownDays}
													min={0}
													max={365}
													fluid
													onValueChange={(n) =>
														setCall({ courtesyCooldownDays: Math.max(0, Math.round(n ?? 0)) })}
												/>
											)}
										</FormControl>
									</>
								)}
							</div>
						</div>
					</details>
				)}

				<details class="pf-edit__section" open>
					<summary class="pf-edit__summary">
						<span class="pf-edit__heading">
							<span class="pf-edit__title">Working hours</span>
							<span class="pf-edit__desc">
								The weekly hours shown on your profile, set on your calendar.
							</span>
						</span>
						<Icon name="chevron-down" size="sm" class="pf-edit__caret" aria-hidden />
					</summary>
					<div class="pf-edit__body">
						<div class="pf-edit__grid">
							<FormControl
								label="Time zone"
								error={err.timezone}
								status={err.timezone ? "invalid" : "default"}
							>
								{({ id, describedBy, status: s }) => (
									<Select
										id={id}
										aria-describedby={describedBy}
										status={s}
										options={TIME_ZONES.map((z) => ({ label: z.replace(/_/g, " "), value: z }))}
										value={v.timezone}
										filter
										fluid
										onValueChange={(tz) => (value.value = { ...value.peek(), timezone: tz })}
									/>
								)}
							</FormControl>
							<div class="pf-edit__switchcell">
								<ToggleSwitch
									value={v.published}
									label="Show my hours on my profile"
									onValueChange={(on) => (value.value = { ...value.peek(), published: on })}
								/>
							</div>
						</div>

						{hours.length
							? (
								<ul class="pf-hours" role="list" aria-label="Your weekly hours">
									{hours.map((line) => (
										<li key={line.days} class="pf-hours__line">
											<span class="pf-hours__days">{line.days}</span>
											<span class="pf-hours__times">{line.times}</span>
										</li>
									))}
								</ul>
							)
							: <p class="pf-edit__hint">No working hours yet.</p>}

						<a
							class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md pf-edit__calendarlink"
							href={calendarModeHref("availability")}
							data-icon-pos="right"
						>
							<span class="ui-button__label">Edit working hours on visual calendar</span>
							<span class="ui-button__icon" aria-hidden="true">
								<Icon name="arrow-right" size="sm" />
							</span>
						</a>
					</div>
				</details>
			</div>

			<div class="pf-edit__savebar" data-dirty={dirty ? "true" : "false"}>
				<p class="pf-edit__status" role="status" aria-live="polite">
					{status.value || (dirty ? "You have unsaved changes." : "All changes saved.")}
				</p>
				<div class="pf-edit__saveactions">
					<Button variant="text" class="pf-edit__ghost" disabled={!dirty || saving.value} onClick={discard}>
						Discard
					</Button>
					<Button
						class="pf-edit__save"
						disabled={!dirty || saving.value}
						loading={saving.value}
						onClick={() => void save()}
					>
						Save availability
					</Button>
				</div>
			</div>
		</div>
	);
}
