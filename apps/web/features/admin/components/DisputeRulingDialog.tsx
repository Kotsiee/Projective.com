import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/dispute-desk.css";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button, NumberInput, SelectButton, Textarea } from "@projective/ui/fields";
import { Tag } from "@projective/ui/display";
import type {
	DisputeCase,
	DisputeOutcome,
	DisputeParty,
	DisputeQueueItem,
} from "@projective/types/finance";
import { fileObjectHref } from "@projective/types/files";
import {
	disputeStatusLabel,
	disputeStatusSeverity,
	disputeTimeLabel,
} from "@features/projects/core/dispute-view.ts";
import { DisputeDeskService } from "../core/DisputeDeskService.ts";
import {
	caseTitle,
	confirmSentence,
	isPreviewCase,
	operatorSentence,
	OUTCOME_HINT,
	OUTCOME_LABEL,
	partyLabel,
	previewCase,
	rulingProblem,
	shareToBp,
} from "../core/dispute-desk.ts";

/**
 * DisputeRulingDialog — one dispute as a platform operator reads and rules on it (Decision #212;
 * DESIGN_SYSTEM §C.1). Opening it reads the case (`GET /api/finance/disputes/:id`, which admits an
 * operator through `security.is_admin()`): the status and deadline, the money at stake, the parties,
 * the attendance audit, and every statement with its evidence files. While the case is live
 * (`canResolve`) it carries the ruling form — release · refund · split with the provider's share — and
 * the reasons the parties will read, behind a confirm step, because a ruling moves the held payment and
 * is final (`POST …/resolve`). The island decides nothing: the database refuses whatever it would not
 * allow, and the refusal stays beside the confirm.
 */
export interface DisputeRulingDialogProps {
	/** Visibility, owned by the caller (the overlay contract is signal-first). */
	open: Signal<boolean>;
	/** The queue row the operator opened; null renders nothing to read. */
	item: DisputeQueueItem | null;
	/** A ruling was recorded: the caller closes the dialog, says so, and re-reads the queue. */
	onRuled: (message: string) => void;
}

const PARTY_NAMES: Record<DisputeParty, string> = {
	claimant: "The attendee",
	respondent: "The provider",
	operator: "Projective",
};

const OUTCOMES: ReadonlyArray<DisputeOutcome> = ["release", "refund", "split"];

export function DisputeRulingDialog(props: DisputeRulingDialogProps): JSX.Element {
	const { open, onRuled } = props;
	const dispute = useSignal<DisputeCase | null>(null);
	const loading = useSignal(false);
	const loadError = useSignal<string | null>(null);
	const outcome = useSignal<string>("");
	const share = useSignal<number | null>(50);
	const notes = useSignal("");
	const confirming = useSignal(false);
	const busy = useSignal(false);
	const submitError = useSignal<string | null>(null);
	const target = useRef(props.item);
	target.current = props.item;
	const request = useRef(0);
	const closeRef = useRef<HTMLDivElement>(null);

	async function load(): Promise<void> {
		const item = target.current;
		const my = ++request.current;
		dispute.value = null;
		loadError.value = null;
		if (!item) return;
		if (isPreviewCase(item.id)) {
			dispute.value = previewCase(item);
			return;
		}
		loading.value = true;
		const res = await DisputeDeskService.get(item.id);
		if (my !== request.current) return;
		loading.value = false;
		if (!res.ok || !res.data) {
			loadError.value = res.message ?? "This case couldn't be read — please try again.";
			return;
		}
		dispute.value = res.data.dispute;
	}

	useSignalEffect(() => {
		if (open.value) {
			outcome.value = "";
			share.value = 50;
			notes.value = "";
			confirming.value = false;
			submitError.value = null;
			void load();
		} else request.current++;
	});

	const chosen = (OUTCOMES as ReadonlyArray<string>).includes(outcome.value)
		? outcome.value as DisputeOutcome
		: null;
	const problem = rulingProblem(chosen, share.value, notes.value);

	async function rule(): Promise<void> {
		const d = dispute.value;
		if (!d || !chosen || problem || busy.value) return;
		busy.value = true;
		submitError.value = null;
		const res = await DisputeDeskService.resolve(d.id, {
			outcome: chosen,
			payeeShareBp: chosen === "split" ? shareToBp(share.value) : null,
			notes: notes.value.trim(),
		});
		busy.value = false;
		if (!res.ok) {
			submitError.value = res.errors
				? Object.values(res.errors)[0] ?? res.message ?? "The ruling couldn't be recorded."
				: res.message ?? "The ruling couldn't be recorded — please try again.";
			confirming.value = false;
			return;
		}
		onRuled(res.message ?? "Ruling recorded.");
	}

	const d = dispute.value;
	const item = props.item;
	const overdue = !!item?.overdue && d?.status === "under_review";

	return (
		<Dialog
			visible={open}
			header={item ? caseTitle(item) : "Dispute"}
			class="ddesk-dlg"
			width="40rem"
			initialFocusRef={closeRef}
			footer={
				<div ref={closeRef} class="ddesk-dlg__actions">
					<Button
						label="Close"
						severity="secondary"
						variant="text"
						onClick={() => (open.value = false)}
					/>
				</div>
			}
		>
			<div class="ddesk-dlg__body">
				{loading.value ? <p class="ddesk-dlg__meta" role="status">Reading the case…</p> : null}

				{loadError.value
					? (
						<div class="ddesk-dlg__status">
							<Message severity="danger" variant="subtle" size="sm">{loadError.value}</Message>
							<Button
								label="Try again"
								severity="secondary"
								variant="text"
								size="sm"
								onClick={() => void load()}
							/>
						</div>
					)
					: null}

				{d && item
					? (
						<>
							<div class="ddesk-dlg__status" aria-live="polite">
								<div class="ddesk-dlg__tags">
									<Tag
										value={disputeStatusLabel(d.status)}
										severity={disputeStatusSeverity(d.status)}
										variant="subtle"
										rounded
									/>
									{overdue
										? <Tag value="Overdue" severity="danger" variant="subtle" rounded />
										: null}
								</div>
								<p class="ddesk-dlg__lede">{operatorSentence(d, overdue)}</p>
							</div>

							<dl class="ddesk-dlg__facts">
								<div class="ddesk-dlg__fact">
									<dt class="ddesk-dlg__term">Attendee (claimant)</dt>
									<dd class="ddesk-dlg__value">{partyLabel(item.claimant, "Attendee")}</dd>
								</div>
								<div class="ddesk-dlg__fact">
									<dt class="ddesk-dlg__term">Provider (respondent)</dt>
									<dd class="ddesk-dlg__value">{partyLabel(item.respondent, "Provider")}</dd>
								</div>
								{d.sitting
									? (
										<div class="ddesk-dlg__fact">
											<dt class="ddesk-dlg__term">Session</dt>
											<dd class="ddesk-dlg__value">
												{d.sitting.title} · {disputeTimeLabel(d.sitting.startsAt)}
											</dd>
										</div>
									)
									: null}
								<div class="ddesk-dlg__fact">
									<dt class="ddesk-dlg__term">Payment held</dt>
									<dd class="ddesk-dlg__value">{d.amountLabel}</dd>
								</div>
								<div class="ddesk-dlg__fact">
									<dt class="ddesk-dlg__term">Raised</dt>
									<dd class="ddesk-dlg__value">{disputeTimeLabel(d.openedAt)}</dd>
								</div>
								{d.respondBy && d.status === "awaiting_response"
									? (
										<div class="ddesk-dlg__fact">
											<dt class="ddesk-dlg__term">Response due</dt>
											<dd class="ddesk-dlg__value">{disputeTimeLabel(d.respondBy)}</dd>
										</div>
									)
									: null}
								{d.escalatedAt
									? (
										<div class="ddesk-dlg__fact">
											<dt class="ddesk-dlg__term">Under review since</dt>
											<dd class="ddesk-dlg__value">{disputeTimeLabel(d.escalatedAt)}</dd>
										</div>
									)
									: null}
								{d.reviewBy && d.status === "under_review"
									? (
										<div class="ddesk-dlg__fact">
											<dt class="ddesk-dlg__term">Ruling due</dt>
											<dd class="ddesk-dlg__value">{disputeTimeLabel(d.reviewBy)}</dd>
										</div>
									)
									: null}
							</dl>

							{d.audit
								? (
									<p class="ddesk-dlg__meta">
										{d.audit.tracked
											? `Room logs: provider present ${d.audit.hostPresencePct}%, attendee ${d.audit.claimantPresencePct}% of the session (a claim is dismissed at ${d.audit.thresholdPct}% each).`
											: "The room reported no attendance, so the logs could not settle the claim."}
									</p>
								)
								: null}

							<section class="ddesk-dlg__section" aria-label="Statements and evidence">
								<h3 class="ddesk-dlg__heading">Statements &amp; evidence</h3>
								<p class="ddesk-dlg__text">
									<span class="ddesk-dlg__who">{PARTY_NAMES.claimant} · claim:</span> {d.reason}
								</p>
								{d.messages.length
									? (
										<ul class="ddesk-dlg__thread">
											{d.messages.map((m) => (
												<li key={m.id} class="ddesk-dlg__msg">
													<span class="ddesk-dlg__who">
														{PARTY_NAMES[m.party]} · {disputeTimeLabel(m.createdAt)}
													</span>
													<p class="ddesk-dlg__text">{m.body}</p>
													{m.files.length
														? (
															<ul class="ddesk-dlg__files">
																{m.files.map((f) => (
																	<li key={f.id}>
																		<a
																			class="ddesk-dlg__file"
																			href={fileObjectHref(f.id)}
																			target="_blank"
																			rel="noopener"
																		>
																			{f.name}
																		</a>
																	</li>
																))}
															</ul>
														)
														: null}
												</li>
											))}
										</ul>
									)
									: <p class="ddesk-dlg__meta">No statements yet.</p>}
							</section>

							{d.canResolve
								? (
									<section class="ddesk-dlg__section" aria-label="Ruling">
										<h3 class="ddesk-dlg__heading">Ruling</h3>
										<SelectButton
											aria-label="Ruling"
											options={OUTCOMES.map((o) => ({ label: OUTCOME_LABEL[o], value: o }))}
											value={outcome}
											disabled={busy.value}
										/>
										{chosen ? <p class="ddesk-dlg__meta">{OUTCOME_HINT[chosen]}</p> : null}
										{chosen === "split"
											? (
												<div class="ddesk-dlg__field">
													<label class="ddesk-dlg__label" for="ddesk-share">
														Provider's share
													</label>
													<NumberInput
														id="ddesk-share"
														value={share}
														min={0.01}
														max={99.99}
														step={5}
														maxFractionDigits={2}
														suffix="%"
														size="sm"
														locale="en-GB"
														disabled={busy.value}
													/>
												</div>
											)
											: null}
										<div class="ddesk-dlg__field">
											<label class="ddesk-dlg__label" for="ddesk-notes">
												Reasons — both parties read these
											</label>
											<Textarea
												id="ddesk-notes"
												value={notes}
												rows={3}
												autoResize
												maxRows={10}
												maxLength={2000}
												fluid
												disabled={busy.value}
												placeholder="What the evidence showed, and why this ruling."
											/>
										</div>

										{confirming.value && chosen
											? (
												<div class="ddesk-dlg__confirm" role="alert">
													<Message severity="warning" variant="subtle" size="sm">
														{confirmSentence(chosen, share.value, d.amountLabel)}
													</Message>
													<div class="ddesk-dlg__actions">
														<Button
															label="Back"
															severity="secondary"
															variant="text"
															disabled={busy.value}
															onClick={() => (confirming.value = false)}
														/>
														<Button
															label="Confirm ruling"
															severity="danger"
															loading={busy.value}
															disabled={!!problem}
															onClick={() => void rule()}
														/>
													</div>
												</div>
											)
											: (
												<div class="ddesk-dlg__actions">
													{problem
														? <p class="ddesk-dlg__meta" id="ddesk-problem">{problem}</p>
														: null}
													<Button
														label="Record ruling"
														disabled={!!problem}
														aria-describedby={problem ? "ddesk-problem" : undefined}
														onClick={() => {
															submitError.value = null;
															confirming.value = true;
														}}
													/>
												</div>
											)}
									</section>
								)
								: null}

							{submitError.value
								? (
									<Message
										severity="danger"
										variant="subtle"
										size="sm"
										closable
										onClose={() => (submitError.value = null)}
									>
										{submitError.value}
									</Message>
								)
								: null}
						</>
					)
					: null}
			</div>
		</Dialog>
	);
}
