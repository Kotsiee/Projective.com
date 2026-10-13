import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/session-disputes.css";
import { Dialog, Message } from "@projective/ui/feedback";
import {
	Button,
	FileUpload,
	Textarea,
	type UploadControls,
	type UploadFile,
} from "@projective/ui/fields";
import { Tag } from "@projective/ui/display";
import type { DisputeCase, DisputeParty, DisputeSummary } from "@projective/types/finance";
import { fileObjectHref } from "@projective/types/files";
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
} from "../core/dispute-view.ts";

/**
 * DisputeCaseDialog — a no-show claim's status panel and Evidence Vault (Decision #212; DESIGN_SYSTEM
 * §C.1). Opening it reads the case as the viewer may see it (`GET /api/finance/disputes/:id`): its
 * status and what happens next, the money at stake, the attendance audit, the ruling, and every
 * statement with its evidence files (served by the files pipeline, which admits a dispute's parties).
 *
 * A party with the case still live files a statement with evidence (uploaded to their own library
 * through the files pipeline, then filed by id); the respondent's statement on an awaiting-response
 * case sends it to an auditor, and either party can escalate early. The island decides nothing — the
 * database refuses whatever it would not allow, and the refusal is shown beside the control.
 */
export interface DisputeCaseDialogProps {
	/** Visibility, owned by the caller (the overlay contract is signal-first). */
	open: Signal<boolean>;
	/** The claim to open; null renders nothing to read. */
	summary: DisputeSummary | null;
	/** The workspace the claim sits on (the dev preview builds its case from it). */
	workspace: SessionWorkspace;
	/** The case moved (a statement filed, an escalation): the caller re-reads its list. */
	onChanged: (message: string | null) => void;
}

const PARTY_NAMES: Record<DisputeParty, string> = {
	claimant: "The attendee",
	respondent: "The provider",
	operator: "Projective",
};

export function DisputeCaseDialog(props: DisputeCaseDialogProps): JSX.Element {
	const { open, onChanged } = props;
	const dispute = useSignal<DisputeCase | null>(null);
	const loading = useSignal(false);
	const loadError = useSignal<string | null>(null);
	const statement = useSignal("");
	const fileIds = useSignal<Record<string, string>>({});
	const uploading = useSignal(0);
	const busy = useSignal(false);
	const submitError = useSignal<string | null>(null);
	const uploadKey = useSignal(0);
	const target = useRef({ summary: props.summary, workspace: props.workspace });
	target.current = { summary: props.summary, workspace: props.workspace };
	const request = useRef(0);
	const closeRef = useRef<HTMLDivElement>(null);

	async function load(): Promise<void> {
		const { summary, workspace } = target.current;
		const my = ++request.current;
		dispute.value = null;
		loadError.value = null;
		submitError.value = null;
		if (!summary) return;
		if (summary.id === DEV_DISPUTE_ID) {
			dispute.value = devDisputeCase(summary, workspace, Date.now());
			return;
		}
		loading.value = true;
		const res = await DisputeService.get(summary.id);
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
			statement.value = "";
			fileIds.value = {};
			uploadKey.value++;
			void load();
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

	return (
		<Dialog
			visible={open}
			header="No-show claim"
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
								<p class="dispute-dlg__lede">{disputeSentence(d, d.role)}</p>
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
								<div class="dispute-dlg__fact">
									<dt class="dispute-dlg__term">Payment at stake</dt>
									<dd class="dispute-dlg__value">{d.amountLabel}</dd>
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
												<dt class="dispute-dlg__term">Paid to the provider</dt>
												<dd class="dispute-dlg__value">{d.settlement.payeeLabel}</dd>
											</div>
											<div class="dispute-dlg__fact">
												<dt class="dispute-dlg__term">Refunded to the attendee</dt>
												<dd class="dispute-dlg__value">{d.settlement.refundLabel}</dd>
											</div>
										</>
									)
									: null}
							</dl>

							{audit
								? (
									<p class="dispute-dlg__meta">
										{audit.tracked
											? `Room logs: provider present ${audit.hostPresencePct}%, attendee ${audit.claimantPresencePct}% of the session (a claim is dismissed at ${audit.thresholdPct}% each).`
											: "The room reported no attendance, so the logs could not settle the claim."}
									</p>
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
									<span class="dispute-dlg__who">{PARTY_NAMES.claimant}:</span> {d.reason}
								</p>
								{d.messages.length
									? (
										<ul class="dispute-dlg__thread">
											{d.messages.map((m) => (
												<li key={m.id} class="dispute-dlg__msg">
													<span class="dispute-dlg__who">
														{m.mine ? "You" : PARTY_NAMES[m.party]} ·{" "}
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
									: <p class="dispute-dlg__meta">No statements yet.</p>}
							</section>

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
												? "What happened at the session, from your side."
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
