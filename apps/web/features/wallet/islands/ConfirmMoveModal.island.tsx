import type { JSX } from "preact";
import "../styles/wallet.css";
import { Alert, Dialog } from "@projective/ui/feedback";
import { WalletService } from "../core/WalletService.ts";
import {
	closeWalletAction,
	moveFlow,
	notifyWalletChanged,
	parseActiveTarget,
	withSim,
} from "../core/wallet-state.ts";
import { displayCurrency } from "../core/wallet-state.ts";
import type { WalletScope } from "../types/wallet-types.ts";
import { Icon } from "@projective/ui/icons";

/**
 * ConfirmMoveModal — the last step before money moves, and the only modal on this surface.
 *
 * A modal rather than an inline confirm because the grammar is the point: it removes the escape
 * route deliberately, which is correct for an action that cannot be taken back and wrong for
 * anything that can.
 *
 * It opens OVER the composing drawer rather than replacing it (`--z-modal` sits above
 * `--z-popover`), so "Back" returns to a form with every value intact. A failure likewise swaps the
 * modal's body and never destroys the drawer — losing a composed transfer because the network
 * blinked is how a user learns not to trust the surface.
 *
 * The confirm button carries the exact server-formatted amount (RULE O-2): a button reading
 * "Confirm" asks the user to remember what they typed; one reading "Transfer £2,400.00" does not.
 */
export default function ConfirmMoveModal(): JSX.Element | null {
	const flow = moveFlow.value;
	if (!flow) return null;

	const close = () => {
		moveFlow.value = null;
		closeWalletAction();
	};

	const commit = async () => {
		moveFlow.value = { ...flow, step: "pending" };
		const target = parseActiveTarget();
		// `parseActiveTarget` returns the scope as a plain string; the mutation payloads are typed on
		// the `WalletScope` union, and the parse can only ever yield one of its members.
		const scope = target.scope as WalletScope;
		const base = {
			scope,
			contextId: target.contextId,
			amountMinor: flow.amountMinor,
			currency: flow.currency,
			display: displayCurrency.value,
		};

		const res = flow.kind === "transfer"
			? await WalletService.transfer(withSim({
				fromScope: scope,
				fromId: target.contextId,
				toScope: "personal",
				toId: "",
				amountMinor: flow.amountMinor,
				currency: flow.currency,
				note: flow.note,
				display: displayCurrency.value,
			}))
			: flow.kind === "distribute"
			? await WalletService.distribute(withSim(base))
			: flow.kind === "withdraw"
			? await WalletService.withdraw(withSim({ ...base, destinationId: null, instant: false }))
			: await WalletService.topUp(withSim({ ...base, methodId: null }));

		if (res.ok) {
			moveFlow.value = { ...flow, step: "done", message: res.data?.result?.message ?? null };
			notifyWalletChanged();
		} else {
			moveFlow.value = {
				...flow,
				step: "error",
				message: res.message ?? "That didn't go through.",
			};
		}
	};

	const verb = flow.kind === "distribute"
		? `Distribute ${flow.amountDisplay}${
			flow.recipients > 0 ? ` to ${flow.recipients} members` : ""
		}`
		: flow.kind === "withdraw"
		? `Withdraw ${flow.amountDisplay}`
		: flow.kind === "top_up"
		? `Top up ${flow.amountDisplay}`
		: `Transfer ${flow.amountDisplay}`;

	// The action row goes through Dialog's `footer` slot, NOT children. As a child it landed inside the
	// scrolling body, so on a short viewport the irreversible commit — "Withdraw £X" — scrolled out of
	// sight while the amount above it stayed visible. The slot is a sibling of the scroll region.
	const foot = flow.step === "done"
		? (
			<>
				<a class="wlt-btn wlt-btn--ghost" href="/wallet/transactions">View transaction</a>
				<button type="button" class="wlt-btn wlt-btn--primary" onClick={close}>Done</button>
			</>
		)
		: (
			<>
				<button
					type="button"
					class="wlt-btn"
					disabled={flow.step === "pending"}
					onClick={() => {
						moveFlow.value = null;
					}}
				>
					Back
				</button>
				<button
					type="button"
					class="wlt-btn wlt-btn--primary"
					disabled={flow.step === "pending"}
					aria-disabled={flow.step === "pending" ? "true" : undefined}
					onClick={() => void commit()}
				>
					{flow.step === "pending" ? "Sending…" : flow.step === "error" ? "Try again" : verb}
				</button>
			</>
		);

	return (
		<Dialog
			visible
			modal
			class="wlt-modal"
			header="Confirm"
			footer={<div class="wlt-modal__foot">{foot}</div>}
			onVisibleChange={(v) => {
				if (!v) close();
			}}
		>
			{flow.step === "done"
				? (
					<div class="wlt-modal__body">
						<div class="wlt-modal__done" role="status" aria-live="polite">
							<Icon name="check" class="wlt-modal__check" />
							<p class="wlt-modal__figure">{flow.amountDisplay}</p>
							<p class="wlt-modal__warn">
								{flow.message ?? `Sent to ${flow.toLabel}.`}
							</p>
						</div>
					</div>
				)
				: (
					<div class="wlt-modal__body">
						<p class="wlt-modal__figure wlt-num">{flow.amountDisplay}</p>

						<dl class="wlt-modal__breakdown">
							<div class="wlt-modal__row">
								<dt class="wlt-modal__label">From</dt>
								<dd class="wlt-modal__value">{flow.fromLabel}</dd>
							</div>
							<div class="wlt-modal__row">
								<dt class="wlt-modal__label">To</dt>
								<dd class="wlt-modal__value">{flow.toLabel}</dd>
							</div>
							{flow.note && (
								<div class="wlt-modal__row">
									<dt class="wlt-modal__label">Note</dt>
									<dd class="wlt-modal__value">{flow.note}</dd>
								</div>
							)}
						</dl>

						<p class="wlt-modal__warn">
							{flow.kind === "distribute"
								? "Distributions cannot be reversed. Recipients are credited immediately and clear after 7 days."
								: "This cannot be reversed once confirmed."}
						</p>

						{flow.step === "error" && flow.message && (
							<Alert severity="danger">{flow.message}</Alert>
						)}
					</div>
				)}
		</Dialog>
	);
}
