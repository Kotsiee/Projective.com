import type { JSX } from "preact";
import { type Signal, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { RatingStars } from "@projective/ui/display";
import { MoneyView } from "@projective/ui/display/money";
import { Button, DatePicker, type DateValue, FormControl, Textarea } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import type { EntityView } from "@projective/types/explore";
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
import { offerSummaryFor } from "@features/view/core/offer-summary.ts";
import {
	earliestTargetDate,
	TARGET_DATE_HINT,
	targetDateOf,
} from "@features/view/core/target-date.ts";
import { EntityPreview } from "@features/view/components/EntityPreview.tsx";
import {
	SessionBookingDialog,
	type SessionDialogFlow,
} from "@features/view/components/SessionBookingDialog.tsx";
import { currentPath, requestSignIn } from "@features/auth/core/sign-in-prompt.ts";
import type { ServiceItem } from "../../types/profile-types.ts";
import { focusFirstRefused, IntakeFields } from "./IntakeFields.tsx";
import { SplitModal } from "./SplitModal.tsx";

/**
 * ServiceDetailModal — what a listing opens from the Hire popover.
 *
 * # A session is booked in the listing page's own dialog
 *
 * A Session or Group Session listing opens `/view`'s {@link SessionBookingDialog}, not a second
 * picker (Decision #453): a block schedules session 1 and any of its later sittings, a cohort lists
 * its fixed sittings, takes seats and asks the seller's intake, and both continue to checkout exactly
 * as they do on the listing page. The dialog opens on the pick, in its loading state, so nothing is
 * swapped in once the listing is read.
 *
 * # Everything else is the split modal
 *
 * LEFT, the buyer's inputs: an optional message, then the seller's intake fields. RIGHT, the listing in
 * the `/view` page's vocabulary ({@link EntityPreview}, fed the same projection the page SSRs). FOOTER:
 * the starting price, the rating and the turnaround on the leading side, and the primary on the
 * trailing side.
 *
 * # The primary is the offer's, not the modal's
 *
 * What the button says and does is `offer.cta.primary` — the SAME server-resolved rig the `/view`
 * page's lane and buy bar render (§D.7.4 applied to the data): a scoped engagement stages a brief and
 * continues to checkout; a pipeline is added to the buyer's projects as a draft (and a draft that
 * already exists opens instead). The modal dispatches on `kind`, never on the format, so a format that
 * reuses an existing flow needs no change here.
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
 * Both dialogs open for a signed-out visitor — the preview is public information — and the primary
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

/** Whether a picked listing is booked from a schedule, known before the listing is read. */
function isSessionListing(service: ServiceItem): boolean {
	return service.serviceType === "Session" || service.serviceType === "Group Session";
}

export default function ServiceDetailModal(
	{ service, handle, sellerName, authed, onNotice }: ServiceDetailModalProps,
): JSX.Element {
	const view = useSignal<EntityView | null>(null);
	const offer = useSignal<ServiceBookingOffer | null>(null);
	const loadError = useSignal<string | null>(null);
	const loading = useSignal(false);

	const message = useSignal("");
	const target = useSignal<DateValue>(null);
	const answers = useSignal<IntakeAnswers>({});
	const intakeBlock = useSignal<IntakeRefusal | null>(null);
	const attempted = useSignal(false);

	const sending = useSignal(false);
	const error = useSignal<string | null>(null);
	const firstFieldRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	/** Counts refused attempts; the focus move is keyed on it so it runs AFTER the marks render. */
	const refusedAttempts = useSignal(0);

	/** The session dialog's flow: open for a session listing, or for any listing that reads as one. */
	const sessionFlow = useComputed<SessionDialogFlow | null>(() => {
		const picked = service.value;
		if (!picked) return null;
		if (isSessionListing(picked)) return "booking";
		const o = offer.value;
		return o && isScheduledFormat(o.format) ? "booking" : null;
	});
	const open = useComputed(() => !!service.value && sessionFlow.value === null);

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
	}

	// Opening: a picked listing fetches it; clearing it closes whichever dialog it opened.
	useEffect(() => {
		if (!picked) return;
		message.value = "";
		target.value = null;
		answers.value = {};
		intakeBlock.value = null;
		attempted.value = false;
		error.value = null;
		sending.value = false;
		void load(picked.id);
	}, [picked?.id]);

	function close(): void {
		service.value = null;
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

	function promptSignIn(): void {
		requestSignIn({ intent: "hire", returnTo: currentPath(), subject: sellerName });
	}

	async function submit(): Promise<void> {
		const o = offer.value;
		const v = view.value;
		if (!o || !v || !picked || sending.value) return;
		if (o.requiresSignIn) {
			promptSignIn();
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
						targetDate: targetDateOf(target.value),
					});
					if (!res.ok || !res.data) {
						error.value = res.message ?? "Could not stage that. Please try again.";
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
						// Kept on the draft's request record (Decision #209) — the brief the seller reads.
						answers: answers.value,
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
	const primary = o?.cta.primary ?? null;
	const primaryHref = primary?.href ?? null;
	const primaryLabel = primary
		? primary.kind === "open_scope" ? "Proceed to checkout" : primary.label
		: "Proceed to checkout";
	const price = picked ? serviceStartingPrice(picked) : null;
	const rating = picked?.rating?.asHelper ?? picked?.rating?.asClient ?? null;
	const intake = v?.service?.intake ?? [];
	const disabled = !o || loading.value || sending.value || !!primary?.disabled;

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
				Sign in to {sessionFlow.value ? "book" : "buy"} — the details are yours to read first.
			</p>
		)
		: null;

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
						placeholder="What do you need, and by when?"
						value={message}
						disabled={loading.value}
					/>
				</div>
			</section>

			{primary?.kind === "open_scope" && (
				<section class="pf-split__section">
					<FormControl label="Target date (optional)" hint={TARGET_DATE_HINT}>
						{(a) => (
							<DatePicker
								id={a.id}
								aria-describedby={a.describedBy}
								value={target}
								selectionMode="single"
								minDate={earliestTargetDate()}
								dateFormat="dd M yy"
								placeholder="No target date"
								showIcon
								showButtonBar
								fluid
								disabled={loading.value || sending.value}
							/>
						)}
					</FormControl>
				</section>
			)}

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
		</div>
	);

	const right = v
		? <EntityPreview view={v} />
		: loading.value
		? <p class="pf-split__hint" role="status">Loading the listing…</p>
		: null;

	return (
		<>
			<SplitModal
				open={open}
				title={picked?.title ?? "Service"}
				subtitle={o ? FORMAT_LABEL[o.format] : undefined}
				left={left}
				right={right}
				summary={summary}
				actions={actions}
				notice={open.value ? notice : null}
				loading={loading.value}
				initialFocusRef={firstFieldRef}
				bodyRef={bodyRef}
				onClose={close}
				class="pf-split--service"
			/>
			<SessionBookingDialog
				offer={offer}
				flow={sessionFlow}
				intake={v?.service?.intake}
				sessionPlan={v?.service?.sessionPlan}
				summary={v ? offerSummaryFor(v) : null}
				pendingTitle={picked?.title}
				reading={loadError.value === null}
				notice={sessionFlow.value ? notice : null}
				onClose={close}
				onAnnounce={onNotice}
				onSignIn={promptSignIn}
			/>
		</>
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
