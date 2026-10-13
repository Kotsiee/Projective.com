import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/fair-exit.css";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button, SelectButton } from "@projective/ui/fields";
import type { FairExitPreview, StageExited } from "../types/projects-types.ts";
import { SettlementService } from "../core/SettlementService.ts";
import {
	blockedText,
	canConfirmFairExit,
	DEFAULT_FAIR_EXIT_TIER,
	FAIR_EXIT_TIER_OPTIONS,
	fairExitConsequences,
	parseFairExitTier,
	quoteFor,
} from "../core/fair-exit-model.ts";

/**
 * FairExitDialog — the reviewer's "End stage (Fair Exit)" confirmation (Decision #198). Opening it reads
 * the stage's preview — one server-computed quote per tier — and the reviewer picks how much of the work
 * was delivered; the figures shown are exactly what the settlement then moves, because the door reports
 * the same quote. The island formats nothing and computes nothing.
 *
 * It owns its own read, choice and write, so the explorer only opens it and hears the result. A stage
 * the door would refuse (already settled, nothing held) says why and offers no confirm; a refused or
 * failed exit stays in the dialog beside the control that produced it. Ending a stage cannot be undone,
 * so initial focus lands on "Keep stage open", never on the confirm.
 */
export interface FairExitDialogProps {
	/** Visibility, owned by the caller (the shared overlay contract is signal-first). */
	open: Signal<boolean>;
	/** The project's route address (`prj-…`). */
	projectId: string;
	/** The stage to end — its uuid or `stg-…` slug; null renders nothing to confirm. */
	stageId: string | null;
	/** The stage as the surface names it, until the preview answers with its own name. */
	stageName: string | null;
	/** The exit settled; `message` is the server's notice. */
	onExited: (result: StageExited, message: string | null) => void;
}

interface FairExitTarget {
	projectId: string;
	stageId: string | null;
}

export function FairExitDialog(props: FairExitDialogProps): JSX.Element {
	const { open, stageName, onExited } = props;
	const preview = useSignal<FairExitPreview | null>(null);
	const loading = useSignal(false);
	const loadError = useSignal<string | null>(null);
	const tierValue = useSignal<string>(String(DEFAULT_FAIR_EXIT_TIER));
	const busy = useSignal(false);
	const submitError = useSignal<string | null>(null);
	const target = useRef<FairExitTarget>({ projectId: props.projectId, stageId: props.stageId });
	target.current = { projectId: props.projectId, stageId: props.stageId };
	const request = useRef(0);
	const actionsRef = useRef<HTMLDivElement>(null);

	async function load(): Promise<void> {
		const { projectId, stageId } = target.current;
		const my = ++request.current;
		preview.value = null;
		loadError.value = null;
		submitError.value = null;
		tierValue.value = String(DEFAULT_FAIR_EXIT_TIER);
		if (!stageId) {
			loadError.value = "Open a stage before ending it.";
			return;
		}
		loading.value = true;
		const res = await SettlementService.previewFairExit(projectId, stageId);
		if (my !== request.current) return;
		loading.value = false;
		if (!res.ok || !res.data) {
			loadError.value = res.message ??
				"The Fair Exit figures could not be read — please try again.";
			return;
		}
		preview.value = res.data;
	}

	useSignalEffect(() => {
		if (open.value) void load();
		else request.current++;
	});

	async function confirm(): Promise<void> {
		const tier = parseFairExitTier(tierValue.value);
		const { projectId, stageId } = target.current;
		if (!stageId || tier === null || !canConfirmFairExit(preview.value, tier, busy.value)) return;
		busy.value = true;
		submitError.value = null;
		const res = await SettlementService.cancelStageFairExit(projectId, stageId, tier);
		busy.value = false;
		if (!res.ok || !res.data) {
			submitError.value = res.message ?? "The stage could not be ended — please try again.";
			return;
		}
		open.value = false;
		onExited(res.data, res.message ?? null);
	}

	const current = preview.value;
	const tier = parseFairExitTier(tierValue.value);
	const quote = quoteFor(current, tier);
	const name = current?.stageName ?? stageName ?? "this stage";
	const consequences = current ? fairExitConsequences(current) : [];

	return (
		<Dialog
			visible={open}
			header="End stage under Fair Exit?"
			role="alertdialog"
			class="fexit"
			width="34rem"
			initialFocusRef={actionsRef}
			footer={
				<div ref={actionsRef} class="fexit__actions">
					<Button
						label="Keep stage open"
						severity="secondary"
						variant="text"
						onClick={() => (open.value = false)}
					/>
					<Button
						label="End stage and settle"
						severity="danger"
						loading={busy.value}
						disabled={!canConfirmFairExit(current, tier, busy.value)}
						onClick={() => void confirm()}
					/>
				</div>
			}
		>
			<div class="fexit__body">
				<p class="fexit__lede">
					Ending <strong>{name}</strong>{" "}
					settles the escrow still held on it now and closes the stage. Choose how much of the work
					was delivered: the freelancer is paid that share, less the platform fee, and the rest goes
					back to the client.
				</p>

				<div class="fexit__tiers">
					<span class="fexit__label" aria-hidden="true">Work delivered</span>
					<SelectButton
						options={[...FAIR_EXIT_TIER_OPTIONS]}
						value={tierValue}
						disabled={!current?.exitable || busy.value}
						aria-label="Share of the work delivered"
						fluid
					/>
				</div>

				{loading.value
					? <p class="fexit__meta" role="status">Reading the escrow held on this stage…</p>
					: null}

				{loadError.value
					? (
						<div class="fexit__notice">
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
							{blockedText(current.blocked)}
						</Message>
					)
					: null}

				{current?.exitable && quote
					? (
						<dl class="fexit__figures" aria-live="polite">
							<div class="fexit__row">
								<dt class="fexit__term">Paid to the freelancer</dt>
								<dd class="fexit__value">{quote.freelancerPaidLabel}</dd>
							</div>
							<div class="fexit__row">
								<dt class="fexit__term">Platform fee</dt>
								<dd class="fexit__value">{quote.feeLabel}</dd>
							</div>
							<div class="fexit__row fexit__row--total">
								<dt class="fexit__term">Refunded to the client</dt>
								<dd class="fexit__value">{quote.clientRefundedLabel}</dd>
							</div>
						</dl>
					)
					: null}

				{current?.exitable
					? (
						<p class="fexit__meta">
							{[`${current.heldLabel} held`, ...consequences, "this cannot be undone"].join(" · ")}
						</p>
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
