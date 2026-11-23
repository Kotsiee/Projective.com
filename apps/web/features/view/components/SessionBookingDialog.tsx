import type { ComponentChildren, JSX } from "preact";
import { type ReadonlySignal, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button, FormControl, NumberInput, Textarea } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { MoneyView } from "@projective/ui/display/money";
import "@features/profile/styles/profile-hire.css";
import "../styles/service-booking.css";
import { DateRail } from "./DateRail.tsx";
import { SlotPicker } from "./SlotPicker.tsx";
import { CtaButton } from "./CtaButton.tsx";
import { OfferLedger } from "./OfferLedger.tsx";
import { SimulationOutcome } from "./SimulationNotices.tsx";
import { useCtaFeedback } from "../core/cta-feedback.ts";
import { commitContact, commitSession, readSlots } from "../core/booking-commits.ts";
import {
	callLedger,
	type ConversionLedger,
	seatLedger,
	sessionLedger,
} from "../core/conversion-ledger.ts";
import type { OfferSummary } from "../core/offer-summary.ts";
import {
	clearSimulationOutcome,
	SIMULATED_COMMIT_LABEL,
	SIMULATED_SETTLED_LABEL,
	simulating,
} from "../core/simulation.ts";
import { sittingLabel } from "../core/sitting-time.ts";
import { cohortMinimumSentence } from "../core/cohort-terms.ts";
import { useIntakeAnswers } from "../hooks/useIntakeAnswers.ts";
import type { BookableSlot, SlotGrid, SlotPurpose } from "@projective/types/scheduling";
import { addDaysInZone, firstOpenDay } from "@projective/types/scheduling";
import type { SessionPlanItem } from "@projective/types/explore";
import {
	type IntakeField,
	plural,
	type ServiceBookingOffer,
	SESSION_SEATS_MAX,
} from "@projective/types/services";
import { IntakeFields } from "@web/features/profile/components/hire/IntakeFields.tsx";
import { SplitModal } from "@web/features/profile/components/hire/SplitModal.tsx";

/**
 * SessionBookingDialog — the dialog behind **Book session**, **Book *n* sessions**, **Reserve seat**
 * and the Contact menu's **Book a discovery call**, in the shared two-column conversion frame
 * (`SplitModal`, Decision #424). The listing page mounts it through `SessionBookingModal`; the
 * profile's Hire popover mounts the SAME dialog for a session listing (Decision #453), so a block is
 * booked with its later sittings and a cohort with its intake wherever it is bought.
 *
 * LEFT, in the fixed order every conversion dialog keeps: the commitment (the provider's date rail and
 * bookable slots; for a cohort its fixed sittings and a seat count), the buyer's note, then the
 * seller's intake questions. RIGHT, the live offer ledger: the picked times or seats and the total.
 * FOOTER, the state in words and the one tier-1 commit.
 *
 * # Rules the implementation holds
 *
 * **The host binds it.** Which flow is open, the offer and where a close or an outcome goes are
 * props, so the dialog holds no page state of its own. An offer still being read opens the frame in
 * its loading state rather than a second dialog swapped in later.
 *
 * **The grid is re-read, never patched.** After a refused booking the whole window is re-fetched, so
 * the picker never drifts from the provider's real calendar. A window that fails to load says so with
 * a Try again, and an empty one offers the next window — the picker is never silently absent.
 *
 * **A block books session 1 and as many of the rest as the buyer wants (Decision #411).** Picks are
 * kept in time order, so the earliest is session 1; the commit waits only for that one.
 *
 * **A cohort has no time to pick.** Its sittings are fixed, so the panel lists them and asks for seats
 * and the seller's intake; the commit holds the seats (`reserve_seat`, Decision #171) with the answers
 * on the seat line, which carries them to the order line (Decision #453).
 */

/** How many days one window of the rail holds. Paging is by window, not by day. */
const WINDOW_DAYS = 14;
/** The most seats one booking may take (`SessionBookingInputSchema.seats`); the real cap is what remains. */
const SEATS_MAX = SESSION_SEATS_MAX;
const NO_INTAKE: readonly IntakeField[] = [];
const NO_PLAN: readonly SessionPlanItem[] = [];

/** Which of the dialog's flows is open: a listing's booking, or its provider's discovery call. */
export type SessionDialogFlow = "booking" | "call";

/** Props for {@link SessionBookingDialog}. */
export interface SessionBookingDialogProps {
	/** The offer being booked; `null` while the host is still reading it. */
	offer: ReadonlySignal<ServiceBookingOffer | null>;
	/** The open flow, or `null` while the dialog is closed. */
	flow: ReadonlySignal<SessionDialogFlow | null>;
	/** The listing's own intake questions (`ServiceView.intake`), asked before a booking commits. */
	intake?: readonly IntakeField[];
	/** A block's sittings as the seller describes them (`ServiceView.sessionPlan`), naming each row. */
	sessionPlan?: readonly SessionPlanItem[];
	/** The listing as the page names it — the offer column; `null` while the host is still reading it. */
	summary: OfferSummary | null;
	/** The dialog's title while the offer is still being read. */
	pendingTitle?: string;
	/** Whether the host is still reading the offer; with no offer and no read, the host's notice says why. */
	reading?: boolean;
	/** Something the host says above both columns — a failed read, a signed-out visitor. */
	notice?: ComponentChildren;
	onClose: () => void;
	/** Where an outcome sentence goes — the host's status line. */
	onAnnounce: (message: string) => void;
	/** A signed-out buyer's commit (`offer.requiresSignIn`); the commit is refused without one. */
	onSignIn?: () => void;
}

/** The session booking dialog, bound to its host through {@link SessionBookingDialogProps}. */
export function SessionBookingDialog(props: SessionBookingDialogProps): JSX.Element {
	const intake = props.intake ?? NO_INTAKE;
	const sessionPlan = props.sessionPlan ?? NO_PLAN;
	const offer = props.offer;
	const open = useComputed(() => props.flow.value !== null);
	const isCall = useComputed(() => props.flow.value === "call");
	const isCohort = useComputed(() => !isCall.value && offer.value?.format === "cohort");

	const grid = useSignal<SlotGrid | null>(null);
	const windowFrom = useSignal<number | null>(null);
	const selectedDay = useSignal<string | null>(null);
	const picks = useSignal<readonly BookableSlot[]>([]);
	const selectedSlots = useComputed(() => picks.value.map((slot) => slot.id));
	const note = useSignal("");
	const noteRefused = useSignal(false);
	/** A seat count past the cohort's remaining seats, refused at submit rather than trimmed quietly. */
	const seatsRefused = useSignal<string | null>(null);
	const seats = useSignal<number | null>(1);
	const callType = useSignal<"courtesy" | "paid">("courtesy");
	const loading = useSignal(false);
	const loadError = useSignal<string | null>(null);
	const error = useSignal<string | null>(null);
	const cta = useCtaFeedback();
	const bodyRef = useRef<HTMLDivElement>(null);
	const firstRef = useRef<HTMLDivElement>(null);
	const intakeState = useIntakeAnswers(intake, bodyRef);

	const purpose = useComputed<SlotPurpose>(() =>
		isCall.value
			? "discovery_call"
			: offer.value?.format === "set_session"
			? "set_session"
			: "session"
	);

	/** A discovery call books against the PROVIDER's handle; a listing books against the listing. */
	const subjectId = useComputed(() =>
		isCall.value ? offer.value?.contact.handle ?? "" : offer.value?.subjectId ?? ""
	);

	/** How many slots this flow may take: a block up to its size, everything else exactly one. */
	const maxSlots = useComputed(() =>
		!isCall.value && offer.value?.format === "set_session"
			? Math.max(1, offer.value.sessionCount)
			: 1
	);

	const seatCap = useComputed(() =>
		Math.min(SEATS_MAX, Math.max(1, offer.value?.capacity?.remaining ?? 1))
	);

	/** The viewer's own IANA zone, read from `Intl` on the client — never guessed server-side. */
	function viewerZone(): string | undefined {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
		} catch {
			return undefined;
		}
	}

	async function loadGrid(from?: number | null): Promise<void> {
		loading.value = true;
		loadError.value = null;
		const res = await readSlots({
			subjectId: subjectId.value,
			purpose: purpose.value,
			timezone: viewerZone(),
			from: from ?? undefined,
			days: WINDOW_DAYS,
		});
		loading.value = false;
		if (!res.ok || !res.data) {
			loadError.value = res.message ?? "We couldn't load this provider's availability.";
			return;
		}
		grid.value = res.data.grid;
		windowFrom.value = res.data.grid.days[0]?.startsAt ?? null;
		const stillVisible = selectedDay.value &&
			res.data.grid.days.some((d) => d.key === selectedDay.value);
		if (!stillVisible) selectedDay.value = firstOpenDay(res.data.grid)?.key ?? null;
	}

	const subjectKey = offer.value?.subjectId ?? null;

	useEffect(() => {
		if (!open.value || !subjectKey || isCohort.value || grid.value) return;
		void loadGrid(null);
	}, [open.value, subjectKey]);

	useEffect(() => {
		if (subjectKey) intakeState.reset();
	}, [subjectKey]);

	useEffect(() => {
		if (open.value) {
			clearSimulationOutcome();
			return;
		}
		grid.value = null;
		windowFrom.value = null;
		selectedDay.value = null;
		picks.value = [];
		note.value = "";
		noteRefused.value = false;
		seats.value = 1;
		loadError.value = null;
		error.value = null;
		intakeState.reset();
		cta.reset();
	}, [open.value]);

	function toggleSlot(id: string): void {
		error.value = null;
		const current = picks.value;
		if (current.some((slot) => slot.id === id)) {
			removePick(id);
			return;
		}
		const slot = slotById(grid.value, id);
		if (!slot) return;
		if (maxSlots.value === 1) {
			picks.value = [slot];
			return;
		}
		const clash = current.findIndex((p) => slot.startsAt < p.endsAt && p.startsAt < slot.endsAt);
		if (clash >= 0) {
			error.value = `That time overlaps session ${clash + 1}. Pick another time.`;
			return;
		}
		picks.value = [...current, slot].sort((a, b) => a.startsAt - b.startsAt);
	}

	function removePick(id: string): void {
		picks.value = picks.value.filter((slot) => slot.id !== id);
	}

	function page(delta: number): void {
		const g = grid.value;
		if (!g) return;
		const from = windowFrom.value ?? g.windowStart;
		const next = addDaysInZone(from, delta * WINDOW_DAYS, g.viewerTimezone);
		void loadGrid(Math.max(g.windowStart, Math.min(next, g.windowEnd)));
	}

	const canPrev = useComputed(() => {
		const g = grid.value;
		return !!g && (windowFrom.value ?? g.windowStart) > g.windowStart;
	});

	const canNext = useComputed(() => {
		const g = grid.value;
		if (!g) return false;
		const last = g.days[g.days.length - 1];
		return !!last && last.startsAt < g.windowEnd;
	});

	const zone = useComputed(() => grid.value?.viewerTimezone ?? viewerZone() ?? null);
	const pickLabels = useComputed(() => picks.value.map((pick) => pickLabel(pick, zone.value)));

	const sittings = useComputed(() => offer.value?.cohort?.sittings ?? []);
	const sittingsLine = useComputed(() => cohortLine(sittings.value, zone.value));
	const minimumLine = useComputed(() =>
		cohortMinimumSentence(offer.value?.cohort ?? null, zone.value)
	);

	const ready = useComputed(() =>
		!!offer.value && (isCohort.value ? sittings.value.length > 0 : selectedSlots.value.length > 0)
	);

	async function submit(): Promise<boolean> {
		error.value = null;
		const o = offer.value;
		if (!o) return false;
		if (!ready.value) {
			error.value = isCohort.value
				? "This cohort has no sittings scheduled yet."
				: maxSlots.value > 1
				? "Pick a time for session 1 first."
				: "Pick a time first.";
			return false;
		}
		if (o.requiresSignIn) {
			if (props.onSignIn) props.onSignIn();
			else error.value = "Sign in to book.";
			return false;
		}

		if (isCall.value) {
			const call = o.contact.callOffer;
			if (call?.agendaRequired && !note.value.trim()) {
				noteRefused.value = true;
				return false;
			}
			const out = await commitContact({
				kind: "discovery_call",
				handle: o.contact.handle,
				subjectId: o.subjectId,
				slotId: selectedSlots.value[0],
				callType: callType.value,
				timezone: viewerZone(),
				agenda: note.value.trim() || undefined,
			}, grid.value?.durationMinutes ?? null);
			if (out.simulated) return true;
			const res = out.value;
			if (!res.ok || !res.data) {
				error.value = res.message ?? "We couldn't request that call.";
				if (res.errors?.slotId) void loadGrid(windowFrom.value);
				return false;
			}
			props.onAnnounce(res.data.result.confirmation);
			setTimeout(() => props.onClose(), 900);
			return true;
		}

		if (isCohort.value) {
			const wanted = seats.value ?? 1;
			if (!Number.isInteger(wanted) || wanted < 1 || wanted > seatCap.value) {
				seatsRefused.value = seatCap.value === 1
					? "Only 1 seat is left in this cohort."
					: `Choose between 1 and ${seatCap.value} seats: that's how many are left.`;
				return false;
			}
			seatsRefused.value = null;
		}
		if (!intakeState.check()) return false;

		const out = await commitSession({
			subjectId: o.subjectId,
			format: o.format,
			slotIds: isCohort.value ? [sittings.value[0].id] : [...selectedSlots.value],
			timezone: viewerZone(),
			note: note.value.trim() || undefined,
			seats: isCohort.value ? seats.value ?? 1 : 1,
			answers: intakeState.answers.value,
		});
		if (out.simulated) return true;
		const res = out.value;
		if (!res.ok || !res.data) {
			if (intakeState.fromServer(res.message, res.errors)) return false;
			error.value = res.message ?? "We couldn't add that to your basket.";
			if (res.errors?.slotId || res.errors?.slotIds) void loadGrid(windowFrom.value);
			return false;
		}
		props.onAnnounce(res.data.outcome.summary);
		const route = res.data.outcome.route;
		setTimeout(() => {
			try {
				globalThis.location.href = route;
			} catch { /* SSR / no window — non-fatal */ }
		}, 700);
		return true;
	}

	const o = offer.value;
	const summary = props.summary;
	const g = grid.value;
	const call = o?.contact.callOffer ?? null;
	const simulated = simulating.value;
	const bothCallTypes = !!call?.courtesyEnabled && !!call?.paidEnabled;
	const blockSize = maxSlots.value;
	const sellerName = o?.contact.sellerName ?? "The provider";
	const dayHasSlots = !!g && !!selectedDay.value && (g.slots[selectedDay.value]?.length ?? 0) > 0;
	const windowEmpty = !!g && !firstOpenDay(g);

	const ledger: ConversionLedger | null = !o || !summary ? null : isCall.value
		? callLedgerFor(
			o,
			callType.value,
			pickLabels.value[0] ?? null,
			grid.value?.durationMinutes ?? null,
		)
		: isCohort.value
		? seatLedger(summary.price, seats.value ?? 1, sittingsLine.value)
		: sessionLedger(summary.price, pickLabels.value, blockSize);
	const total = ledger?.total ?? null;

	const left = !o
		? (props.reading ?? true)
			? <p class="sbk__loading" role="status">Loading the listing…</p>
			: null
		: (
			<div class="sbk__form">
				<section
					class="sbk__section"
					aria-labelledby="sbk-when-label"
					ref={firstRef}
					tabIndex={-1}
				>
					<h3 class="sbk__sectiontitle" id="sbk-when-label">
						{isCohort.value ? "Cohort dates" : "Pick a time"}
					</h3>

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

					{isCohort.value
						? (
							sittings.value.length > 0
								? (
									<>
										<ol class="sbk__sittings">
											{sittings.value.map((s, i) => (
												<li class="sbk__sitting" key={s.id}>
													<span class="sbk__stagenum">{i + 1}</span>
													<span class="sbk__sittingtitle">{s.title}</span>
													<span class="sbk__sittingwhen">
														{sittingLabel(s.startsAt, s.endsAt, zone.value)}
													</span>
												</li>
											))}
										</ol>
										{minimumLine.value && <p class="sbk__about">{minimumLine.value}</p>}
									</>
								)
								: (
									<p class="sbk__about">
										{sellerName} hasn't scheduled this cohort's sittings yet.
									</p>
								)
						)
						: loadError.value
						? (
							<InlineNotice
								assertive
								align="start"
								class="sbk__notice"
								icon={<Icon name="error" size="xs" />}
								text={loadError.value}
								actionLabel="Try again"
								busy={loading.value}
								onAction={() => void loadGrid(windowFrom.value)}
							/>
						)
						: !g
						? <p class="sbk__loading" role="status">Loading availability…</p>
						: (
							<>
								<DateRail
									days={g.days}
									selected={selectedDay.value}
									onSelect={(key) => {
										selectedDay.value = key;
										if (blockSize === 1) picks.value = [];
									}}
									timezone={g.viewerTimezone}
									onPrev={canPrev.value ? () => page(-1) : undefined}
									onNext={canNext.value ? () => page(1) : undefined}
									busy={loading.value}
								/>
								{windowEmpty
									? (
										<InlineNotice
											align="start"
											class="sbk__notice"
											text={`${sellerName} has no open times in these two weeks.`}
											actionLabel={canNext.value ? "Show the next two weeks" : undefined}
											onAction={canNext.value ? () => page(1) : undefined}
										/>
									)
									: (
										<SlotPicker
											grid={g}
											dayKey={selectedDay.value}
											selected={selectedSlots.value}
											onToggle={toggleSlot}
											max={blockSize}
											busy={loading.value}
										/>
									)}
								{!windowEmpty && selectedDay.value && !dayHasSlots && (
									<p class="sbk__about">No open times on this day — pick another.</p>
								)}
							</>
						)}
				</section>

				{blockSize > 1 && (
					<section class="sbk__section" aria-labelledby="sbk-plan-label">
						<h3 class="sbk__sectiontitle" id="sbk-plan-label">Your sessions</h3>
						<p class="sbk__about">
							Session 1 needs a time. Pick times for the others now, or leave them to book later.
							The earliest time you pick is session 1.
						</p>
						<dl class="sbk__stages" aria-live="polite">
							{Array.from({ length: blockSize }, (_, i) => {
								const pick = picks.value[i];
								const title = sessionPlan[i]?.title;
								return (
									<div class="sbk__stagerow" key={i} data-included={pick ? "true" : undefined}>
										<dt class="sbk__stagename">
											<span class="sbk__stagenum">{i + 1}</span>
											<span>{title || `Session ${i + 1}`}</span>
										</dt>
										<dd class="sbk__stagevalue">
											{pick
												? (
													<span class="sbk__picked">
														<span>{pickLabels.value[i]}</span>
														<button
															type="button"
															class="sbk__unpick"
															aria-label={`Remove the time for session ${i + 1}`}
															onClick={() => removePick(pick.id)}
														>
															<Icon name="close" size="sm" aria-hidden />
														</button>
													</span>
												)
												: (
													<span class="sbk__stagelater">
														{i === 0 ? "Needs a time" : "Book later"}
													</span>
												)}
										</dd>
									</div>
								);
							})}
						</dl>
					</section>
				)}

				{isCohort.value && (
					<section class="sbk__section">
						<FormControl
							label="Seats"
							hint={o.capacity?.sentence}
							note={`Up to ${seatCap.value}`}
							error={seatsRefused.value ?? undefined}
							status={seatsRefused.value ? "invalid" : "default"}
						>
							{(a) => (
								<NumberInput
									id="sbk-seats"
									aria-describedby={a.describedBy}
									status={a.status}
									value={seats}
									min={1}
									max={seatCap.value}
									step={1}
									maxFractionDigits={0}
									placeholder={seatCap.value > 1 ? `1–${seatCap.value}` : "1"}
									icon="members"
									enableIconScrub
									buttonLayout="split"
									onValueChange={() => (seatsRefused.value = null)}
									class="sbk__seatsfield"
								/>
							)}
						</FormControl>
					</section>
				)}

				<section class="sbk__section">
					<FormControl
						label={isCall.value ? "What is the call about?" : `Anything ${sellerName} should know?`}
						note={isCall.value && call?.agendaRequired ? undefined : "Optional"}
						required={isCall.value && !!call?.agendaRequired}
						error={noteRefused.value && !note.value.trim()
							? `${sellerName} asks what the call is about before confirming.`
							: undefined}
						status={noteRefused.value && !note.value.trim() ? "invalid" : "default"}
					>
						{(a) => (
							<Textarea
								id="sbk-note"
								aria-describedby={a.describedBy}
								status={a.status}
								value={note}
								rows={3}
								maxRows={8}
								autoResize
								maxLength={2000}
								fluid
							/>
						)}
					</FormControl>
				</section>

				{!isCall.value && intake.length > 0 && (
					<section class="sbk__section" aria-labelledby="sbk-intake-label">
						<h3 class="sbk__sectiontitle" id="sbk-intake-label">{sellerName} asks</h3>
						<IntakeFields
							fields={intake}
							answers={intakeState.answers}
							refusal={intakeState.refusal()}
							idPrefix="sbk-intake"
						/>
					</section>
				)}

				{error.value && (
					<InlineNotice
						assertive
						align="start"
						class="sbk__notice"
						icon={<Icon name="error" size="xs" />}
						text={error.value}
						actionLabel={ready.value ? "Try again" : undefined}
						busy={cta.phase === "pending"}
						onAction={ready.value ? () => void cta.run(submit) : undefined}
					/>
				)}
				{simulated && <SimulationOutcome />}
			</div>
		);

	return (
		<SplitModal
			open={open}
			title={!o
				? props.pendingTitle ?? "Book"
				: isCall.value
				? `Book a call with ${sellerName}`
				: bookHeader(o)}
			subtitle={isCall.value ? "Discovery call" : isCohort.value ? "Group session" : "Session"}
			left={left}
			right={o && summary && ledger
				? <OfferLedger summary={summary} ledger={ledger} escrows={!isCall.value && o.escrows} />
				: null}
			asideLabel="Your booking"
			notice={props.notice}
			loading={!o}
			summary={o
				? (
					<>
						<span class="sbk__summarymain">
							{summaryLine(o, isCall.value, isCohort.value, pickLabels.value, seats.value ?? 1)}
							{total && (
								<span class="sbk__summarytotal">
									{" · "}
									<MoneyView
										minor={total.amount.minor}
										currency={total.amount.currency}
										hideOrigin
									/>
								</span>
							)}
						</span>
						<span class="sbk__summarynote">
							{blockSize > 1 && picks.value.length > 0 && picks.value.length < blockSize
								? `The other ${blockSize - picks.value.length} ${
									plural(blockSize - picks.value.length, "session")
								} can be booked later.`
								: isCall.value
								? `${sellerName} confirms the time.`
								: "You review everything at checkout before paying."}
						</span>
					</>
				)
				: null}
			actions={
				<>
					<Button variant="text" severity="secondary" label="Cancel" onClick={props.onClose} />
					<CtaButton
						label={simulated
							? SIMULATED_COMMIT_LABEL
							: isCall.value
							? "Request call"
							: "Continue to checkout"}
						settledLabel={simulated
							? SIMULATED_SETTLED_LABEL
							: isCall.value
							? "Requested"
							: "Selected"}
						phase={cta.phase}
						tone={isCall.value ? "inverted" : "accent"}
						disabled={!ready.value || loading.value}
						icon={<Icon name={isCall.value ? "calendar" : "arrow-right"} size="sm" aria-hidden />}
						fluid={false}
						onClick={() => void cta.run(submit)}
					/>
				</>
			}
			initialFocusRef={firstRef}
			bodyRef={bodyRef}
			onClose={props.onClose}
			class="sbk-split"
		/>
	);
}

// #region Copy
/** The call ledger for the call type picked, priced from the provider's own call offer. */
function callLedgerFor(
	offer: ServiceBookingOffer,
	type: "courtesy" | "paid",
	pick: string | null,
	gridMinutes: number | null,
): ConversionLedger {
	const call = offer.contact.callOffer;
	const paid = type === "paid";
	const fee = paid && call?.feeAmountMinor != null && call.feeCurrency
		? { minor: call.feeAmountMinor, currency: call.feeCurrency }
		: null;
	const minutes = (paid ? call?.paidDurationMinutes : call?.courtesyDurationMinutes) ??
		gridMinutes ?? 30;
	return callLedger(type, minutes, pick, fee);
}

/** The dialog's title, per format. */
function bookHeader(offer: ServiceBookingOffer): string {
	switch (offer.format) {
		case "cohort":
			return `Reserve a seat on ${offer.subjectTitle}`;
		case "set_session":
			return `Book ${offer.sessionCount} sessions`;
		default:
			return `Book ${offer.subjectTitle}`;
	}
}

/** The footer's running state, in the Meta register — what is about to happen, in words. */
function summaryLine(
	offer: ServiceBookingOffer,
	isCall: boolean,
	isCohort: boolean,
	picked: readonly string[],
	seats: number,
): string {
	if (isCohort) return `${seats} ${plural(seats, "seat")} · ${offer.subjectTitle}`;
	if (picked.length === 0) return isCall ? "Pick a time for the call" : "Pick a time to continue";
	if (!isCall && offer.format === "set_session" && offer.sessionCount > 1) {
		return `${picked.length} of ${offer.sessionCount} sessions scheduled · ${picked[0]}`;
	}
	return picked[0];
}

/** A chosen slot's day and time window in the viewer's zone. */
function pickLabel(slot: BookableSlot, zone: string | null): string {
	return sittingLabel(
		new Date(slot.startsAt).toISOString(),
		new Date(slot.endsAt).toISOString(),
		zone,
	);
}

/** A cohort's run in one line — its sitting count and first date. */
function cohortLine(
	sittings: readonly { startsAt: string; endsAt: string }[],
	zone: string | null,
): string | null {
	const first = sittings[0];
	if (!first) return null;
	const when = sittingLabel(first.startsAt, first.endsAt, zone);
	return sittings.length === 1 ? when : `${sittings.length} sittings from ${when}`;
}

/** A slot anywhere in the loaded window, by id. */
function slotById(grid: SlotGrid | null, id: string): BookableSlot | null {
	if (!grid) return null;
	for (const day of Object.values(grid.slots)) {
		const hit = day.find((slot) => slot.id === id);
		if (hit) return hit;
	}
	return null;
}
// #endregion
