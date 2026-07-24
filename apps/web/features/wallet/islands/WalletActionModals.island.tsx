import type { ComponentChildren, JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/wallet.css";
import { Dialog } from "@projective/ui/feedback";
import { Button, InputNumber, Select, Textarea, ToggleSwitch } from "@projective/ui/fields";
import { FormControl } from "@projective/ui/fields";
import { WalletService } from "../core/WalletService.ts";
import { actionMeta } from "../core/wallet-model.ts";
import {
	type ActionTarget,
	actionTarget,
	activeAction,
	closeWalletAction,
	displayCurrency,
	notifyWalletChanged,
	withSim,
} from "../core/wallet-state.ts";
import type { WalletAction, WalletSwitcher } from "../types/wallet-types.ts";

/**
 * WalletActionModals — the money-move modals, mounted once in the lane and opened via the shared
 * `activeAction` signal. Each is a `@projective/ui` `Dialog` (BodyPortal-mounted, escaping the glass-blur
 * fixed-overlay trap) with a compact form; on success it announces {@link notifyWalletChanged} so every
 * mounted page refetches, then closes. The client never computes an amount or fee — it posts the entry
 * and renders the server's confirmation. **Card entry is Stripe-hosted** (a secure placeholder), never a
 * card-number field (finance-model.md §Payment Methods).
 */
export default function WalletActionModals(): JSX.Element {
	const visible = useSignal(false);
	useSignalEffect(() => {
		visible.value = activeAction.value !== null;
	});
	const action = activeAction.value;
	const target = actionTarget.value ?? { scope: "personal", contextId: "" };

	return (
		<Dialog
			visible={visible}
			header={action ? actionMeta(action).label : ""}
			modal
			width="30rem"
			class="wallet-modal"
			onVisibleChange={(v) => {
				if (!v) closeWalletAction();
			}}
		>
			{action && <ActionForm key={action} action={action} target={target} />}
		</Dialog>
	);
}

// #region Form dispatcher
function ActionForm(
	{ action, target }: { action: WalletAction; target: ActionTarget },
): JSX.Element {
	switch (action) {
		case "top_up":
			return (
				<AmountForm
					target={target}
					verb="Top up"
					onSubmit={(minor, ccy) =>
						WalletService.topUp(
							withSim({ ...base(target), amountMinor: minor, currency: ccy, methodId: null }),
						)}
				/>
			);
		case "withdraw":
			return <WithdrawForm target={target} />;
		case "transfer":
			return <TransferForm target={target} />;
		case "distribute":
			return (
				<AmountForm
					target={target}
					verb="Distribute"
					note="Divides per the active split ruleset."
					onSubmit={(minor, ccy) =>
						WalletService.distribute(
							withSim({ ...base(target), amountMinor: minor, currency: ccy }),
						)}
				/>
			);
		case "fund_escrow":
			return <FundEscrowForm target={target} />;
		case "new_recurring":
			return <RecurringForm target={target} />;
		case "add_method":
			return <AddMethodForm target={target} />;
		case "set_payout":
			return <PayoutScheduleForm target={target} />;
		case "request_spend":
			return <RequestSpendForm target={target} />;
		case "enrol_smoother":
			return <SmootherForm />;
	}
}

function base(target: ActionTarget) {
	return {
		scope: target.scope as never,
		contextId: target.contextId,
		display: displayCurrency.value,
	};
}

function toMinor(amount: number | null): number {
	return Math.round((amount ?? 0) * 100);
}
// #endregion

// #region Shared form shell
function useSubmit(run: () => Promise<{ ok: boolean; message?: string }>) {
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	async function submit(): Promise<void> {
		if (busy.value) return;
		busy.value = true;
		error.value = null;
		const res = await run();
		busy.value = false;
		if (res.ok) {
			notifyWalletChanged();
			closeWalletAction();
		} else {
			error.value = res.message ?? "Something went wrong.";
		}
	}
	return { busy, error, submit };
}

function ModalShell(
	{ error, busy, cta, disabled, note, onSubmit, children }: {
		error: string | null;
		busy: boolean;
		cta: string;
		disabled?: boolean;
		note?: string;
		onSubmit: () => void;
		children: ComponentChildren;
	},
): JSX.Element {
	return (
		<form
			class="wallet-form"
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit();
			}}
		>
			{children}
			{note && <p class="wallet-form__note">{note}</p>}
			{error && <p class="wallet-form__error" role="alert">{error}</p>}
			<div class="wallet-form__actions">
				<Button type="button" variant="text" onClick={closeWalletAction}>Cancel</Button>
				<Button type="submit" variant="filled" loading={busy} disabled={disabled}>{cta}</Button>
			</div>
		</form>
	);
}
// #endregion

// #region Amount-only form (top up / distribute)
function AmountForm(
	{ verb, note, onSubmit }: {
		target: ActionTarget;
		verb: string;
		note?: string;
		onSubmit: (minor: number, ccy: string) => Promise<{ ok: boolean; message?: string }>;
	},
): JSX.Element {
	const amount = useSignal<number | null>(null);
	const { busy, error, submit } = useSubmit(() =>
		onSubmit(toMinor(amount.value), displayCurrency.value)
	);
	return (
		<ModalShell
			error={error.value}
			busy={busy.value}
			cta={verb}
			note={note}
			disabled={!amount.value}
			onSubmit={submit}
		>
			<FormControl label="Amount">
				<InputNumber
					value={amount}
					mode="currency"
					currency={displayCurrency.value}
					min={0}
					placeholder="0.00"
					fluid
					aria-label="Amount"
				/>
			</FormControl>
		</ModalShell>
	);
}
// #endregion

// #region Withdraw
function WithdrawForm({ target }: { target: ActionTarget }): JSX.Element {
	const amount = useSignal<number | null>(null);
	const instant = useSignal(false);
	const { busy, error, submit } = useSubmit(() =>
		WalletService.withdraw(
			withSim({
				...base(target),
				amountMinor: toMinor(amount.value),
				currency: displayCurrency.value,
				destinationId: null,
				instant: instant.value,
			}),
		)
	);
	return (
		<ModalShell
			error={error.value}
			busy={busy.value}
			cta="Withdraw"
			disabled={!amount.value}
			onSubmit={submit}
		>
			<FormControl label="Amount">
				<InputNumber
					value={amount}
					mode="currency"
					currency={displayCurrency.value}
					min={0}
					placeholder="0.00"
					fluid
					aria-label="Amount"
				/>
			</FormControl>
			<label class="wallet-form__switch">
				<ToggleSwitch value={instant} aria-label="Instant payout" />
				<span>
					Instant payout{" "}
					<span class="wallet-form__hint">— a small fee applies, shown before you confirm</span>
				</span>
			</label>
		</ModalShell>
	);
}
// #endregion

// #region Transfer
function TransferForm({ target }: { target: ActionTarget }): JSX.Element {
	const amount = useSignal<number | null>(null);
	const dest = useSignal<string>("");
	const switcher = useSignal<WalletSwitcher | null>(null);
	useSignalEffect(() => {
		// Load once the accounts to transfer to.
		if (switcher.value) return;
		WalletService.switcher({ wallet: null, display: displayCurrency.value }).then((r) => {
			if (r.ok && r.data) switcher.value = r.data.switcher;
		});
	});
	const options = (switcher.value?.accounts ?? [])
		.filter((a) => !(a.scope === target.scope && a.id === target.contextId))
		.map((a) => ({ label: `${a.name} · ${a.available.display}`, value: `${a.scope}:${a.id}` }));
	const { busy, error, submit } = useSubmit(() => {
		const [toScope, toId] = (dest.value || "personal:").split(":");
		return WalletService.transfer(withSim({
			fromScope: target.scope as never,
			fromId: target.contextId,
			toScope: toScope as never,
			toId: toId ?? "",
			amountMinor: toMinor(amount.value),
			currency: displayCurrency.value,
			note: null,
			display: displayCurrency.value,
		}));
	});
	return (
		<ModalShell
			error={error.value}
			busy={busy.value}
			cta="Transfer"
			disabled={!amount.value || !dest.value}
			onSubmit={submit}
		>
			<FormControl label="To wallet">
				<Select
					value={dest}
					options={options}
					placeholder="Choose a wallet"
					fluid
					aria-label="Destination wallet"
				/>
			</FormControl>
			<FormControl label="Amount">
				<InputNumber
					value={amount}
					mode="currency"
					currency={displayCurrency.value}
					min={0}
					placeholder="0.00"
					fluid
					aria-label="Amount"
				/>
			</FormControl>
		</ModalShell>
	);
}
// #endregion

// #region Fund escrow
function FundEscrowForm({ target }: { target: ActionTarget }): JSX.Element {
	const amount = useSignal<number | null>(null);
	const stage = useSignal<string>("helia-wallet-redesign");
	const { busy, error, submit } = useSubmit(() =>
		WalletService.fundEscrow(
			withSim({
				...base(target),
				stageId: stage.value,
				amountMinor: toMinor(amount.value),
				currency: displayCurrency.value,
			}),
		)
	);
	return (
		<ModalShell
			error={error.value}
			busy={busy.value}
			cta="Fund escrow"
			disabled={!amount.value}
			onSubmit={submit}
		>
			<FormControl label="Stage">
				<Select
					value={stage}
					options={[
						{ label: "Helia wallet redesign", value: "helia-wallet-redesign" },
						{ label: "Monarch design system", value: "monarch-design-system" },
						{ label: "Verdant brand refresh", value: "verdant-brand-refresh" },
					]}
					fluid
					aria-label="Stage"
				/>
			</FormControl>
			<FormControl label="Amount">
				<InputNumber
					value={amount}
					mode="currency"
					currency={displayCurrency.value}
					min={0}
					placeholder="0.00"
					fluid
					aria-label="Amount"
				/>
			</FormControl>
		</ModalShell>
	);
}
// #endregion

// #region Recurring deposit
function RecurringForm({ target }: { target: ActionTarget }): JSX.Element {
	const amount = useSignal<number | null>(null);
	const interval = useSignal<string>("monthly");
	const { busy, error, submit } = useSubmit(() =>
		WalletService.addRecurring(
			withSim({
				...base(target),
				amountMinor: toMinor(amount.value),
				currency: displayCurrency.value,
				interval: interval.value as "weekly" | "monthly",
				sourceMethodId: null,
			}),
		)
	);
	return (
		<ModalShell
			error={error.value}
			busy={busy.value}
			cta="Create rule"
			disabled={!amount.value}
			onSubmit={submit}
		>
			<FormControl label="Amount">
				<InputNumber
					value={amount}
					mode="currency"
					currency={displayCurrency.value}
					min={0}
					placeholder="0.00"
					fluid
					aria-label="Amount"
				/>
			</FormControl>
			<FormControl label="Interval">
				<Select
					value={interval}
					options={[{ label: "Weekly", value: "weekly" }, { label: "Monthly", value: "monthly" }]}
					fluid
					aria-label="Interval"
				/>
			</FormControl>
		</ModalShell>
	);
}
// #endregion

// #region Add method (Stripe-hosted — no card-number field)
function AddMethodForm({ target }: { target: ActionTarget }): JSX.Element {
	const role = useSignal<string>("both");
	const label = useSignal<string>("");
	const { busy, error, submit } = useSubmit(() =>
		WalletService.addMethod(
			withSim({
				...base(target),
				methodRole: role.value as "funding" | "payout" | "both",
				provider: "stripe",
				token: "tok_demo",
				label: label.value || null,
			}),
		)
	);
	return (
		<ModalShell
			error={error.value}
			busy={busy.value}
			cta="Add method"
			onSubmit={submit}
			note="Card details are entered securely via Stripe — never on this page."
		>
			<div class="wallet-stripe" aria-hidden="true">
				<span class="wallet-stripe__lock">🔒</span>
				<span class="wallet-stripe__text">Secure card entry (Stripe Elements)</span>
			</div>
			<FormControl label="Use for">
				<Select
					value={role}
					options={[{ label: "Funding (spend)", value: "funding" }, {
						label: "Payout (earn)",
						value: "payout",
					}, { label: "Both", value: "both" }]}
					fluid
					aria-label="Method role"
				/>
			</FormControl>
			<FormControl label="Label (optional)">
				<Textarea
					value={label}
					rows={1}
					autoResize
					placeholder="e.g. Company card"
					aria-label="Label"
				/>
			</FormControl>
		</ModalShell>
	);
}
// #endregion

// #region Payout schedule
function PayoutScheduleForm({ target }: { target: ActionTarget }): JSX.Element {
	const mode = useSignal<string>("scheduled_weekly");
	const threshold = useSignal<number | null>(null);
	const instant = useSignal(false);
	const { busy, error, submit } = useSubmit(() =>
		WalletService.setPayout(withSim({
			...base(target),
			mode: mode.value as "manual" | "scheduled_weekly" | "scheduled_monthly" | "threshold",
			thresholdMinor: mode.value === "threshold" ? toMinor(threshold.value) : null,
			destinationId: null,
			instant: instant.value,
		}))
	);
	return (
		<ModalShell error={error.value} busy={busy.value} cta="Save schedule" onSubmit={submit}>
			<FormControl label="Payout frequency">
				<Select
					value={mode}
					options={[
						{ label: "Manual", value: "manual" },
						{ label: "Weekly", value: "scheduled_weekly" },
						{ label: "Monthly", value: "scheduled_monthly" },
						{ label: "When balance reaches…", value: "threshold" },
					]}
					fluid
					aria-label="Payout frequency"
				/>
			</FormControl>
			{mode.value === "threshold" && (
				<FormControl label="Threshold">
					<InputNumber
						value={threshold}
						mode="currency"
						currency={displayCurrency.value}
						min={0}
						placeholder="0.00"
						fluid
						aria-label="Threshold"
					/>
				</FormControl>
			)}
			<label class="wallet-form__switch">
				<ToggleSwitch value={instant} aria-label="Instant payouts" />
				<span>
					Instant payouts <span class="wallet-form__hint">— a small fee applies</span>
				</span>
			</label>
		</ModalShell>
	);
}
// #endregion

// #region Request spend
function RequestSpendForm({ target }: { target: ActionTarget }): JSX.Element {
	const amount = useSignal<number | null>(null);
	const reason = useSignal<string>("");
	const { busy, error, submit } = useSubmit(() =>
		WalletService.requestSpend(
			withSim({
				...base(target),
				amountMinor: toMinor(amount.value),
				currency: displayCurrency.value,
				reason: reason.value,
			}),
		)
	);
	return (
		<ModalShell
			error={error.value}
			busy={busy.value}
			cta="Request"
			disabled={!amount.value || !reason.value.trim()}
			onSubmit={submit}
			note="Over-cap spends need a second approver."
		>
			<FormControl label="Amount">
				<InputNumber
					value={amount}
					mode="currency"
					currency={displayCurrency.value}
					min={0}
					placeholder="0.00"
					fluid
					aria-label="Amount"
				/>
			</FormControl>
			<FormControl label="Reason">
				<Textarea
					value={reason}
					rows={2}
					autoResize
					placeholder="What is this spend for?"
					aria-label="Reason"
				/>
			</FormControl>
		</ModalShell>
	);
}
// #endregion

// #region Income Smoother enrol
function SmootherForm(): JSX.Element {
	const target = useSignal<number | null>(null);
	const { busy, error, submit } = useSubmit(() =>
		WalletService.enrolSmoother(
			withSim({
				targetMonthlyMinor: toMinor(target.value),
				currency: displayCurrency.value,
				display: displayCurrency.value,
			}),
		)
	);
	return (
		<ModalShell
			error={error.value}
			busy={busy.value}
			cta="Enrol"
			disabled={!target.value}
			onSubmit={submit}
			note="We'll buffer earning peaks to top up troughs toward your target, for a 0.5% fee."
		>
			<FormControl label="Target monthly income">
				<InputNumber
					value={target}
					mode="currency"
					currency={displayCurrency.value}
					min={0}
					placeholder="0.00"
					fluid
					aria-label="Target monthly income"
				/>
			</FormControl>
		</ModalShell>
	);
}
// #endregion
