import type { JSX } from "preact";
import "../styles/wallet.css";
import { Alert, Dialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { WalletService } from "../core/WalletService.ts";
import { viewHref } from "../core/capability.ts";
import {
	activeWallet,
	closeWalletAction,
	displayCurrency,
	type MoveFlowState,
	moveFlow,
	notifyWalletChanged,
} from "../core/wallet-state.ts";
import type { WalletActionResult } from "../types/wallet-types.ts";
import type { WalletResult } from "../types/results.ts";

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
 * "Try again" re-sends under the SAME idempotency key the composition was given, so a retry after a
 * response that never arrived answers with what the first request did rather than moving the money a
 * second time.
 *
 * The confirm button carries the exact amount (RULE O-2): a button reading "Confirm" asks the user to
 * remember what they typed; one reading "Transfer $2,400.00" does not.
 */

/** Send the composed movement to the service that performs it. */
function send(flow: MoveFlowState): Promise<WalletResult<{ result: WalletActionResult }>> {
	const display = displayCurrency.value || undefined;
	const target = { scope: flow.from.scope, contextId: flow.from.id, display };
	switch (flow.kind) {
		case "transfer":
			return WalletService.transfer({
				fromScope: flow.from.scope,
				fromId: flow.from.id,
				toScope: flow.to?.scope ?? "personal",
				toId: flow.to?.id ?? "",
				amountMinor: flow.amountMinor,
				currency: flow.currency,
				note: flow.note,
				display,
				idempotencyKey: flow.idempotencyKey,
			});
		case "distribute":
			return WalletService.distribute({
				...target,
				amountMinor: flow.amountMinor,
				currency: flow.currency,
				idempotencyKey: flow.idempotencyKey,
			});
		case "fund_escrow":
			return WalletService.fundEscrow({
				...target,
				stageId: flow.stageId ?? "",
				amountMinor: flow.amountMinor,
				currency: flow.currency,
			});
		case "withdraw":
			return WalletService.withdraw({
				...target,
				amountMinor: flow.amountMinor,
				currency: flow.currency,
				destinationId: null,
				instant: false,
			});
		case "top_up":
			return WalletService.topUp({
				...target,
				amountMinor: flow.amountMinor,
				currency: flow.currency,
				methodId: null,
			});
	}
}

/** What the commit button says, amount included. */
function verbOf(flow: MoveFlowState): string {
	switch (flow.kind) {
		case "distribute":
			return `Distribute ${flow.amountDisplay}${flow.recipients > 0 ? ` to ${flow.recipients} members` : ""}`;
		case "withdraw":
			return `Withdraw ${flow.amountDisplay}`;
		case "top_up":
			return `Top up ${flow.amountDisplay}`;
		case "fund_escrow":
			return `Fund ${flow.amountDisplay}`;
		case "transfer":
			return `Transfer ${flow.amountDisplay}`;
	}
}

/** The consequence stated before the commit — accurate to what the server will do. */
function warningOf(flow: MoveFlowState): string {
	switch (flow.kind) {
		case "distribute":
			return "Distributions cannot be reversed. Each member is credited immediately, by their agreed share.";
		case "fund_escrow":
			return "The amount moves from this wallet into escrow for the stage, and is released to the freelancer when their work is approved.";
		default:
			return "This cannot be reversed once confirmed.";
	}
}

export default function ConfirmMoveModal(): JSX.Element | null {
	const flow = moveFlow.value;
	if (!flow) return null;

	const close = () => {
		moveFlow.value = null;
		closeWalletAction();
	};

	const commit = async () => {
		moveFlow.value = { ...flow, step: "pending" };
		const res = await send(flow).catch(() => null);
		if (res?.ok) {
			moveFlow.value = { ...flow, step: "done", message: res.data?.result?.message ?? null };
			notifyWalletChanged();
			return;
		}
		moveFlow.value = {
			...flow,
			step: "error",
			message: res?.message ?? Object.values(res?.errors ?? {})[0] ??
				"We couldn't confirm this went through. Check the wallet's balance before trying again.",
		};
	};

	/*
	 * The action row goes through Dialog's `footer` slot, NOT children. As a child it landed inside the
	 * scrolling body, so on a short viewport the irreversible commit scrolled out of sight while the
	 * amount above it stayed visible. The slot is a sibling of the scroll region.
	 *
	 * The shared `Button`, not a local class. Variant is interaction weight, not styling (§B.8.1), and
	 * this overlay gets exactly one `filled`: the commit. Back and View transaction are `text` — the
	 * escape hatch and a navigation, neither of which is what this dialog is asking.
	 */
	const foot = flow.step === "done"
		? (
			<>
				{/* A navigation, so an anchor and a link — not a button wearing an href. */}
				<a class="wlt-link" href={viewHref("transactions", activeWallet.value)}>View transaction</a>
				<Button variant="filled" label="Done" onClick={close} />
			</>
		)
		: (
			<>
				<Button
					variant="text"
					label="Back"
					disabled={flow.step === "pending"}
					onClick={() => {
						moveFlow.value = null;
					}}
				/>
				<Button
					variant="filled"
					label={flow.step === "pending" ? "Sending…" : flow.step === "error" ? "Try again" : verbOf(flow)}
					disabled={flow.step === "pending"}
					onClick={() => void commit()}
				/>
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
							<p class="wlt-modal__warn">{flow.message ?? `Sent to ${flow.toLabel}.`}</p>
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

						<p class="wlt-modal__warn">{warningOf(flow)}</p>

						{flow.step === "error" && flow.message && <Alert severity="danger">{flow.message}</Alert>}
					</div>
				)}
		</Dialog>
	);
}
