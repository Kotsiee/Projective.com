import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Dialog } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "../styles/service-booking.css";
import { DateRail } from "../components/DateRail.tsx";
import { SlotPicker } from "../components/SlotPicker.tsx";
import { CtaButton } from "../components/CtaButton.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { BookingService } from "../core/BookingService.ts";
import { bookingSim } from "../core/booking-seam.ts";
import { announce, closeBookingPanel, currentOffer, openPanel } from "../core/booking-state.ts";
import type { SlotGrid, SlotPurpose } from "@projective/types/scheduling";
import { addDaysInZone, firstOpenDay } from "@projective/types/scheduling";
import { plural, type ServiceBookingOffer } from "@projective/types/services";

/**
 * SessionBookingModal — the date-rail + slot-picker panel behind **Book session**, **Book *n*
 * sessions**, **Join cohort**, and the Contact menu's **Book a discovery call**.
 *
 * # One modal, four entry points
 *
 * They differ in their copy, their slot count and where they submit — not in their mechanics. All four
 * are "pick from this provider's real availability, then commit", and building four would mean four
 * places for the timezone disclosure to be got wrong and four chances for one of them to keep offering
 * a slot somebody else has taken. `purpose` selects the copy; everything else is shared.
 *
 * # Two rules the implementation holds
 *
 * **The grid is re-read, never patched.** After a refused booking (`409` — somebody got there first)
 * the whole window is re-fetched rather than the one slot being marked taken locally. A picker that
 * patched its own copy would drift from the provider's actual calendar with every refusal, and the
 * drift is invisible until it books a double.
 *
 * **Selection survives a window page, and is validated on submit.** Paging forward keeps a slot chosen
 * on an earlier page — a set-session buyer picking across a fortnight would otherwise lose their first
 * pick on every arrow press — and the server re-resolves every id through the reader that drew the
 * grid, so a stale selection is refused with a reason rather than silently booked.
 */

/** How many days one window of the rail holds. Paging is by window, not by day. */
const WINDOW_DAYS = 14;

export interface SessionBookingModalProps {
	/** The SSR-resolved offer. The live one comes from the shared signal once it hydrates. */
	offer: ServiceBookingOffer;
}

export default function SessionBookingModal({ offer: ssrOffer }: SessionBookingModalProps): JSX.Element {
	const offer = useComputed(() => currentOffer.value ?? ssrOffer);
	const open = useComputed(() => openPanel.value === "scheduler" || openPanel.value === "call");
	const isCall = useComputed(() => openPanel.value === "call");

	const grid = useSignal<SlotGrid | null>(null);
	const windowFrom = useSignal<number | null>(null);
	const selectedDay = useSignal<string | null>(null);
	const selectedSlots = useSignal<readonly string[]>([]);
	const note = useSignal("");
	const seats = useSignal(1);
	const callType = useSignal<"courtesy" | "paid">("courtesy");
	const loading = useSignal(false);
	const error = useSignal<string | null>(null);
	const cta = useCtaFeedback();

	const purpose = useComputed<SlotPurpose>(() =>
		isCall.value
			? "discovery_call"
			: offer.value.format === "cohort"
			? "cohort"
			: offer.value.format === "set_session"
			? "set_session"
			: "session"
	);

	/** A discovery call books against the PROVIDER's handle; a listing books against the listing. */
	const subjectId = useComputed(() =>
		isCall.value ? offer.value.contact.handle : offer.value.subjectId
	);

	/** How many slots this flow may take. A block schedules its first sitting; everything else takes one. */
	const maxSlots = 1;

	/**
	 * The viewer's own IANA zone.
	 *
	 * Read from `Intl` on the client, never guessed server-side. A server that guessed would bucket a
	 * buyer's days into a calendar they do not live in, and every time on the screen would then be off
	 * by the difference without anything on the page admitting it.
	 */
	function viewerZone(): string | undefined {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
		} catch {
			return undefined;
		}
	}

	/** Load (or reload) a window of the grid. */
	async function loadGrid(from?: number | null): Promise<void> {
		loading.value = true;
		error.value = null;
		const res = await BookingService.slots({
			subjectId: subjectId.value,
			purpose: purpose.value,
			timezone: viewerZone(),
			from: from ?? undefined,
			days: WINDOW_DAYS,
		}, bookingSim());
		loading.value = false;
		if (!res.ok || !res.data) {
			error.value = res.message ?? "Could not load availability.";
			return;
		}
		grid.value = res.data.grid;
		windowFrom.value = res.data.grid.days[0]?.startsAt ?? null;
		// Land on the first day that has something, rather than on an empty Monday. If a selection is
		// still on the visible window it is kept — paging must not silently discard a chosen slot.
		const stillVisible = selectedDay.value &&
			res.data.grid.days.some((d) => d.key === selectedDay.value);
		if (!stillVisible) selectedDay.value = firstOpenDay(res.data.grid)?.key ?? null;
	}

	// Load on OPEN, not on mount: this modal is mounted on every listing page, and reading a provider's
	// fortnight of availability for a panel nobody opened is a request nobody asked for.
	useEffect(() => {
		if (!open.value) return;
		if (grid.value) return;
		void loadGrid(null);
	}, [open.value]);

	// Reset when the panel closes, so re-opening it is a fresh decision rather than a half-made one.
	useEffect(() => {
		if (open.value) return;
		grid.value = null;
		windowFrom.value = null;
		selectedDay.value = null;
		selectedSlots.value = [];
		note.value = "";
		seats.value = 1;
		error.value = null;
		cta.reset();
	}, [open.value]);

	function toggleSlot(id: string): void {
		const current = selectedSlots.value;
		if (current.includes(id)) {
			selectedSlots.value = current.filter((s) => s !== id);
			return;
		}
		// Single-select flows replace rather than append: a buyer clicking a second time means "actually,
		// that one", and a picker that made them deselect first is a picker fighting its user.
		selectedSlots.value = maxSlots === 1 ? [id] : [...current, id];
	}

	function page(delta: number): void {
		const g = grid.value;
		if (!g) return;
		// Calendar days, not `delta * WINDOW_DAYS * 86_400_000`. A fixed step drifts by an hour across
		// each DST transition, and after two of them a "fortnight forward" lands on the wrong date —
		// which reads as the rail skipping or repeating a day for no visible reason.
		const from = windowFrom.value ?? g.windowStart;
		const next = addDaysInZone(from, delta * WINDOW_DAYS, g.viewerTimezone);
		void loadGrid(Math.max(g.windowStart, Math.min(next, g.windowEnd)));
	}

	/** Whether the window can page further back — never before the provider's own notice floor. */
	const canPrev = useComputed(() => {
		const g = grid.value;
		if (!g) return false;
		return (windowFrom.value ?? g.windowStart) > g.windowStart;
	});

	const canNext = useComputed(() => {
		const g = grid.value;
		if (!g) return false;
		const last = g.days[g.days.length - 1];
		return !!last && last.startsAt < g.windowEnd;
	});

	async function submit(): Promise<boolean> {
		const chosen = selectedSlots.value;
		if (chosen.length === 0) {
			error.value = "Pick a time first.";
			return false;
		}
		error.value = null;

		if (isCall.value) {
			const call = offer.value.contact.callOffer;
			if (call?.agendaRequired && !note.value.trim()) {
				error.value = "This provider asks what the call is about before confirming.";
				return false;
			}
			const res = await BookingService.contact({
				kind: "discovery_call",
				handle: offer.value.contact.handle,
				subjectId: offer.value.subjectId,
				slotId: chosen[0],
				callType: callType.value,
				timezone: viewerZone(),
				agenda: note.value.trim() || undefined,
			}, bookingSim());
			if (!res.ok || !res.data) {
				error.value = res.message ?? "Could not request that call.";
				// A refusal is usually somebody else taking the slot, so the honest response is a fresh
				// read rather than leaving a grid on screen that no longer matches the calendar.
				if (res.errors?.slotId) void loadGrid(windowFrom.value);
				return false;
			}
			announce(res.data.result.confirmation);
			// Resolve in place: a requested call has no page to land on, and navigating somewhere would
			// take the reader off the listing they were still evaluating.
			setTimeout(() => closeBookingPanel(), 900);
			return true;
		}

		const res = await BookingService.bookSession({
			subjectId: offer.value.subjectId,
			format: offer.value.format,
			slotIds: [...chosen],
			timezone: viewerZone(),
			note: note.value.trim() || undefined,
			seats: offer.value.format === "cohort" ? seats.value : 1,
		}, bookingSim());
		if (!res.ok || !res.data) {
			error.value = res.message ?? "Could not hold that time.";
			if (res.errors?.slotId || res.errors?.slotIds) void loadGrid(windowFrom.value);
			return false;
		}
		announce(res.data.outcome.summary);
		const route = res.data.outcome.route;
		setTimeout(() => {
			try {
				globalThis.location.href = route;
			} catch { /* SSR / no window — non-fatal */ }
		}, 700);
		return true;
	}

	const g = grid.value;
	const call = offer.value.contact.callOffer;
	const bothCallTypes = !!call?.courtesyEnabled && !!call?.paidEnabled;
	const total = offer.value.sessionCount;

	return (
		<Dialog
			visible={open}
			onVisibleChange={(next) => {
				if (!next) closeBookingPanel();
			}}
			header={isCall.value ? `Book a call with ${offer.value.contact.sellerName}` : bookHeader(offer.value)}
			width="min(46rem, 94vw)"
			class="sbk"
			footer={
				<div class="sbk__footer">
					<div class="sbk__summary">
						<span class="sbk__summarymain">{summaryLine(offer.value, isCall.value, selectedSlots.value.length, g)}</span>
						{!isCall.value && total > 1 && (
							<span class="sbk__summarynote">
								The remaining {total - 1} {plural(total - 1, "session")} are scheduled after checkout.
							</span>
						)}
					</div>
					<CtaButton
						label={isCall.value ? "Request call" : confirmLabel(offer.value)}
						settledLabel={isCall.value ? "Requested" : "Held"}
						phase={cta.phase}
						disabled={selectedSlots.value.length === 0 || loading.value}
						icon={<Icon name="calendar" size="sm" aria-hidden />}
						fluid={false}
						onClick={() => void cta.run(submit)}
					/>
				</div>
			}
		>
			<div class="sbk__body">
				{isCall.value && bothCallTypes && (
					<div class="sbk__calltype" role="radiogroup" aria-label="Call type">
						<button
							type="button"
							role="radio"
							class="sbk__calltypeopt"
							aria-checked={callType.value === "courtesy"}
							data-active={callType.value === "courtesy" ? "true" : undefined}
							onClick={() => (callType.value = "courtesy")}
						>
							Free intro · {call!.courtesyDurationMinutes} min
						</button>
						<button
							type="button"
							role="radio"
							class="sbk__calltypeopt"
							aria-checked={callType.value === "paid"}
							data-active={callType.value === "paid" ? "true" : undefined}
							onClick={() => (callType.value = "paid")}
						>
							Paid consult · {call!.paidDurationMinutes} min
						</button>
					</div>
				)}

				{loading.value && !g
					? <p class="sbk__loading" role="status">Loading availability…</p>
					: g
					? (
						<>
							<DateRail
								days={g.days}
								selected={selectedDay.value}
								onSelect={(key) => {
									selectedDay.value = key;
									// A day change clears a single-slot selection: keeping Tuesday's 2pm chosen while
									// showing Wednesday's times is a picker whose footer and body disagree.
									if (maxSlots === 1) selectedSlots.value = [];
								}}
								timezone={g.viewerTimezone}
								onPrev={canPrev.value ? () => page(-1) : undefined}
								onNext={canNext.value ? () => page(1) : undefined}
								busy={loading.value}
							/>
							<SlotPicker
								grid={g}
								dayKey={selectedDay.value}
								selected={selectedSlots.value}
								onToggle={toggleSlot}
								max={maxSlots}
								busy={loading.value}
							/>
						</>
					)
					: null}

				{offer.value.format === "cohort" && !isCall.value && (
					<label class="sbk__seats">
						<span class="sbk__seatslabel">Seats</span>
						<input
							class="sbk__seatsinput"
							type="number"
							min={1}
							max={offer.value.capacity?.remaining ?? 1}
							value={seats.value}
							onInput={(e) => {
								const raw = Number((e.target as HTMLInputElement).value);
								const cap = offer.value.capacity?.remaining ?? 1;
								seats.value = Number.isFinite(raw) ? Math.min(cap, Math.max(1, raw)) : 1;
							}}
						/>
						{offer.value.capacity && (
							<span class="sbk__seatshint">{offer.value.capacity.sentence}</span>
						)}
					</label>
				)}

				<label class="sbk__note">
					<span class="sbk__notelabel">
						{isCall.value
							? call?.agendaRequired ? "What is the call about?" : "What is the call about? (optional)"
							: "Anything the provider should know? (optional)"}
					</span>
					<textarea
						class="sbk__notefield"
						rows={3}
						value={note.value}
						maxLength={2000}
						onInput={(e) => (note.value = (e.target as HTMLTextAreaElement).value)}
					/>
				</label>

				{error.value && <p class="sbk__error" role="alert">{error.value}</p>}
			</div>
		</Dialog>
	);
}

// #region Copy
/** The modal's title, per format. */
function bookHeader(offer: ServiceBookingOffer): string {
	switch (offer.format) {
		case "cohort":
			return `Join ${offer.subjectTitle}`;
		case "set_session":
			return `Book ${offer.sessionCount} sessions`;
		default:
			return `Book ${offer.subjectTitle}`;
	}
}

/** The confirm button's label. */
function confirmLabel(offer: ServiceBookingOffer): string {
	return offer.format === "cohort" ? "Reserve seat" : "Hold this time";
}

/**
 * The footer's running summary.
 *
 * It states what is about to happen rather than a price. The price is the lane's job and the
 * checkout's job; repeating it here would be a third place for one figure to live, and §D.7.3's whole
 * point is that an offer stated twice is an offer that can disagree with itself.
 */
function summaryLine(
	offer: ServiceBookingOffer,
	isCall: boolean,
	chosen: number,
	grid: SlotGrid | null,
): string {
	if (chosen === 0) return "No time selected yet";
	const minutes = grid?.durationMinutes ?? offer.durationMinutes ?? 60;
	if (isCall) return `${minutes} minute call`;
	if (offer.format === "cohort") return `One seat · ${minutes} minutes`;
	if (offer.sessionCount > 1) return `First of ${offer.sessionCount} sessions · ${minutes} minutes`;
	return `${minutes} minute session`;
}
// #endregion
