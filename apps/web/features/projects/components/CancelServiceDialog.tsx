import type { JSX } from "preact";
import { type Signal, signal, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/service-cancel.css";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button, SelectButton } from "@projective/ui/fields";
import { MoneyView } from "@projective/ui/display/money";
import type {
	FairExitTier,
	ServiceCancelled,
	ServiceCancelPreview,
	ServiceCancelStage,
} from "../types/projects-types.ts";
import { SettlementService } from "../core/SettlementService.ts";
import { FAIR_EXIT_TIER_OPTIONS, parseFairExitTier } from "../core/fair-exit-model.ts";
import {
	canConfirmServiceCancel,
	defaultServiceCancelTiers,
	serviceCancelBlockedText,
	serviceCancelConsequences,
	type ServiceCancelTiers,
	stageQuoteFor,
} from "../core/service-cancel-model.ts";

/**
 * CancelServiceDialog — the client's "Cancel service" confirmation on a bought service (Decision
 * #456). Opening it reads what cancelling settles: what comes back to the client at once (every
 * ticket nobody has claimed, and every later-stage reservation), and, for each stage holding claimed
 * work, three Fair Exit quotes. The client picks how much of each such stage was delivered; the
 * figures are the server's, the same quote the settlement then moves, so the dialog computes none.
 *
 * Cancelling cannot be undone, so initial focus lands on "Keep service", never on the confirm. A
 * refused or failed cancellation stays in the dialog beside the control that produced it.
 */
export interface CancelServiceDialogProps {
	/** Visibility, owned by the caller (the shared overlay contract is signal-first). */
	open: Signal<boolean>;
	/** The service's route address (`prj-…`). */
	projectId: string;
	/** The service's title, for the lede. */
	title: string;
	/** The service was cancelled; `message` is the server's notice. */
	onCancelled: (result: ServiceCancelled, message: string | null) => void;
}

type TierSignals = Readonly<Record<string, Signal<string>>>;

function tierSignalsFor(preview: ServiceCancelPreview): TierSignals {
	const out: Record<string, Signal<string>> = {};
	for (const [stageId, tier] of Object.entries(defaultServiceCancelTiers(preview))) {
		out[stageId] = signal(String(tier));
	}
	return out;
}

function chosenTiers(signals: TierSignals): ServiceCancelTiers {
	const out: Record<string, FairExitTier> = {};
	for (const [stageId, value] of Object.entries(signals)) {
		const tier = parseFairExitTier(value.value);
		if (tier !== null) out[stageId] = tier;
	}
	return out;
}

function StageSettlement(
	props: {
		stage: ServiceCancelStage;
		value: Signal<string>;
		tiers: ServiceCancelTiers;
		currency: string;
		disabled: boolean;
	},
): JSX.Element {
	const { stage, value, tiers, currency, disabled } = props;
	const quote = stageQuoteFor(stage, tiers);
	return (
		<section class="svc-cancel__stage" aria-label={stage.stageName}>
			<h3 class="svc-cancel__stage-name">{stage.stageName}</h3>
			<SelectButton
				options={[...FAIR_EXIT_TIER_OPTIONS]}
				value={value}
				disabled={disabled}
				aria-label={`Share of ${stage.stageName} delivered`}
				fluid
			/>
			{quote
				? (
					<dl class="svc-cancel__figures">
						<div class="svc-cancel__row">
							<dt class="svc-cancel__term">Paid for the work delivered</dt>
							<dd class="svc-cancel__value">
								<MoneyView minor={quote.freelancerPaidCents} currency={currency} exact />
							</dd>
						</div>
						<div class="svc-cancel__row">
							<dt class="svc-cancel__term">Platform fee on that share</dt>
							<dd class="svc-cancel__value">
								<MoneyView minor={quote.feeCents} currency={currency} exact tone="fee" />
							</dd>
						</div>
						<div class="svc-cancel__row">
							<dt class="svc-cancel__term">Refunded to you</dt>
							<dd class="svc-cancel__value">
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

export function CancelServiceDialog(props: CancelServiceDialogProps): JSX.Element {
	const { open, title, onCancelled } = props;
	const preview = useSignal<ServiceCancelPreview | null>(null);
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
		const res = await SettlementService.previewServiceCancel(projectRef.current);
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
	const tiers = chosenTiers(tierSignals.value);
	const confirmable = canConfirmServiceCancel(current, tiers, busy.value);

	async function confirm(): Promise<void> {
		if (!canConfirmServiceCancel(preview.value, chosenTiers(tierSignals.value), busy.value)) return;
		busy.value = true;
		submitError.value = null;
		const res = await SettlementService.cancelService(
			projectRef.current,
			chosenTiers(tierSignals.value),
		);
		busy.value = false;
		if (!res.ok || !res.data) {
			submitError.value = res.message ?? "The service could not be cancelled — please try again.";
			return;
		}
		open.value = false;
		onCancelled(res.data, res.message ?? null);
	}

	return (
		<Dialog
			visible={open}
			header="Cancel this service?"
			role="alertdialog"
			class="svc-cancel"
			width="36rem"
			initialFocusRef={actionsRef}
			footer={
				<div ref={actionsRef} class="svc-cancel__actions">
					<Button
						label="Keep service"
						severity="secondary"
						variant="text"
						onClick={() => (open.value = false)}
					/>
					<Button
						label="Cancel service"
						severity="danger"
						loading={busy.value}
						disabled={!confirmable}
						onClick={() => void confirm()}
					/>
				</div>
			}
		>
			<div class="svc-cancel__body">
				<p class="svc-cancel__lede">
					Cancelling <strong>{title || "this service"}</strong>{" "}
					ends it. Money held for work nobody has started comes back to your wallet now. Work the
					provider has claimed is settled under Fair Exit: choose how much of each stage was
					delivered.
				</p>

				{loading.value
					? <p class="svc-cancel__meta" role="status">Reading what this service holds…</p>
					: null}

				{loadError.value
					? (
						<div class="svc-cancel__notice">
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

				{current?.blocked
					? (
						<Message severity="info" variant="subtle" size="sm">
							{serviceCancelBlockedText(current.blocked)}
						</Message>
					)
					: null}

				{current?.cancellable
					? (
						<>
							<dl class="svc-cancel__figures">
								<div class="svc-cancel__row svc-cancel__row--lead">
									<dt class="svc-cancel__term">Back to your wallet now</dt>
									<dd class="svc-cancel__value">
										<MoneyView
											minor={current.returnedCents}
											currency={current.currency}
											exact
											tone="credit"
										/>
									</dd>
								</div>
							</dl>

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

							<p class="svc-cancel__meta">{serviceCancelConsequences(current).join(" · ")}</p>
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
