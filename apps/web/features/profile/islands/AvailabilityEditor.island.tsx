import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Tooltip } from "@projective/ui/feedback";
import { Button, FormControl, InputNumber, Select, ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	type OwnerAvailability,
	OwnerAvailabilitySchema,
	type OwnerBand,
	type OwnerCallSettings,
} from "@projective/types/scheduling";
import { DISPLAY_CURRENCIES, toMajorUnits, toMinorUnits } from "@projective/types/finance";
import "../styles/profile.css";
import {
	bandsFor,
	copyDay,
	dayOverlaps,
	endOptions,
	nextBand,
	START_OPTIONS,
	WEEK,
	withDayBands,
} from "../core/availability-model.ts";
import { errorsFromIssues } from "../core/edit-model.ts";
import { ProfileService } from "../core/ProfileService.ts";

/**
 * AvailabilityEditor — the owner's **Availability** page (`/[handle]/edit/availability`): the weekly
 * working hours (in the owner's own time zone), whether they are published, and — for a seller — the
 * discovery-call offer: a free intro call, a paid consultation, and the booking rules both follow.
 *
 * One Save writes everything in one transaction (`scheduling.save_owner_availability`), because a
 * time zone saved without the hours expressed in it would silently re-time every one of them. The
 * same checks run here first (`OwnerAvailabilitySchema`: no overlapping hours on a day, an end after
 * each start, a fee before a paid call) so a refusal is shown where it applies.
 *
 * Only WORKING hours are edited here. Narrower "call window" bands, when a schedule has any, are
 * kept exactly as they are.
 */
export interface AvailabilityEditorProps {
	handle: string;
	initial: OwnerAvailability;
	/** Whether this profile takes calls at all (a buyer entity does not). */
	takesCalls: boolean;
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
	const dirty = JSON.stringify(v) !== JSON.stringify(baseline.value);
	dirtyRef.current = dirty;

	function setCall(patch: Partial<OwnerCallSettings>): void {
		const current = value.peek();
		if (!current.call) return;
		value.value = { ...current, call: { ...current.call, ...patch } };
	}

	function setDay(weekday: number, bands: OwnerBand[]): void {
		value.value = withDayBands(value.peek(), weekday, bands);
	}

	async function save(): Promise<void> {
		if (saving.peek()) return;
		const parsed = OwnerAvailabilitySchema.safeParse(value.peek());
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
					When you work, and how people can book time with you. Times are in your own time zone;
					visitors see them converted to theirs.
				</p>
			</header>

			<div class="pf-edit__form" key={formKey.value}>
				<details class="pf-edit__section" open>
					<summary class="pf-edit__summary">
						<span class="pf-edit__heading">
							<span class="pf-edit__title">Working hours</span>
							<span class="pf-edit__desc">The weekly hours shown on your profile.</span>
						</span>
						<Icon name="chevron-down" size="sm" class="pf-edit__caret" aria-hidden />
					</summary>
					<div class="pf-edit__body">
						<div class="pf-edit__grid">
							<FormControl label="Time zone" error={err.timezone} status={err.timezone ? "invalid" : "default"}>
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

						<ol class="pf-week" role="list">
							{WEEK.map((day) => {
								const bands = bandsFor(v, day.weekday);
								const working = bands.length > 0;
								const overlaps = dayOverlaps(bands);
								const next = nextBand(bands, day.weekday);
								return (
									<li key={day.weekday} class="pf-week__day" data-working={working ? "true" : "false"}>
										<div class="pf-week__head">
											<ToggleSwitch
												value={working}
												label={day.label}
												onValueChange={(on) =>
													setDay(day.weekday, on ? [nextBand([], day.weekday)!] : [])}
											/>
											{working && day.weekday === 1 && (
												<Button
													size="sm"
													variant="text"
													class="pf-edit__ghost"
													icon={<Icon name="copy" size="sm" />}
													onClick={() => (value.value = copyDay(value.peek(), 1, [2, 3, 4, 5]))}
												>
													Copy to weekdays
												</Button>
											)}
										</div>
										{working
											? (
												<ul class="pf-week__bands" role="list">
													{bands.map((band, i) => (
														<li key={`${band.startMinute}-${i}`} class="pf-week__band">
															<Select
																size="sm"
																aria-label={`${day.label} band ${i + 1} starts`}
																options={START_OPTIONS}
																value={String(band.startMinute)}
																onValueChange={(sv) => {
																	const start = Number(sv);
																	const end = Math.max(band.endMinute, start + 30);
																	setDay(
																		day.weekday,
																		bands.map((b, j) =>
																			j === i ? { ...b, startMinute: start, endMinute: Math.min(1440, end) } : b
																		),
																	);
																}}
															/>
															<span class="pf-week__to" aria-hidden="true">–</span>
															<Select
																size="sm"
																aria-label={`${day.label} band ${i + 1} ends`}
																options={endOptions(band.startMinute)}
																value={String(band.endMinute)}
																onValueChange={(ev) =>
																	setDay(
																		day.weekday,
																		bands.map((b, j) => (j === i ? { ...b, endMinute: Number(ev) } : b)),
																	)}
															/>
															<Tooltip content="Remove these hours" placement="top">
																<Button
																	size="sm"
																	variant="text"
																	iconOnly
																	class="pf-edit__ghost"
																	aria-label={`Remove ${day.label} band ${i + 1}`}
																	icon={<Icon name="close" size="sm" />}
																	onClick={() => setDay(day.weekday, bands.filter((_, j) => j !== i))}
																/>
															</Tooltip>
														</li>
													))}
													{next && (
														<li class="pf-week__band pf-week__band--add">
															<Button
																size="sm"
																variant="text"
																class="pf-edit__ghost"
																icon={<Icon name="plus" size="sm" />}
																onClick={() => setDay(day.weekday, [...bands, next])}
															>
																Add hours
															</Button>
														</li>
													)}
												</ul>
											)
											: <p class="pf-week__off">Not working</p>}
										{overlaps && <p class="pf-edit__error" role="alert">These hours overlap.</p>}
									</li>
								);
							})}
						</ol>
						{err.bands && <p class="pf-edit__error" role="alert">{err.bands}</p>}
					</div>
				</details>

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
											<FormControl label="Most per week" hint="0 means no limit.">
												{({ id, describedBy }) => (
													<InputNumber
														id={id}
														aria-describedby={describedBy}
														value={call.courtesyMaxPerWeek}
														min={0}
														max={100}
														fluid
														onValueChange={(n) => setCall({ courtesyMaxPerWeek: Math.max(0, Math.round(n ?? 0)) })}
													/>
												)}
											</FormControl>
											<FormControl label="Days before the same person can book again" hint="0 means no wait.">
												{({ id, describedBy }) => (
													<InputNumber
														id={id}
														aria-describedby={describedBy}
														value={call.courtesyCooldownDays}
														min={0}
														max={365}
														fluid
														onValueChange={(n) => setCall({ courtesyCooldownDays: Math.max(0, Math.round(n ?? 0)) })}
													/>
												)}
											</FormControl>
										</div>
									)}

									<h3 class="pf-edit__subhead">Paid consultation</h3>
									<ToggleSwitch
										value={call.paidEnabled}
										label="Offer a paid consultation"
										onValueChange={(on) =>
											setCall({ paidEnabled: on, feeCurrency: value.peek().call?.feeCurrency ?? "GBP" })}
									/>
									{call.paidEnabled && (
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
													<Select
														id={id}
														options={DISPLAY_CURRENCIES.map((c) => ({ label: `${c.code} · ${c.label}`, value: c.code }))}
														value={call.feeCurrency ?? "GBP"}
														fluid
														onValueChange={(c) => setCall({ feeCurrency: c })}
													/>
												)}
											</FormControl>
										</div>
									)}

									<h3 class="pf-edit__subhead">Booking rules</h3>
									<div class="pf-edit__grid">
										<FormControl label="Notice needed">
											{({ id }) => (
												<Select
													id={id}
													options={NOTICE}
													value={String(call.minNoticeMinutes)}
													fluid
													onValueChange={(n) => setCall({ minNoticeMinutes: Number(n) })}
												/>
											)}
										</FormControl>
										<FormControl label="Bookable up to">
											{({ id }) => (
												<Select
													id={id}
													options={ADVANCE}
													value={String(call.maxAdvanceDays)}
													fluid
													onValueChange={(n) => setCall({ maxAdvanceDays: Number(n) })}
												/>
											)}
										</FormControl>
										<FormControl label="Gap before a call">
											{({ id }) => (
												<Select
													id={id}
													options={BUFFERS}
													value={String(call.bufferBeforeMinutes)}
													fluid
													onValueChange={(n) => setCall({ bufferBeforeMinutes: Number(n) })}
												/>
											)}
										</FormControl>
										<FormControl label="Gap after a call">
											{({ id }) => (
												<Select
													id={id}
													options={BUFFERS}
													value={String(call.bufferAfterMinutes)}
													fluid
													onValueChange={(n) => setCall({ bufferAfterMinutes: Number(n) })}
												/>
											)}
										</FormControl>
									</div>
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
