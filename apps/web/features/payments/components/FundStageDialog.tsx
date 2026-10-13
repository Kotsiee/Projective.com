import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { CardPaymentHandoff, StageFundingQuote } from "@projective/types/finance";
import { Alert, Dialog } from "@projective/ui/feedback";
import { Button, SelectButton } from "@projective/ui/fields";
import { WalletService } from "@features/wallet/core/WalletService.ts";
import { newAttemptKey } from "@features/wallet/core/wallet-state.ts";
import { PaymentsService } from "../core/PaymentsService.ts";
import {
	stageFundingPlan,
	type StageFundMethod,
	stageLockSentence,
} from "../core/stage-funding.ts";
import { StripeElementPanel } from "./StripeElementPanel.tsx";
import "../styles/stage-fund.css";

/**
 * FundStageDialog — the client funds a whole stage from the board (Decision #197): every ticket in it
 * nobody has paid for, claimed or not, from the paying wallet when it covers the stage, or by card.
 *
 * The figure is the server's quote (`GET /api/finance/escrow/quote`), never computed here. The wallet
 * path is the `/wallet` fund action (`projects.fund_stage`); the card path is the escrow intent
 * (`POST /api/finance/escrow/intent`) confirmed in Stripe's Payment Element, and the stage is funded
 * only when the signed webhook settles it — the dialog waits for that and says what happened.
 */
export interface FundStageDialogProps {
	visible: Signal<boolean>;
	/** The project's `prj-…` slug. */
	project: string;
	/** The stage's `stg-…` slug or row id. */
	stage: string;
	/** After money moved (funded, settling, or left in the wallet) — the host re-reads its board. */
	onFunded: () => void;
}

type Step = "loading" | "choose" | "sending" | "card" | "settling" | "done" | "error";

const METHOD_OPTIONS: { label: string; value: StageFundMethod }[] = [
	{ label: "From wallet", value: "wallet" },
	{ label: "By card", value: "card" },
];

export function FundStageDialog(props: FundStageDialogProps): JSX.Element {
	const step = useSignal<Step>("loading");
	const quote = useSignal<StageFundingQuote | null>(null);
	const method = useSignal<StageFundMethod>("wallet");
	const handoff = useSignal<CardPaymentHandoff | null>(null);
	const message = useSignal<string | null>(null);
	const attempt = useRef("");

	const load = async () => {
		step.value = "loading";
		quote.value = null;
		message.value = null;
		const res = await PaymentsService.stageFundingQuote(props.project, props.stage);
		if (!res.ok || !res.data) {
			message.value = res.message ?? "We couldn't read this stage's funding just now.";
			step.value = "error";
			return;
		}
		quote.value = res.data.quote;
		method.value = stageFundingPlan(res.data.quote).methods[0] ?? "card";
		attempt.current = newAttemptKey();
		step.value = "choose";
	};

	useSignalEffect(() => {
		if (props.visible.value) void load();
	});

	const settle = async (paymentId: string) => {
		step.value = "settling";
		const { outcome, reason } = await PaymentsService.waitForLock(paymentId);
		message.value = stageLockSentence(outcome, reason);
		step.value = outcome === "locked" || outcome === "timeout" ? "done" : "error";
		if (outcome !== "declined") props.onFunded();
	};

	const commit = async (q: StageFundingQuote) => {
		step.value = "sending";
		message.value = null;
		if (method.value === "wallet") {
			const res = await WalletService.fundEscrow({
				scope: q.payer.scope,
				contextId: q.payer.scope === "business" ? q.payer.id : "",
				stageId: q.stageId,
				amountMinor: q.amountMinor,
				currency: q.currency,
			});
			if (!res.ok) {
				message.value = res.message ?? "The stage couldn't be funded.";
				step.value = "error";
				return;
			}
			message.value = res.data?.result.message ?? stageLockSentence("locked");
			step.value = "done";
			props.onFunded();
			return;
		}
		const res = await PaymentsService.escrowLockIntent({
			projectId: q.projectId,
			stageId: q.stageId,
			expectedAmountMinor: q.amountMinor,
			currency: q.currency,
			idempotencyKey: attempt.current,
		});
		if (!res.ok || !res.data) {
			message.value = res.message ?? "The card payment couldn't be started.";
			step.value = "error";
			return;
		}
		if (res.data.confirmation === "none") {
			void settle(res.data.paymentId);
			return;
		}
		handoff.value = res.data;
		step.value = "card";
	};

	const close = () => {
		props.visible.value = false;
	};

	const q = quote.value;
	const plan = q ? stageFundingPlan(q) : null;
	const canCommit = !!q && !!plan && plan.blocked === null &&
		(step.value === "choose" || step.value === "error");

	const footer = step.value === "done"
		? <Button variant="filled" label="Done" onClick={close} />
		: (
			<>
				<Button
					variant="text"
					label="Cancel"
					disabled={step.value === "sending" || step.value === "settling"}
					onClick={close}
				/>
				{step.value !== "card" && step.value !== "settling" && q && plan && plan.blocked === null &&
					(
						<Button
							variant="filled"
							severity="accent"
							rounded
							label={step.value === "error"
								? "Try again"
								: method.value === "wallet"
								? `Fund ${plan.amountLabel}`
								: "Continue to payment"}
							loading={step.value === "sending"}
							disabled={!canCommit}
							onClick={() => void commit(q)}
						/>
					)}
			</>
		);

	return (
		<Dialog
			visible={props.visible}
			header="Fund stage"
			footer={<div class="sfd__foot">{footer}</div>}
			width="var(--overlay-w-sm)"
			class="sfd-dialog"
		>
			<div class="sfd">
				{step.value === "loading" && (
					<p class="sfd__lead" role="status">Reading what this stage needs…</p>
				)}

				{q && plan &&
					(step.value === "choose" || step.value === "sending" || step.value === "error") && (
					<>
						<p class="sfd__name">{q.stageName}</p>
						<p class="sfd__amount">{plan.amountLabel}</p>
						<p class="sfd__meta">{plan.ticketsLine}</p>
						{plan.blocked ? <Alert severity="warning">{plan.blocked}</Alert> : (
							<>
								{plan.methods.length > 1 && (
									<SelectButton
										options={METHOD_OPTIONS}
										value={method.value}
										onValueChange={(v) => {
											method.value = v as StageFundMethod;
										}}
									/>
								)}
								<p class="sfd__meta">
									{method.value === "wallet"
										? plan.walletLabel
										: `Charged to a card you enter next, then held from ${
											q.payer.scope === "business" ? "the business wallet" : "your wallet"
										}.`}
								</p>
								<p class="sfd__note">
									Held in escrow and released only when you approve the work. Tickets nobody has
									claimed yet are paid to whoever claims them.
								</p>
							</>
						)}
					</>
				)}

				{step.value === "error" && message.value && <Alert severity="danger">{message.value}
				</Alert>}

				{step.value === "card" && handoff.value && plan && (
					<>
						<p class="sfd__amount">{plan.amountLabel}</p>
						<StripeElementPanel
							mode="payment"
							clientSecret={handoff.value.clientSecret}
							publishableKey={handoff.value.publishableKey}
							submitLabel={`Pay ${plan.amountLabel}`}
							onOutcome={(result) => {
								if (result.ok && handoff.value) void settle(handoff.value.paymentId);
							}}
						/>
					</>
				)}

				{step.value === "settling" && (
					<p class="sfd__lead" role="status" aria-live="polite">
						Confirming the payment with your bank…
					</p>
				)}

				{step.value === "done" && <p class="sfd__lead" role="status">{message.value}</p>}
			</div>
		</Dialog>
	);
}
