import type { JSX } from "preact";
import { type Signal, signal, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/project-cancel.css";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button, SelectButton } from "@projective/ui/fields";
import { MoneyView } from "@projective/ui/display/money";
import type {
	EngagementKind,
	FairExitTier,
	ProjectCancelled,
	ProjectCancelPreview,
	ProjectCancelStage,
} from "../types/projects-types.ts";
import { SettlementService } from "../core/SettlementService.ts";
import { FAIR_EXIT_TIER_OPTIONS, parseFairExitTier } from "../core/fair-exit-model.ts";
import {
	canConfirmProjectCancel,
	defaultProjectCancelTiers,
	projectCancelBlockedText,
	projectCancelConsequences,
	projectCancelCopy,
	projectCancelMovesMoney,
	type ProjectCancelTiers,
	stageQuoteFor,
} from "../core/project-cancel-model.ts";

/**
 * CancelProjectDialog — the one Cancel confirmation for a client's brief and a bought service
 * (Decisions #456, #467). Opening it reads what cancelling settles: what comes back to the client at
 * once (every ticket nobody has claimed, and every later-stage reservation), and, for each stage
 * holding claimed work, three Fair Exit quotes. The client picks how much of each such stage was
 * delivered; the figures are the server's, the same quote the settlement then moves, so the dialog
 * computes none. The settlement is stated before the commit, every figure a {@link MoneyView}.
 *
 * The commit is the tier-1 accent pill ("Settle and cancel") only when cancelling moves money — a
 * refund does (DESIGN_SYSTEM §B.8.1); an engagement holding nothing cancels through a plain
 * destructive confirm. Cancelling cannot be undone, so initial focus lands on "Keep …", never on the
 * commit. A blocked engagement (an open dispute, booked sittings, a stage mid-payment) says why and
 * offers no commit. A refused or failed cancellation stays in the dialog beside the control that
 * produced it.
 */
export interface CancelProjectDialogProps {
	/** Visibility, owned by the caller (the shared overlay contract is signal-first). */
	open: Signal<boolean>;
	/** The engagement's route address (`prj-…`). */
	projectId: string;
	/** The engagement's title, for the lede. */
	title: string;
	/** The engagement's kind as the caller knows it; the preview's own answer wins once it is read. */
	kind: EngagementKind;
	/** The engagement was cancelled; `message` is the server's notice. */
	onCancelled: (result: ProjectCancelled, message: string | null) => void;
}

type TierSignals = Readonly<Record<string, Signal<string>>>;

function tierSignalsFor(preview: ProjectCancelPreview): TierSignals {
	const out: Record<string, Signal<string>> = {};
	for (const [stageId, tier] of Object.entries(defaultProjectCancelTiers(preview))) {
		out[stageId] = signal(String(tier));
	}
	return out;
}

function chosenTiers(signals: TierSignals): ProjectCancelTiers {
	const out: Record<string, FairExitTier> = {};
	for (const [stageId, value] of Object.entries(signals)) {
		const tier = parseFairExitTier(value.value);
		if (tier !== null) out[stageId] = tier;
	}
	return out;
}

function StageSettlement(
	props: {
		stage: ProjectCancelStage;
		value: Signal<string>;
		tiers: ProjectCancelTiers;
		currency: string;
		disabled: boolean;
	},
): JSX.Element {
	const { stage, value, tiers, currency, disabled } = props;
	const quote = stageQuoteFor(stage, tiers);
	return (
		<section class="proj-cancel__stage" aria-label={stage.stageName}>
			<h3 class="proj-cancel__stage-name">{stage.stageName}</h3>
			<SelectButton
				options={[...FAIR_EXIT_TIER_OPTIONS]}
				value={value}
				disabled={disabled}
				aria-label={`Share of ${stage.stageName} delivered`}
				fluid
			/>
			{quote
				? (
					<dl class="proj-cancel__figures">
						<div class="proj-cancel__row">
							<dt class="proj-cancel__term">Paid for the work delivered</dt>
							<dd class="proj-cancel__value">
								<MoneyView minor={quote.freelancerPaidCents} currency={currency} exact />
							</dd>
						</div>
						<div class="proj-cancel__row">
							<dt class="proj-cancel__term">Platform fee on that share</dt>
							<dd class="proj-cancel__value">
								<MoneyView minor={quote.feeCents} currency={currency} exact tone="fee" />
							</dd>
						</div>
						<div class="proj-cancel__row">
							<dt class="proj-cancel__term">Refunded to you</dt>
							<dd class="proj-cancel__value">
								<MoneyView
									minor={quote.clientRefundedCents}
									currency={currency}
									exact
									tone="credit"
								/>
							</dd>
						</div>
					</dl>
				)
				: null}
		</section>
	);
}

/** The lede: what cancelling does, worded for the kind and for whether any money is held. */
function lede(
	kind: EngagementKind,
	title: string,
	preview: ProjectCancelPreview | null,
): JSX.Element {
	const copy = projectCancelCopy(kind);
	const who = kind === "service" ? "the provider has" : "a freelancer has";
	const name = <strong>{title || `this ${copy.noun}`}</strong>;
	if (preview?.cancellable && !projectCancelMovesMoney(preview)) {
		return (
			<p class="proj-cancel__lede">
				Cancelling {name} ends it. Nothing is held on it, so no money moves.
			</p>
		);
	}
	const returned = (preview?.returnedCents ?? 1) > 0;
	const settles = (preview?.stages.length ?? 1) > 0;
	return (
		<p class="proj-cancel__lede">
			Cancelling {name} settles its money first, then ends it.
			{returned ? " Money held for work nobody has started comes back to your wallet now." : null}
			{settles
				? ` Work ${who} claimed is settled under Fair Exit: choose how much of each stage was delivered.`
				: null}
		</p>
	);
}

export function CancelProjectDialog(props: CancelProjectDialogProps): JSX.Element {
	const { open, title, onCancelled } = props;
	const preview = useSignal<ProjectCancelPreview | null>(null);
	const tierSignals = useSignal<TierSignals>({});
	const loading = useSignal(false);
	const loadError = useSignal<string | null>(null);
	const busy = useSignal(false);
	const submitError = useSignal<string | null>(null);
	const projectRef = useRef(props.projectId);
	projectRef.current = props.projectId;
	const request = useRef(0);
	const actionsRef = useRef<HTMLDivElement>(null);

	async function load(): Promise<void> {
		const my = ++request.current;
		preview.value = null;
		tierSignals.value = {};
		loadError.value = null;
		submitError.value = null;
		loading.value = true;
		const res = await SettlementService.previewProjectCancel(projectRef.current);
		if (my !== request.current) return;
		loading.value = false;
		if (!res.ok || !res.data) {
			loadError.value = res.message ??
				"What cancelling settles could not be read — please try again.";
			return;
		}
		tierSignals.value = tierSignalsFor(res.data);
		preview.value = res.data;
	}

	useSignalEffect(() => {
		if (open.value) void load();
		else request.current++;
	});

	const current = preview.value;
	const kind = current?.kind ?? props.kind;
	const copy = projectCancelCopy(kind);
	const tiers = chosenTiers(tierSignals.value);
	const confirmable = canConfirmProjectCancel(current, tiers, busy.value);
	const movesMoney = projectCancelMovesMoney(current);

	async function confirm(): Promise<void> {
		if (!canConfirmProjectCancel(preview.value, chosenTiers(tierSignals.value), busy.value)) return;
		busy.value = true;
		submitError.value = null;
		const res = await SettlementService.cancelProject(
			projectRef.current,
			chosenTiers(tierSignals.value),
		);
		busy.value = false;
		if (!res.ok || !res.data) {
			submitError.value = res.message ??
				`The ${copy.noun} could not be cancelled — please try again.`;
			return;
		}
		open.value = false;
		onCancelled(res.data, res.message ?? null);
	}

	return (
		<Dialog
			visible={open}
			header={copy.header}
			role="alertdialog"
			class="proj-cancel"
			width="36rem"
			initialFocusRef={actionsRef}
			footer={
				<div ref={actionsRef} class="proj-cancel__actions">
					<Button
						label={copy.keep}
						severity="secondary"
						variant="text"
						onClick={() => (open.value = false)}
					/>
					{current?.cancellable
						? movesMoney
							? (
								<Button
									label={copy.settleCommit}
									severity="accent"
									rounded
									loading={busy.value}
									disabled={!confirmable}
									onClick={() => void confirm()}
								/>
							)
							: (
								<Button
									label={copy.commit}
									severity="danger"
									loading={busy.value}
									disabled={!confirmable}
									onClick={() => void confirm()}
								/>
							)
						: null}
				</div>
			}
		>
			<div class="proj-cancel__body">
				{lede(kind, title, current)}

				{loading.value
					? <p class="proj-cancel__meta" role="status">Reading what this {copy.noun} holds…</p>
					: null}

				{loadError.value
					? (
						<div class="proj-cancel__notice">
							<Message severity="danger" variant="subtle" size="sm">{loadError.value}</Message>
							<Button
								label="Try again"
								severity="neutral"
								variant="outlined"
								size="sm"
								onClick={() => void load()}
							/>
						</div>
					)
					: null}

				{current?.blocked
					? (
						<Message severity="info" variant="subtle" size="sm">
							{projectCancelBlockedText(current.blocked, kind)}
						</Message>
					)
					: null}

				{current?.cancellable
					? (
						<>
							{current.returnedCents > 0
								? (
									<dl class="proj-cancel__figures">
										<div class="proj-cancel__row proj-cancel__row--lead">
											<dt class="proj-cancel__term">Back to your wallet now</dt>
											<dd class="proj-cancel__value">
												<MoneyView
													minor={current.returnedCents}
													currency={current.currency}
													exact
													tone="credit"
												/>
											</dd>
										</div>
									</dl>
								)
								: null}

							{current.stages.map((stage) => {
								const value = tierSignals.value[stage.stageId];
								return value
									? (
										<StageSettlement
											key={stage.stageId}
											stage={stage}
											value={value}
											tiers={tiers}
											currency={current.currency}
											disabled={busy.value}
										/>
									)
									: null;
							})}

							<p class="proj-cancel__meta">{projectCancelConsequences(current).join(" · ")}</p>
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
