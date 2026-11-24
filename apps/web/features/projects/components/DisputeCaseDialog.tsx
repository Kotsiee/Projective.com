import type { JSX } from "preact";
import { type Signal, untracked, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/session-disputes.css";
import { Dialog, Message } from "@projective/ui/feedback";
import {
	Button,
	FileUpload,
	InputText,
	Slider,
	Textarea,
	type UploadControls,
	type UploadFile,
} from "@projective/ui/fields";
import { MetaLine, MoneyView, Tag } from "@projective/ui/display";
import {
	type DisputeCase,
	disputeOfferSplit,
	type DisputeParty,
	type DisputeSummary,
	disputeSummaryHref,
	disputeVaultFacts,
	ticketDisputeSideLabel,
	ticketDisputeSideOf,
	type TicketDisputeWindow,
} from "@projective/types/finance";
import { mediaProxyHref } from "@projective/types/files";
import { termsReference } from "@projective/types/services";
import type { SessionWorkspace } from "@projective/types/projects";
import { DisputeService } from "../core/DisputeService.ts";
import { uploadForProject } from "../core/upload.ts";
import { AccountService } from "@web/features/shell/core/AccountService.ts";
import {
	DEV_DISPUTE_ID,
	devDisputeCase,
	disputeSentence,
	disputeStatusLabel,
	disputeStatusSeverity,
	disputeTimeLabel,
	ticketDisputeSentence,
} from "../core/dispute-view.ts";
import { DisputeRoomLog } from "./DisputeRoomLog.tsx";

/**
 * DisputeCaseDialog — a dispute's status panel and Evidence Vault (Decisions #212, #548; DESIGN_SYSTEM
 * §C.1): a session's no-show claim, or a ticket's dispute on its stage money (PROJECTS EX2), whose sides
 * are "The client" and "The freelancer". Opening it reads the case as the viewer may see it
 * (`GET /api/finance/disputes/:id`): its status and what happens next, the money at stake, the
 * attendance audit, the ruling, and every statement with its evidence files (served by the files
 * pipeline, which admits a dispute's parties).
 *
 * A party with the case still live files a statement with evidence (uploaded to their own library
 * through the files pipeline, then filed by id); the respondent's statement on an awaiting-response
 * case sends it to an auditor, and either party can escalate early. On a ticket case either side offers
 * the freelancer's share — the share control shows what each side would get — and the other side
 * accepts the standing offer, which settles it. Opened with `raise` and no case, it is the form that
 * raises one, and the same dialog then reads the new case (one dialog, never two). The island decides
 * nothing — the database refuses whatever it would not allow, and the refusal is shown beside the
 * control.
 */
export interface DisputeCaseDialogProps {
	/** Visibility, owned by the caller (the overlay contract is signal-first). */
	open: Signal<boolean>;
	/** A session's claim to open; null renders nothing to read. */
	summary?: DisputeSummary | null;
	/** A case to open by id (a ticket's); wins over {@link summary}. */
	disputeId?: string | null;
	/** With no case named: raise one on this ticket's stage money. */
	raise?: TicketDisputeRaise | null;
	/** The workspace a session claim sits on (the dev preview builds its case from it). */
	workspace?: SessionWorkspace;
	/** The case moved (raised, a statement filed, an offer, an escalation): the caller re-reads. */
	onChanged: (message: string | null) => void;
}

/** What raising a ticket dispute needs: the ticket, the stage whose money it contests, and where that money stands. */
export interface TicketDisputeRaise {
	ticketId: string;
	stageId: string;
	ticketTitle: string;
	window: TicketDisputeWindow | null;
}

const PARTY_NAMES: Record<DisputeParty, string> = {
	claimant: "The attendee",
	respondent: "The provider",
	operator: "Projective",
};

/** A party's name on this case: a ticket case names the client and the freelancer. */
function partyName(d: DisputeCase, party: DisputeParty): string {
	if (d.kind !== "ticket" || !d.ticket || party === "operator") return PARTY_NAMES[party];
	return ticketDisputeSideLabel(ticketDisputeSideOf(party, d.ticket.claimantSide));
}

/** A share in basis points as the percentage a reader says. */
function sharePct(bp: number): string {
	return `${Math.round(bp) / 100} %`;
}

export function DisputeCaseDialog(props: DisputeCaseDialogProps): JSX.Element {
	const { open, onChanged } = props;
	const dispute = useSignal<DisputeCase | null>(null);
	const raisedId = useSignal<string | null>(null);
	const reason = useSignal("");
	const sharePercent = useSignal(50);
	const offerNote = useSignal("");
	const loading = useSignal(false);
	const loadError = useSignal<string | null>(null);
	const statement = useSignal("");
	const fileIds = useSignal<Record<string, string>>({});
	const uploading = useSignal(0);
	const busy = useSignal(false);
	const submitError = useSignal<string | null>(null);
	const uploadKey = useSignal(0);
	const target = useRef({
		summary: props.summary ?? null,
		workspace: props.workspace,
		id: props.disputeId ?? null,
	});
	target.current = {
		summary: props.summary ?? null,
		workspace: props.workspace,
		id: props.disputeId ?? null,
	};
	const request = useRef(0);
	const closeRef = useRef<HTMLDivElement>(null);

	async function load(): Promise<void> {
		const { summary, workspace } = target.current;
		const id = target.current.id ?? raisedId.peek() ?? summary?.id ?? null;
		const my = ++request.current;
		dispute.value = null;
		loadError.value = null;
		submitError.value = null;
		if (!id) return;
		if (summary && id === DEV_DISPUTE_ID && workspace) {
			dispute.value = devDisputeCase(summary, workspace, Date.now());
			return;
		}
		loading.value = true;
		const res = await DisputeService.get(id);
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
			// Untracked: `++` reads as well as writes, and a tracked read would re-run this for ever.
			untracked(() => {
				statement.value = "";
				reason.value = "";
				offerNote.value = "";
				sharePercent.value = 50;
				raisedId.value = null;
				fileIds.value = {};
				uploadKey.value++;
				void load();
			});
		} else request.current++;
	});

	async function upload(file: UploadFile, controls: UploadControls): Promise<void> {
		uploading.value++;
		controls.setStatus("uploading");
		try {
			const owner = (await AccountService.current())?.userId;
			if (!owner) {
				controls.setStatus("error", "Sign in again to attach evidence.");
				return;
			}
			const out = await uploadForProject([file.file], { ownerType: "user", ownerId: owner });
			const id = out.assetIds[0];
			if (!id) {
				controls.setStatus("error", out.failures[0]?.message ?? "The file couldn't be uploaded.");
				return;
			}
			fileIds.value = { ...fileIds.value, [file.id]: id };
			controls.setProgress(100);
			controls.setStatus("complete");
		} finally {
			uploading.value--;
		}
	}

	function removeFile(file: UploadFile): void {
		const next = { ...fileIds.value };
		delete next[file.id];
		fileIds.value = next;
	}

	async function submit(): Promise<void> {
		const current = dispute.value;
		const text = statement.value.trim();
		if (!current || !text || busy.value || uploading.value > 0) return;
		busy.value = true;
		submitError.value = null;
		const res = await DisputeService.respond(current.id, {
			statement: text,
			fileIds: Object.values(fileIds.value),
		});
		busy.value = false;
		if (!res.ok) {
			submitError.value = res.message ?? "Your statement couldn't be filed — please try again.";
			return;
		}
		statement.value = "";
		fileIds.value = {};
		uploadKey.value++;
		onChanged(res.message ?? null);
		void load();
	}

	async function raise(): Promise<void> {
		const r = props.raise;
		const text = statement.value.trim();
		if (!r || !text || reason.value.trim().length < 3 || busy.value || uploading.value > 0) return;
		busy.value = true;
		submitError.value = null;
		const res = await DisputeService.open({
			ticketId: r.ticketId,
			stageId: r.stageId,
			reason: reason.value.trim(),
			statement: text,
			fileIds: Object.values(fileIds.value),
		});
		busy.value = false;
		if (!res.ok || !res.data) {
			submitError.value = res.message ?? "The dispute couldn't be raised — please try again.";
			return;
		}
		raisedId.value = res.data.disputeId;
		statement.value = "";
		fileIds.value = {};
		uploadKey.value++;
		onChanged(res.message ?? null);
		void load();
	}

	async function offer(): Promise<void> {
		const current = dispute.value;
		if (!current || busy.value) return;
		busy.value = true;
		submitError.value = null;
		const res = await DisputeService.offer(current.id, {
			payeeShareBp: Math.round(sharePercent.value * 100),
			note: offerNote.value.trim() || undefined,
		});
		busy.value = false;
		if (!res.ok) {
			submitError.value = res.message ?? "The offer couldn't be sent — please try again.";
			return;
		}
		offerNote.value = "";
		onChanged(res.message ?? null);
		void load();
	}

	async function accept(offerId: string): Promise<void> {
		const current = dispute.value;
		if (!current || busy.value) return;
		busy.value = true;
		submitError.value = null;
		const res = await DisputeService.accept(current.id, offerId);
		busy.value = false;
		if (!res.ok) {
			submitError.value = res.message ?? "The offer couldn't be accepted — please try again.";
			return;
		}
		onChanged(res.message ?? null);
		void load();
	}

	async function escalate(): Promise<void> {
		const current = dispute.value;
		if (!current || busy.value) return;
		busy.value = true;
		submitError.value = null;
		const res = await DisputeService.escalate(current.id);
		busy.value = false;
		if (!res.ok) {
			submitError.value = res.message ?? "The case couldn't be escalated — please try again.";
			return;
		}
		onChanged(res.message ?? null);
		void load();
	}

	const d = dispute.value;
	const awaitingMine = d?.status === "awaiting_response" && d.role === "respondent";
	const audit = d?.audit;
	const raising = !d && !target.current.id && !raisedId.value && !!props.raise;
	const ticketCase = d?.kind === "ticket" || !!props.disputeId || !!props.raise;
	const preview = d?.ticket
		? disputeOfferSplit(
			d.ticket.escrowAmounts,
			Math.round(sharePercent.value * 100),
			d.ticket.feeBp,
		)
		: null;

	return (
		<Dialog
			visible={open}
			header={raising ? "Raise a dispute" : ticketCase ? "Ticket dispute" : "No-show claim"}
			class="dispute-dlg"
			width="36rem"
			initialFocusRef={closeRef}
			footer={
				<div ref={closeRef} class="dispute-dlg__actions">
					{d?.canEscalate
						? (
							<Button
								label="Send to an auditor now"
								severity="secondary"
								variant="outlined"
								disabled={busy.value}
								onClick={() => void escalate()}
							/>
						)
						: null}
					<Button
						label="Close"
						severity="secondary"
						variant="text"
						onClick={() => (open.value = false)}
					/>
				</div>
			}
		>
			<div class="dispute-dlg__body">
				{loading.value ? <p class="dispute-dlg__meta" role="status">Reading the case…</p> : null}

				{raising && props.raise
					? (
						<section class="dispute-dlg__section" aria-label="Raise a dispute">
							<p class="dispute-dlg__lede">
								{props.raise.window === "pending"
									? `"${props.raise.ticketTitle}" was approved and its payment is still clearing. Raising a dispute freezes those earnings until it settles.`
									: `"${props.raise.ticketTitle}" is in review. Raising a dispute keeps its payment held until it settles.`}
							</p>
							<p class="dispute-dlg__meta">
								The other side has 48 hours to respond. Either of you can offer a split at any
								point, and the other accepting it settles the case; otherwise a Projective auditor
								rules.
							</p>
							<InputText
								value={reason}
								maxLength={200}
								fluid
								aria-label="What is disputed"
								placeholder="What is disputed, in a line"
							/>
							<Textarea
								value={statement}
								rows={3}
								autoResize
								maxRows={8}
								maxLength={4000}
								fluid
								aria-label="Your account"
								placeholder="What happened, from your side."
							/>
							<FileUpload
								key={uploadKey.value}
								mode="advanced"
								size="sm"
								multiple
								auto
								maxFileSize={25 * 1024 * 1024}
								customUpload={upload}
								onRemove={removeFile}
								disabled={busy.value}
								headerTemplate={(ctx) => (
									<Button
										label="Attach evidence"
										severity="secondary"
										variant="outlined"
										size="sm"
										disabled={busy.value}
										onClick={ctx.choose}
									/>
								)}
							/>
							<div class="dispute-dlg__actions">
								<Button
									label="Raise dispute"
									loading={busy.value}
									disabled={reason.value.trim().length < 3 || !statement.value.trim() ||
										uploading.value > 0}
									onClick={() => void raise()}
								/>
							</div>
						</section>
					)
					: null}

				{loadError.value
					? (
						<div class="dispute-dlg__status">
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

				{d
					? (
						<>
							<div class="dispute-dlg__status" aria-live="polite">
								<Tag
									value={disputeStatusLabel(d.status)}
									severity={disputeStatusSeverity(d.status)}
									variant="subtle"
									rounded
								/>
								<p class="dispute-dlg__lede">
									{d.kind === "ticket" ? ticketDisputeSentence(d) : disputeSentence(d, d.role)}
								</p>
							</div>

							<dl class="dispute-dlg__facts">
								{d.sitting
									? (
										<div class="dispute-dlg__fact">
											<dt class="dispute-dlg__term">Session</dt>
											<dd class="dispute-dlg__value">
												{d.sitting.title} · {disputeTimeLabel(d.sitting.startsAt)}
											</dd>
										</div>
									)
									: null}
								{d.ticket
									? (
										<div class="dispute-dlg__fact">
											<dt class="dispute-dlg__term">Ticket</dt>
											<dd class="dispute-dlg__value">
												{d.ticket.title}
												{d.ticket.stageName ? ` · ${d.ticket.stageName}` : ""}
											</dd>
										</div>
									)
									: null}
								<div class="dispute-dlg__fact">
									<dt class="dispute-dlg__term">
										{d.ticket?.window === "pending"
											? "Clearing earnings at stake"
											: "Payment at stake"}
									</dt>
									<dd class="dispute-dlg__value">
										<MoneyView minor={d.amountMinor} currency={d.currency} />
									</dd>
								</div>
								{d.respondBy && d.status === "awaiting_response"
									? (
										<div class="dispute-dlg__fact">
											<dt class="dispute-dlg__term">Response due</dt>
											<dd class="dispute-dlg__value">{disputeTimeLabel(d.respondBy)}</dd>
										</div>
									)
									: null}
								{d.settlement && !d.settlement.byFact && !d.settlement.deferred
									? (
										<>
											<div class="dispute-dlg__fact">
												<dt class="dispute-dlg__term">
													{d.kind === "ticket" ? "Paid to the freelancer" : "Paid to the provider"}
												</dt>
												<dd class="dispute-dlg__value">
													<MoneyView minor={d.settlement.payeeMinor} currency={d.currency} />
												</dd>
											</div>
											<div class="dispute-dlg__fact">
												<dt class="dispute-dlg__term">
													{d.kind === "ticket" ? "Back to the client" : "Refunded to the attendee"}
												</dt>
												<dd class="dispute-dlg__value">
													<MoneyView minor={d.settlement.refundMinor} currency={d.currency} />
												</dd>
											</div>
										</>
									)
									: null}
							</dl>

							{audit ? <DisputeRoomLog audit={audit} /> : null}

							{d.agreedTerms
								? (
									<section class="dispute-dlg__section" aria-label="Agreed terms">
										<h3 class="dispute-dlg__heading">Agreed terms</h3>
										<p class="dispute-dlg__meta">
											{d.agreedTerms.priceLabel} · delivered in {d.agreedTerms.turnaroundDays}{" "}
											{d.agreedTerms.turnaroundDays === 1 ? "day" : "days"}
											{d.agreedTerms.acceptedAt
												? ` · accepted ${disputeTimeLabel(d.agreedTerms.acceptedAt)}`
												: ""}
										</p>
										<p class="dispute-dlg__text">{d.agreedTerms.scope}</p>
										{d.agreedTerms.deliverables.length > 0
											? (
												<ul class="dispute-dlg__terms">
													{d.agreedTerms.deliverables.map((item, i) => <li key={i}>{item}</li>)}
												</ul>
											)
											: null}
										<p class="dispute-dlg__meta" title={d.agreedTerms.termsHash}>
											{d.agreedTerms.intact
												? `Terms ref ${
													termsReference(d.agreedTerms.termsHash)
												}, unchanged since they were agreed.`
												: "The stored terms no longer match the reference both parties agreed. An auditor will review the record."}
										</p>
									</section>
								)
								: null}

							{d.vault
								? (
									<section class="dispute-dlg__section" aria-label="Evidence Vault">
										<h3 class="dispute-dlg__heading">Evidence Vault</h3>
										<MetaLine
											size="xs"
											items={[
												disputeVaultFacts(d.vault).state,
												`frozen ${disputeTimeLabel(d.vault.createdAt)}`,
												{
													text: disputeVaultFacts(d.vault).reference,
													title: d.vault.sha256,
													tabular: true,
												},
											]}
										/>
										<a class="dispute-dlg__file" href={disputeSummaryHref(d.id)} download>
											Download the case summary (PDF)
										</a>
									</section>
								)
								: null}

							{d.resolutionNotes
								? (
									<section class="dispute-dlg__section" aria-label="Ruling">
										<h3 class="dispute-dlg__heading">
											{d.resolvedByOperator ? "The auditor's ruling" : "Outcome"}
										</h3>
										<p class="dispute-dlg__text">{d.resolutionNotes}</p>
										{d.settlement?.deferred
											? (
												<p class="dispute-dlg__meta">
													The payment is released after the last session, as usual.
												</p>
											)
											: null}
									</section>
								)
								: null}

							<section class="dispute-dlg__section" aria-label="Statements and evidence">
								<h3 class="dispute-dlg__heading">Statements &amp; evidence</h3>
								<p class="dispute-dlg__text">
									<span class="dispute-dlg__who">{partyName(d, "claimant")}:</span> {d.reason}
								</p>
								{d.messages.length
									? (
										<ul class="dispute-dlg__thread">
											{d.messages.map((m) => (
												<li key={m.id} class="dispute-dlg__msg">
													<span class="dispute-dlg__who">
														{m.mine ? "You" : partyName(d, m.party)} ·{" "}
														{disputeTimeLabel(m.createdAt)}
													</span>
													<p class="dispute-dlg__text">{m.body}</p>
													{m.files.length
														? (
															<ul class="dispute-dlg__files">
																{m.files.map((f) => (
																	<li key={f.id}>
																		<a
																			class="dispute-dlg__file"
																			href={mediaProxyHref(f.id)}
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
									: <p class="dispute-dlg__meta">No statements yet.</p>}
							</section>

							{d.kind === "ticket" && ((d.offers?.length ?? 0) > 0 || d.canOffer)
								? (
									<section class="dispute-dlg__section" aria-label="Offers">
										<h3 class="dispute-dlg__heading">Offers</h3>
										{(d.offers ?? []).length
											? (
												<ul class="dispute-dlg__thread">
													{(d.offers ?? []).map((o) => (
														<li key={o.id} class="dispute-dlg__msg">
															<span class="dispute-dlg__who">
																{o.mine ? "You" : partyName(d, o.party)} offered{" "}
																{sharePct(o.payeeShareBp)} to the freelancer ·{" "}
																{disputeTimeLabel(o.createdAt)}
																{o.acceptedAt
																	? ` · accepted ${disputeTimeLabel(o.acceptedAt)}`
																	: ""}
																{!o.acceptedAt && !o.standing ? " · replaced" : ""}
															</span>
															<p class="dispute-dlg__meta dispute-dlg__split">
																The freelancer{" "}
																<MoneyView minor={o.payeeMinor} currency={d.currency} />{" "}
																· the client{" "}
																<MoneyView minor={o.refundMinor} currency={d.currency} />
															</p>
															{o.note ? <p class="dispute-dlg__text">{o.note}</p> : null}
															{o.canAccept
																? (
																	<div class="dispute-dlg__actions">
																		<Button
																			label="Accept and settle"
																			loading={busy.value}
																			onClick={() => void accept(o.id)}
																		/>
																	</div>
																)
																: null}
														</li>
													))}
												</ul>
											)
											: <p class="dispute-dlg__meta">No offers yet.</p>}
										{d.canOffer && preview
											? (
												<div class="dispute-dlg__offer">
													<Slider
														value={sharePercent}
														min={0}
														max={100}
														step={5}
														formatValue={(v) => `${v} % to the freelancer`}
														aria-label="The freelancer's share"
													/>
													<p class="dispute-dlg__meta dispute-dlg__split">
														{sharePercent.value} % · the freelancer{" "}
														<MoneyView minor={preview.payeeMinor} currency={d.currency} />{" "}
														· the client{" "}
														<MoneyView minor={preview.refundMinor} currency={d.currency} />
													</p>
													<Textarea
														value={offerNote}
														rows={2}
														autoResize
														maxRows={5}
														maxLength={1000}
														fluid
														aria-label="A note with your offer"
														placeholder="Why this split (optional)."
													/>
													<div class="dispute-dlg__actions">
														<Button
															label="Send offer"
															severity="secondary"
															variant="outlined"
															disabled={busy.value}
															onClick={() => void offer()}
														/>
													</div>
												</div>
											)
											: null}
									</section>
								)
								: null}

							{d.canRespond
								? (
									<section class="dispute-dlg__section" aria-label="Add a statement">
										<h3 class="dispute-dlg__heading">
											{awaitingMine ? "Your response" : "Add to the case"}
										</h3>
										<Textarea
											value={statement}
											rows={3}
											autoResize
											maxRows={8}
											maxLength={4000}
											fluid
											aria-label="Your statement"
											placeholder={awaitingMine
												? d.kind === "ticket"
													? "What happened, from your side."
													: "What happened at the session, from your side."
												: "Anything the reviewer should know."}
										/>
										<FileUpload
											key={uploadKey.value}
											mode="advanced"
											size="sm"
											multiple
											auto
											maxFileSize={25 * 1024 * 1024}
											customUpload={upload}
											onRemove={removeFile}
											disabled={busy.value}
											headerTemplate={(ctx) => (
												<Button
													label="Attach evidence"
													severity="secondary"
													variant="outlined"
													size="sm"
													disabled={busy.value}
													onClick={ctx.choose}
												/>
											)}
										/>
										<p class="dispute-dlg__meta">
											Statements and evidence can't be edited or removed once filed.
										</p>
										<div class="dispute-dlg__actions">
											<Button
												label={awaitingMine ? "Send response" : "File statement"}
												loading={busy.value}
												disabled={!statement.value.trim() || uploading.value > 0}
												onClick={() => void submit()}
											/>
										</div>
									</section>
								)
								: null}
						</>
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
			</div>
		</Dialog>
	);
}
