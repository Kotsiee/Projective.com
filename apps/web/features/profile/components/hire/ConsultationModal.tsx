import type { JSX } from "preact";
import { type Signal, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button, SelectButton, Textarea, TimeTumbler } from "@projective/ui/fields";
import { Dialog, Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { formatMoney } from "@projective/types/finance";
import type {
	CallType,
	ConferencingProvider,
	PublicCallOffer,
	SlotGrid,
} from "@projective/types/scheduling";
import { addDaysInZone, bandsForDay, findSlot, firstOpenDay } from "@projective/types/scheduling";
import { CONFERENCING_LABEL } from "@projective/types/scheduling";
import { BookingService } from "@features/view/core/BookingService.ts";
import { bookingSim } from "@features/view/core/booking-seam.ts";
import { DateRail } from "@features/view/components/DateRail.tsx";
import { SlotPicker } from "@features/view/components/SlotPicker.tsx";
import { focusFirstRefused, focusSuccessAction } from "./IntakeFields.tsx";
import { currentPath, requestSignIn } from "@features/auth/core/sign-in-prompt.ts";
import {
	bandsLabel,
	callDuration,
	customEnd,
	customStartBounds,
	customStartProblem,
	defaultCallType,
	defaultPlatform,
	instantOf,
	platformOptions,
} from "../../core/consultation-model.ts";

/**
 * ConsultationModal — the booking panel the Hire popover's "Book consultation" row opens.
 *
 * The date rail and the slot picker are the `/view` page's own booking components, reused; what
 * this modal adds is the profile's three requirements: a CUSTOM start time, the platform, and a
 * rate that is either a figure or the word Free.
 *
 * # The custom start
 *
 * The slots are the provider's offerable cadence, but "2:20 works for me" is a legitimate answer
 * the cadence cannot express. Beneath the picker a `TimeTumbler` offers any minute inside the day's
 * OPEN BANDS (published on the grid for exactly this), the end is computed from the flavour's
 * configured duration and printed beside it — the buyer never chooses a length (§Why Sessions are
 * Fixed) — and the pre-flight rule (`customStartRefusal`, the SSOT's) refuses in place with the same
 * words the write would answer with. Choosing a custom start clears a picked slot and vice versa,
 * so the footer and the body never describe two times.
 *
 * # The platform
 *
 * Restricted to what the provider connected: one platform is a statement, several are a choice,
 * none means the host arranges the room and the control is absent (§D.7.2 — a control that renders
 * must do something; a picker over platforms the provider cannot mint a room on would refuse
 * every choice).
 *
 * # The rate
 *
 * A courtesy call is Free and says so; a paid consultation prints the provider's fee. A provider
 * offering both is asked which — a real `radiogroup`, so the choice is arrow-navigable — and the
 * grid is re-read on the switch because the two flavours run for different lengths.
 */
export interface ConsultationModalProps {
	open: Signal<boolean>;
	/** The provider's `@handle`, without the `@`. */
	handle: string;
	sellerName: string;
	/** The provider's public call offer — the SSR one, or the live one once the seam re-read it. */
	offer: PublicCallOffer;
	authed: boolean;
	onNotice: (text: string) => void;
}

const WINDOW_DAYS = 14;
/** The custom-start control's grain — the platform's scheduling grain. */
const MINUTE_STEP = 5;

export default function ConsultationModal(
	{ open, handle, sellerName, offer, authed, onNotice }: ConsultationModalProps,
): JSX.Element {
	const callType = useSignal<CallType>(defaultCallType(offer));
	const grid = useSignal<SlotGrid | null>(null);
	const windowFrom = useSignal<number | null>(null);
	const selectedDay = useSignal<string | null>(null);
	const selectedSlot = useSignal<string | null>(null);
	/** A custom start as minutes of the selected day, or `null` while the buyer uses the slots. */
	const customMinutes = useSignal<number | null>(null);
	const platform = useSignal<ConferencingProvider | null>(defaultPlatform(offer.platforms));
	const agenda = useSignal("");
	const loading = useSignal(false);
	const sending = useSignal(false);
	const error = useSignal<string | null>(null);
	const attempted = useSignal(false);
	const done = useSignal<string | null>(null);
	const firstFieldRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	/** Counts refused attempts; the focus move is keyed on it so it runs AFTER the marks render. */
	const refusedAttempts = useSignal(0);

	useEffect(() => {
		if (refusedAttempts.value === 0) return;
		focusFirstRefused(bodyRef.current);
	}, [refusedAttempts.value]);

	const sentRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (done.value) focusSuccessAction(sentRef.current);
	}, [done.value]);

	/**
	 * The custom-time disclosure SWAPS its control: the "Set a custom time" button is replaced by the
	 * tumbler, and "Use the listed times" replaces it back — so whichever one the reader pressed is
	 * gone the moment it is pressed and focus would fall to `<body>`. Hand it to the control that
	 * took the old one's place: the hours reel on the way in, the disclosure button on the way out.
	 * Only when focus was actually lost, so the dialog's own opening focus is never overridden.
	 */
	const customSectionRef = useRef<HTMLElement>(null);
	const customWasOpen = useRef(false);
	useEffect(() => {
		const isOpen = customMinutes.value !== null;
		if (isOpen === customWasOpen.current) return;
		customWasOpen.current = isOpen;
		if (document.activeElement && document.activeElement !== document.body) return;
		customSectionRef.current
			?.querySelector<HTMLElement>(isOpen ? ".ui-tumbler__value" : ".ui-button")
			?.focus();
	}, [customMinutes.value === null]);

	function viewerZone(): string | undefined {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
		} catch {
			return undefined;
		}
	}

	async function loadGrid(from: number | null): Promise<void> {
		loading.value = true;
		error.value = null;
		const res = await BookingService.slots({
			subjectId: handle,
			purpose: "discovery_call",
			timezone: viewerZone(),
			from: from ?? undefined,
			days: WINDOW_DAYS,
			callType: callType.value,
		}, bookingSim());
		loading.value = false;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "Could not load availability.";
			return;
		}
		grid.value = res.data.grid;
		windowFrom.value = res.data.grid.days[0]?.startsAt ?? null;
		const stillVisible = selectedDay.value &&
			res.data.grid.days.some((d) => d.key === selectedDay.value);
		if (!stillVisible) selectedDay.value = firstOpenDay(res.data.grid)?.key ?? null;
	}

	// Load on OPEN, reset on close — re-opening is a fresh decision, not a half-made one.
	useEffect(() => {
		if (open.value) {
			callType.value = defaultCallType(offer);
			platform.value = defaultPlatform(offer.platforms);
			agenda.value = "";
			attempted.value = false;
			done.value = null;
			void loadGrid(null);
			return;
		}
		grid.value = null;
		windowFrom.value = null;
		selectedDay.value = null;
		selectedSlot.value = null;
		customMinutes.value = null;
		error.value = null;
		sending.value = false;
	}, [open.value]);

	function close(): void {
		open.value = false;
	}

	function switchType(next: CallType): void {
		if (next === callType.value) return;
		callType.value = next;
		selectedSlot.value = null;
		customMinutes.value = null;
		// The two flavours run for different lengths, so the grid is cut differently.
		void loadGrid(windowFrom.value);
	}

	function page(delta: number): void {
		const g = grid.value;
		if (!g) return;
		const from = windowFrom.value ?? g.windowStart;
		const next = addDaysInZone(from, delta * WINDOW_DAYS, g.viewerTimezone);
		void loadGrid(Math.max(g.windowStart, Math.min(next, g.windowEnd)));
	}

	// ---- The custom start ----
	const g = grid.value;
	const day = g && selectedDay.value
		? g.days.find((d) => d.key === selectedDay.value) ?? null
		: null;
	const bounds = useComputed(() =>
		grid.value && selectedDay.value ? customStartBounds(grid.value, selectedDay.value) : null
	);
	/** The custom start as an instant, or `null` when none is chosen. */
	const customStart = useComputed(() => {
		const gg = grid.value;
		const key = selectedDay.value;
		const minutes = customMinutes.value;
		if (!gg || !key || minutes === null) return null;
		const d = gg.days.find((x) => x.key === key);
		return d ? instantOf(d.startsAt, minutes, gg.viewerTimezone) : null;
	});
	const customProblem = useComputed(() => {
		const gg = grid.value;
		const key = selectedDay.value;
		const start = customStart.value;
		if (!gg || !key || start === null) return null;
		return customStartProblem(gg, key, start);
	});

	/** The chosen instant — a slot's or the custom one — and its end. */
	const chosen = useComputed<{ startsAt: number; endsAt: number } | null>(() => {
		const gg = grid.value;
		if (!gg) return null;
		if (customStart.value !== null) {
			return { startsAt: customStart.value, endsAt: customEnd(customStart.value, gg) };
		}
		const slot = selectedSlot.value ? findSlot(gg, selectedSlot.value) : null;
		return slot ? { startsAt: slot.startsAt, endsAt: slot.endsAt } : null;
	});

	function pickSlot(id: string): void {
		selectedSlot.value = selectedSlot.value === id ? null : id;
		customMinutes.value = null;
	}

	function setCustom(minutes: number): void {
		customMinutes.value = minutes;
		selectedSlot.value = null;
	}

	/** A custom start seeded from the first open band's start, snapped to the grain. */
	function startCustom(): void {
		const b = bounds.value;
		if (!b) return;
		const seed = Math.ceil(b.min / MINUTE_STEP) * MINUTE_STEP;
		setCustom(Math.min(seed, b.max));
	}

	function timeLabel(ms: number): string {
		const zone = grid.value?.viewerTimezone;
		try {
			return new Intl.DateTimeFormat(undefined, {
				timeZone: zone,
				hour: "numeric",
				minute: "2-digit",
			})
				.format(new Date(ms));
		} catch {
			return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
				new Date(ms),
			);
		}
	}

	async function submit(): Promise<void> {
		if (sending.value) return;
		if (!authed) {
			requestSignIn({ intent: "hire", returnTo: currentPath(), subject: sellerName });
			return;
		}
		attempted.value = true;
		error.value = null;
		const pick = chosen.value;
		if (!pick) {
			error.value = "Pick a time first.";
			refusedAttempts.value++;
			return;
		}
		if (customStart.value !== null && customProblem.value) {
			error.value = customProblem.value;
			refusedAttempts.value++;
			return;
		}
		if (offer.platforms.length > 1 && !platform.value) {
			error.value = "Choose which platform the call should be on.";
			refusedAttempts.value++;
			return;
		}
		if (offer.agendaRequired && !agenda.value.trim()) {
			error.value = `${sellerName} asks what the call is about before confirming.`;
			refusedAttempts.value++;
			return;
		}
		sending.value = true;
		const res = await BookingService.contact({
			kind: "discovery_call",
			handle,
			subjectId: null,
			...(customStart.value !== null
				? { startsAt: customStart.value }
				: { slotId: selectedSlot.value ?? undefined }),
			callType: callType.value,
			platform: platform.value ?? undefined,
			timezone: viewerZone(),
			agenda: agenda.value.trim() || undefined,
		}, bookingSim());
		sending.value = false;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "Could not request that call.";
			// A refusal is usually somebody else taking the time: re-read rather than keep a stale grid.
			if (res.errors?.slotId || res.errors?.startsAt) void loadGrid(windowFrom.value);
			return;
		}
		done.value = res.data.result.confirmation;
		onNotice(res.data.result.confirmation);
	}

	// ---- Presentation ----
	const both = offer.courtesyEnabled && offer.paidEnabled;
	const paid = callType.value === "paid";
	const duration = callDuration(offer, callType.value);
	const rate = paid && offer.feeAmountMinor !== null && offer.feeCurrency
		? formatMoney(offer.feeAmountMinor, offer.feeCurrency)
		: "Free";
	const hour12 = (() => {
		try {
			return !!new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;
		} catch {
			return false;
		}
	})();
	const canConfirm = !!chosen.value && !customProblem.value && !loading.value && !sending.value &&
		!done.value;

	const footer = (
		<div class="pf-consult__foot">
			<div class="pf-consult__rate">
				<span class="pf-consult__ratefigure">{rate}</span>
				<span class="pf-consult__ratemeta">
					{duration} min {paid ? "consultation" : "intro call"}
					{chosen.value && (
						<>
							<span class="pf-split__dot" aria-hidden="true">·</span>
							<span>
								{timeLabel(chosen.value.startsAt)} – {timeLabel(chosen.value.endsAt)}
							</span>
						</>
					)}
				</span>
			</div>
			<div class="pf-consult__actions">
				{done.value
					? <Button variant="filled" severity="primary" label="Done" onClick={close} />
					: (
						<>
							<Button variant="text" severity="secondary" label="Cancel" onClick={close} />
							<Button
								variant="filled"
								severity="primary"
								label={sending.value ? "Requesting…" : "Confirm booking"}
								loading={sending.value}
								disabled={!canConfirm}
								onClick={() => void submit()}
							/>
						</>
					)}
			</div>
		</div>
	);

	return (
		<Dialog
			visible={open}
			header={`Book a consultation with ${sellerName}`}
			width="min(46rem, calc(100vw - var(--space-6)))"
			class="pf-consult"
			footer={footer}
			initialFocusRef={firstFieldRef}
			onVisibleChange={(v) => {
				if (!v) close();
			}}
		>
			{done.value
				? (
					<div class="pf-split__sent" role="status" ref={sentRef}>
						<span class="pf-split__sent-mark" aria-hidden="true">
							<Icon name="check" size="md" />
						</span>
						<h3 class="pf-split__sent-title">Consultation requested</h3>
						<p class="pf-split__sent-body">{done.value}</p>
					</div>
				)
				: (
					<div class="pf-consult__body" ref={bodyRef}>
						{both && (
							<div class="pf-consult__type" role="radiogroup" aria-label="Call type">
								<button
									type="button"
									role="radio"
									class="pf-consult__typeopt"
									aria-checked={callType.value === "courtesy"}
									data-active={callType.value === "courtesy" ? "true" : undefined}
									onClick={() => switchType("courtesy")}
								>
									<span class="pf-consult__typelabel">Free intro</span>
									<span class="pf-consult__typemeta">{offer.courtesyDurationMinutes} min</span>
								</button>
								<button
									type="button"
									role="radio"
									class="pf-consult__typeopt"
									aria-checked={callType.value === "paid"}
									data-active={callType.value === "paid" ? "true" : undefined}
									onClick={() => switchType("paid")}
								>
									<span class="pf-consult__typelabel">Paid consultation</span>
									<span class="pf-consult__typemeta">
										{offer.paidDurationMinutes} min ·{" "}
										{offer.feeAmountMinor !== null && offer.feeCurrency
											? formatMoney(offer.feeAmountMinor, offer.feeCurrency)
											: "Priced on request"}
									</span>
								</button>
							</div>
						)}

						<div ref={firstFieldRef} tabIndex={-1} class="pf-consult__when">
							{g
								? (
									<>
										<DateRail
											days={g.days}
											selected={selectedDay.value}
											onSelect={(key) => {
												selectedDay.value = key;
												selectedSlot.value = null;
												customMinutes.value = null;
											}}
											timezone={g.viewerTimezone}
											onPrev={(windowFrom.value ?? g.windowStart) > g.windowStart
												? () => page(-1)
												: undefined}
											onNext={(() => {
												const last = g.days[g.days.length - 1];
												return last && last.startsAt < g.windowEnd ? () => page(1) : undefined;
											})()}
											busy={loading.value}
										/>
										<SlotPicker
											grid={g}
											dayKey={selectedDay.value}
											selected={selectedSlot.value ? [selectedSlot.value] : []}
											onToggle={pickSlot}
											max={1}
											busy={loading.value}
										/>
									</>
								)
								: <p class="pf-split__hint" role="status">Loading availability…</p>}

							{g && day && bounds.value && (
								<section
									class="pf-consult__custom"
									aria-labelledby="pf-consult-custom"
									ref={customSectionRef}
								>
									<div class="pf-consult__customhead">
										<h3 class="pf-split__label" id="pf-consult-custom">Or choose a start time</h3>
										<span class="pf-consult__customhint">
											Available {bandsLabel(bandsForDay(g, day.key), g.viewerTimezone)}
										</span>
									</div>
									{customMinutes.value === null
										? (
											<Button
												variant="outlined"
												severity="secondary"
												size="sm"
												label="Set a custom time"
												icon={<Icon name="clock" size="xs" aria-hidden />}
												onClick={startCustom}
											/>
										)
										: (
											<div
												class="pf-consult__customrow"
												data-invalid={customProblem.value ? "true" : undefined}
											>
												<TimeTumbler
													aria-label="Start time"
													value={customMinutes.value}
													onValueChange={setCustom}
													hour12={hour12}
													minuteStep={MINUTE_STEP}
													minMinutes={bounds.value.min}
													maxMinutes={bounds.value.max}
													status={customProblem.value ? "invalid" : "default"}
												/>
												<div class="pf-consult__customend">
													<span class="pf-consult__endlabel">Ends</span>
													<span class="pf-consult__endtime">
														{customStart.value !== null
															? timeLabel(customEnd(customStart.value, g))
															: "—"}
													</span>
													<span class="pf-consult__endmeta">{duration} min</span>
												</div>
												<Button
													variant="text"
													severity="secondary"
													size="sm"
													label="Use the listed times"
													onClick={() => (customMinutes.value = null)}
												/>
											</div>
										)}
									{customProblem.value && customMinutes.value !== null && (
										<p class="pf-consult__problem" role="alert">{customProblem.value}</p>
									)}
								</section>
							)}
							{g && day && !bounds.value && (customMinutes.value !== null) && (
								<p class="pf-split__hint">No custom times on this day — pick a listed one.</p>
							)}
						</div>

						{offer.platforms.length > 1 && (
							<section class="pf-consult__platform" aria-labelledby="pf-consult-platform">
								<h3 class="pf-split__label" id="pf-consult-platform">Platform</h3>
								<SelectButton
									aria-label="Platform"
									options={platformOptions(offer.platforms)}
									value={platform.value ?? ""}
									onValueChange={(v) => {
										const next = Array.isArray(v) ? v[0] : v;
										platform.value = (next || null) as ConferencingProvider | null;
									}}
									status={attempted.value && !platform.value ? "invalid" : "default"}
								/>
							</section>
						)}
						{offer.platforms.length === 1 && (
							<p class="pf-consult__platformnote">
								<Icon name="video-camera" size="xs" aria-hidden />
								<span>
									On{" "}
									{CONFERENCING_LABEL[offer.platforms[0]]}. The link arrives once the call is
									confirmed.
								</span>
							</p>
						)}
						{offer.platforms.length === 0 && (
							<p class="pf-consult__platformnote">
								<Icon name="info" size="xs" aria-hidden />
								<span>
									{sellerName} arranges the call room and sends the details on confirming.
								</span>
							</p>
						)}

						<section class="pf-split__section" aria-labelledby="pf-consult-agenda-label">
							<label class="pf-split__label" id="pf-consult-agenda-label" for="pf-consult-agenda">
								What is the call about?
								{!offer.agendaRequired && <span class="pf-split__optional">Optional</span>}
							</label>
							<Textarea
								id="pf-consult-agenda"
								fluid
								autoResize
								rows={3}
								maxRows={6}
								maxLength={2000}
								value={agenda}
								required={offer.agendaRequired}
								status={attempted.value && offer.agendaRequired && !agenda.value.trim()
									? "invalid"
									: "default"}
							/>
						</section>

						{error.value && (
							<div class="pf-split__error">
								<Message
									severity="danger"
									variant="subtle"
									size="sm"
									closable
									onClose={() => (error.value = null)}
								>
									{error.value}
								</Message>
							</div>
						)}
						{!authed && (
							<p class="pf-split__hint">
								Sign in to confirm — the times are yours to browse first.
							</p>
						)}
					</div>
				)}
		</Dialog>
	);
}
