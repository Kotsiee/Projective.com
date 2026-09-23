import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { RatingStars } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { Button, Textarea } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { EntityView } from "@projective/types/explore";
import type { SlotGrid } from "@projective/types/scheduling";
import { addDaysInZone, firstOpenDay } from "@projective/types/scheduling";
import type { IntakeAnswers, IntakeRefusal, ServiceBookingOffer } from "@projective/types/services";
import {
	emptyIntakeAnswers,
	FORMAT_LABEL,
	intakeAnswerLines,
	intakeRefusal,
	isScheduledFormat,
} from "@projective/types/services";
import { ExploreService } from "@features/explore/core/ExploreService.ts";
import { serviceStartingPrice } from "@features/explore/core/pricing.ts";
import { BookingService } from "@features/view/core/BookingService.ts";
import { DateRail } from "@features/view/components/DateRail.tsx";
import { SlotPicker } from "@features/view/components/SlotPicker.tsx";
import { EntityPreview } from "@features/view/components/EntityPreview.tsx";
import { currentPath, requestSignIn } from "@features/auth/core/sign-in-prompt.ts";
import type { ServiceItem } from "../../types/profile-types.ts";
import { focusFirstRefused, IntakeFields } from "./IntakeFields.tsx";
import { SplitModal } from "./SplitModal.tsx";

/**
 * ServiceDetailModal — the split modal a listing opens from the Hire popover.
 *
 * LEFT, the buyer's inputs: for a scheduled format the date rail + slot picker (the `/view` page's
 * own components, reused), then an optional message, then the seller's intake fields. RIGHT, the
 * listing in the `/view` page's vocabulary ({@link EntityPreview}, fed the same projection the page
 * SSRs). FOOTER: the starting price, the rating and the turnaround on the leading side, and the
 * primary on the trailing side.
 *
 * # The primary is the offer's, not the modal's
 *
 * What the button says and does is `offer.cta.primary` — the SAME server-resolved rig the `/view`
 * page's lane and buy bar render (§D.7.4 applied to the data): a scoped engagement stages a brief
 * and continues to checkout; a session books the chosen slot and continues to checkout; a pipeline
 * is added to the buyer's projects as a draft (and a draft that already exists opens instead). The
 * modal dispatches on `kind`, never on the format, so a format that reuses an existing flow needs
 * no change here.
 *
 * # The brief is composed, and required only when nothing else says what the work is
 *
 * A scoped engagement is delivered against a specification, and the platform refuses to stage one
 * against nothing. The message is optional, as the brief asks — but the seller's answered intake
 * fields ARE a specification, so the `requirements` sent is the message plus the answers as
 * `Label: value` lines, and the primary refuses only when BOTH are empty.
 *
 * # A guest browses; the primary intercepts
 *
 * The modal opens for a signed-out visitor — the preview is public information — and its primary
 * opens the sign-in prompt with a return path, the same interception the hero's Follow uses.
 */
export interface ServiceDetailModalProps {
	/** The listing picked in the Hire popover, or `null` while closed. */
	service: Signal<ServiceItem | null>;
	/** The profile's `@handle`, so the offer's sign-in bounce returns to this page's namespace. */
	handle: string;
	sellerName: string;
	authed: boolean;
	/** A sentence for the hero's status line once something happened. */
	onNotice: (text: string) => void;
}

/** How many days one window of the rail holds. */
const WINDOW_DAYS = 14;

export default function ServiceDetailModal(
	{ service, handle, sellerName, authed, onNotice }: ServiceDetailModalProps,
): JSX.Element {
	const open = useSignal(false);
	const view = useSignal<EntityView | null>(null);
	const offer = useSignal<ServiceBookingOffer | null>(null);
	const loadError = useSignal<string | null>(null);
	const loading = useSignal(false);

	const message = useSignal("");
	const answers = useSignal<IntakeAnswers>({});
	const intakeBlock = useSignal<IntakeRefusal | null>(null);
	const attempted = useSignal(false);

	const grid = useSignal<SlotGrid | null>(null);
	const windowFrom = useSignal<number | null>(null);
	const selectedDay = useSignal<string | null>(null);
	const selectedSlot = useSignal<string | null>(null);
	const seats = useSignal(1);
	const gridLoading = useSignal(false);

	const sending = useSignal(false);
	const error = useSignal<string | null>(null);
	const firstFieldRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	/** Counts refused attempts; the focus move is keyed on it so it runs AFTER the marks render. */
	const refusedAttempts = useSignal(0);

	const picked = service.value;

	/**
	 * Once an attempt has been refused, the rule re-runs on every answer so a field that has since
	 * been filled stops saying it is required — an error left standing beside a satisfied control is
	 * a stale claim, and the same rule runs again on Send anyway. Before the first attempt nothing
	 * paints (§A.7.5: fields paint on touch, never at rest).
	 */
	useEffect(() => {
		if (!attempted.value) return;
		intakeBlock.value = intakeRefusal(view.value?.service?.intake ?? [], answers.value);
	}, [answers.value]);

	useEffect(() => {
		if (refusedAttempts.value === 0) return;
		focusFirstRefused(bodyRef.current);
	}, [refusedAttempts.value]);

	function viewerZone(): string | undefined {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
		} catch {
			return undefined;
		}
	}

	async function load(id: string): Promise<void> {
		loading.value = true;
		loadError.value = null;
		view.value = null;
		offer.value = null;
		const [viewRead, offerRead] = await Promise.all([
			ExploreService.view(id),
			BookingService.offer(id, { handle }),
		]);
		if (service.value?.id !== id) return; // another listing was picked meanwhile
		loading.value = false;
		if (!viewRead.ok || !viewRead.data || !offerRead.ok || !offerRead.data) {
			loadError.value = viewRead.message ?? offerRead.message ?? "Couldn't load this listing.";
			return;
		}
		view.value = viewRead.data;
		offer.value = offerRead.data.offer;
		answers.value = emptyIntakeAnswers(viewRead.data.service?.intake ?? []);
		if (isScheduledFormat(offerRead.data.offer.format)) void loadGrid(id, null);
	}

	async function loadGrid(id: string, from: number | null): Promise<void> {
		const format = offer.value?.format;
		if (!format || !isScheduledFormat(format)) return;
		gridLoading.value = true;
		const res = await BookingService.slots({
			subjectId: id,
			purpose: format === "cohort"
				? "cohort"
				: format === "set_session"
				? "set_session"
				: "session",
			timezone: viewerZone(),
			from: from ?? undefined,
			days: WINDOW_DAYS,
		});
		gridLoading.value = false;
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

	// Opening: a picked listing opens the modal and fetches it; clearing it closes the modal.
	useEffect(() => {
		if (!picked) {
			open.value = false;
			return;
		}
		open.value = true;
		message.value = "";
		answers.value = {};
		intakeBlock.value = null;
		attempted.value = false;
		grid.value = null;
		windowFrom.value = null;
		selectedDay.value = null;
		selectedSlot.value = null;
		seats.value = 1;
		error.value = null;
		sending.value = false;
		void load(picked.id);
	}, [picked?.id]);

	function close(): void {
		service.value = null;
	}

	function page(delta: number): void {
		const g = grid.value;
		if (!g || !picked) return;
		const from = windowFrom.value ?? g.windowStart;
		const next = addDaysInZone(from, delta * WINDOW_DAYS, g.viewerTimezone);
		void loadGrid(picked.id, Math.max(g.windowStart, Math.min(next, g.windowEnd)));
	}

	/** Re-run the seller's rule; `true` when the answers pass. */
	function checkIntake(): boolean {
		const fields = view.value?.service?.intake ?? [];
		const block = intakeRefusal(fields, answers.value);
		intakeBlock.value = block;
		return block === null;
	}

	/** The brief the engagement is delivered against — the message plus the answers as lines. */
	function composedBrief(): string {
		const fields = view.value?.service?.intake ?? [];
		const lines = intakeAnswerLines(fields, answers.value);
		const text = message.value.trim();
		return [text, ...(lines.length ? [lines.join("\n")] : [])].filter(Boolean).join("\n\n");
	}

	function go(route: string): void {
		try {
			globalThis.location.href = route;
		} catch { /* SSR / no window — non-fatal */ }
	}

	async function submit(): Promise<void> {
		const o = offer.value;
		const v = view.value;
		if (!o || !v || !picked || sending.value) return;
		if (o.requiresSignIn) {
			requestSignIn({ intent: "hire", returnTo: currentPath(), subject: sellerName });
			return;
		}
		attempted.value = true;
		error.value = null;
		if (!checkIntake()) {
			refusedAttempts.value++;
			return;
		}

		const kind = o.cta.primary.kind;
		sending.value = true;
		try {
			switch (kind) {
				case "open_scope": {
					const brief = composedBrief();
					if (!brief) {
						error.value =
							"Describe what you need, or answer the questions — the work is delivered against it.";
						return;
					}
					const res = await BookingService.configure({
						subjectId: o.subjectId,
						format: o.format,
						requirements: brief,
						fundingScope: "first_stage",
						stageIds: [],
						attachments: [],
						answers: answers.value,
					});
					if (!res.ok || !res.data) {
						error.value = res.message ?? "Could not stage that. Please try again.";
						return;
					}
					onNotice(res.data.outcome.summary);
					go(res.data.outcome.route);
					return;
				}
				case "open_scheduler": {
					const slot = selectedSlot.value;
					if (!slot) {
						error.value = "Pick a time first.";
						return;
					}
					const res = await BookingService.bookSession({
						subjectId: o.subjectId,
						format: o.format,
						slotIds: [slot],
						timezone: viewerZone(),
						note: message.value.trim() || undefined,
						seats: o.format === "cohort" ? seats.value : 1,
						answers: answers.value,
					});
					if (!res.ok || !res.data) {
						error.value = res.message ?? "Could not hold that time.";
						// Somebody may have taken the slot: re-read rather than keep a stale grid on screen.
						if (res.errors?.slotId || res.errors?.slotIds) {
							void loadGrid(picked.id, windowFrom.value);
						}
						return;
					}
					onNotice(res.data.outcome.summary);
					go(res.data.outcome.route);
					return;
				}
				case "instantiate_pipeline": {
					const res = await BookingService.instantiatePipeline({
						serviceId: o.subjectId,
						workspaceId: null,
						idempotencyKey: `${o.subjectId}-${loadNonce()}`,
					});
					if (!res.ok || !res.data) {
						error.value = res.message ?? "Could not add that to your projects.";
						return;
					}
					onNotice(
						res.data.created
							? "Added to your projects as a draft."
							: "This service is already in your projects.",
					);
					go(res.data.draft.boardHref);
					return;
				}
				default:
					return;
			}
		} finally {
			sending.value = false;
		}
	}

	// ---- Derived presentation ----
	const v = view.value;
	const o = offer.value;
	const g = grid.value;
	const scheduled = !!o && isScheduledFormat(o.format);
	const primary = o?.cta.primary ?? null;
	const primaryHref = primary?.href ?? null;
	const primaryLabel = primary
		? primary.kind === "open_scope" || primary.kind === "open_scheduler"
			? "Proceed to checkout"
			: primary.label
		: "Proceed to checkout";
	const price = picked ? serviceStartingPrice(picked) : null;
	const rating = picked?.rating?.asHelper ?? picked?.rating?.asClient ?? null;
	const intake = v?.service?.intake ?? [];
	const disabled = !o || loading.value || sending.value || !!primary?.disabled ||
		(scheduled && !selectedSlot.value);

	const summary = picked
		? (
			<>
				<span class="pf-split__summarymain">
					{price?.amount
						? (
							<>
								{price.isFloor && <span class="pf-split__from">From</span>}{" "}
								<MoneyView minor={price.amount.minor} currency={price.amount.currency} hideOrigin />
								{price.unit && <span class="pf-split__unit">/ {price.unit}</span>}
							</>
						)
						: price?.fallback}
				</span>
				<span class="pf-split__summarymeta">
					{rating && <RatingStars value={rating.value} count={rating.count} compact size="sm" />}
					{o && (
						<>
							{rating && <span class="pf-split__dot" aria-hidden="true">·</span>}
							<span>{FORMAT_LABEL[o.format]}</span>
						</>
					)}
					{picked.delivery && (
						<>
							<span class="pf-split__dot" aria-hidden="true">·</span>
							<span>{picked.delivery}</span>
						</>
					)}
				</span>
			</>
		)
		: null;

	const actions = (
		<>
			<Button variant="text" severity="secondary" label="Cancel" onClick={close} />
			{primaryHref
				? (
					<a
						class="ui-button ui-button--primary ui-button--filled ui-button--size-md"
						href={primaryHref}
					>
						<span class="ui-button__label">{primaryLabel}</span>
					</a>
				)
				: (
					<Button
						variant="filled"
						severity="primary"
						label={sending.value ? "Working…" : primaryLabel}
						loading={sending.value}
						disabled={disabled}
						onClick={() => void submit()}
					/>
				)}
		</>
	);

	const left = (
		<div class="pf-split__form">
			{scheduled && (
				<section class="pf-split__section" aria-label="Pick a time">
					<h3 class="pf-split__label">Pick a time</h3>
					{g
						? (
							<>
								<DateRail
									days={g.days}
									selected={selectedDay.value}
									onSelect={(key) => {
										selectedDay.value = key;
										selectedSlot.value = null;
									}}
									timezone={g.viewerTimezone}
									onPrev={(windowFrom.value ?? g.windowStart) > g.windowStart
										? () => page(-1)
										: undefined}
									onNext={(() => {
										const last = g.days[g.days.length - 1];
										return last && last.startsAt < g.windowEnd ? () => page(1) : undefined;
									})()}
									busy={gridLoading.value}
								/>
								<SlotPicker
									grid={g}
									dayKey={selectedDay.value}
									selected={selectedSlot.value ? [selectedSlot.value] : []}
									onToggle={(id) => {
										selectedSlot.value = selectedSlot.value === id ? null : id;
									}}
									max={1}
									busy={gridLoading.value}
								/>
							</>
						)
						: <p class="pf-split__hint" role="status">Loading availability…</p>}
					{o?.format === "cohort" && o.capacity && (
						<label class="pf-split__seats">
							<span class="pf-split__label">Seats</span>
							<input
								class="pf-split__seatsinput"
								type="number"
								min={1}
								max={o.capacity.remaining}
								value={seats.value}
								onInput={(e) => {
									const raw = Number((e.target as HTMLInputElement).value);
									const cap = o.capacity?.remaining ?? 1;
									seats.value = Number.isFinite(raw) ? Math.min(cap, Math.max(1, raw)) : 1;
								}}
							/>
							<span class="pf-split__hint">{o.capacity.sentence}</span>
						</label>
					)}
				</section>
			)}

			<section class="pf-split__section" aria-labelledby="pf-svc-message-label">
				<div ref={firstFieldRef} tabIndex={-1} class="pf-split__field">
					<label class="pf-split__label" id="pf-svc-message-label" for="pf-svc-message">
						Message to {sellerName}
						<span class="pf-split__optional">Optional</span>
					</label>
					<Textarea
						id="pf-svc-message"
						fluid
						autoResize
						rows={3}
						maxRows={8}
						maxLength={8000}
						placeholder={scheduled
							? `Anything ${sellerName} should know before the session…`
							: `What do you need, and by when?`}
						value={message}
						disabled={loading.value}
					/>
				</div>
			</section>

			{intake.length > 0 && (
				<section class="pf-split__section" aria-labelledby="pf-svc-intake">
					<h3 class="pf-split__label" id="pf-svc-intake">
						{sellerName} asks
					</h3>
					<IntakeFields
						fields={intake}
						answers={answers}
						refusal={attempted.value ? intakeBlock.value : null}
						disabled={loading.value || sending.value}
						idPrefix="pf-svc"
					/>
				</section>
			)}

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
			{primary?.disabled && primary.disabledReason && (
				<p class="pf-split__hint">{primary.disabledReason}</p>
			)}
			{o && !o.requiresSignIn && o.escrows && (
				<p class="pf-split__disclosure">
					<Icon name="shield" size="xs" aria-hidden />
					<span>Funds are held in escrow until the session is delivered.</span>
				</p>
			)}
		</div>
	);

	const right = v
		? <EntityPreview view={v} />
		: loading.value
		? <p class="pf-split__hint" role="status">Loading the listing…</p>
		: null;

	const notice = loadError.value
		? (
			<div class="pf-split__failed" role="alert">
				<Message severity="danger" variant="subtle" size="sm">{loadError.value}</Message>
				<Button
					variant="outlined"
					severity="secondary"
					size="sm"
					label="Try again"
					onClick={() => picked && void load(picked.id)}
				/>
			</div>
		)
		: !authed
		? (
			<p class="pf-split__hint">
				Sign in to {scheduled ? "book" : "buy"} — the details are yours to read first.
			</p>
		)
		: null;

	return (
		<SplitModal
			open={open}
			title={picked?.title ?? "Service"}
			subtitle={o ? FORMAT_LABEL[o.format] : undefined}
			left={left}
			right={right}
			summary={summary}
			actions={actions}
			notice={notice}
			loading={loading.value}
			initialFocusRef={firstFieldRef}
			bodyRef={bodyRef}
			onClose={close}
			class="pf-split--service"
		/>
	);
}

// #region Nonce
/**
 * A per-page-load nonce for the pipeline instantiation's idempotency key — the same shape the
 * `/view` page's rig uses, so a double-press resolves to the SAME draft rather than two.
 */
let nonce: string | null = null;
function loadNonce(): string {
	if (nonce) return nonce;
	try {
		nonce = crypto.randomUUID();
	} catch {
		nonce = `${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`;
	}
	return nonce;
}
// #endregion
