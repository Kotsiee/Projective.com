import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Drawer, Message } from "@projective/ui/feedback";
import { Button, InputNumber, InputText, Select } from "@projective/ui/fields";
import { WalletIdCard } from "../components/WalletIdCard.tsx";
import { SplitPreview } from "../components/SplitPreview.tsx";
import { Money } from "../components/Money.tsx";
import { ACTION_LABEL } from "../core/capability.ts";
import {
	activeAction,
	closeWalletAction,
	currentWalletContext,
	moveFlow,
} from "../core/wallet-state.ts";
import { formatMoney } from "../types/wallet-types.ts";
import type {
	MoneyView,
	PaymentMethodView,
	TeamExtras,
	WalletAction,
	WalletRef,
} from "../types/wallet-types.ts";

/**
 * MoneyMoveDrawer — where a movement is COMPOSED, before the modal where it is committed.
 *
 * Splitting composition from confirmation is the whole reason this is a drawer and not a modal: a
 * drawer keeps the ledger legible behind it, so a user can check a balance against a row while
 * deciding an amount, and the irreversible step gets its own, deliberately more absolute, surface.
 *
 * The client's arithmetic here is presentational only: it compares the entered amount to the
 * available balance so Continue can be blocked, and it formats what the user typed for the confirm
 * button's label. **It never computes a fee, a split, a rate, or a resulting balance** — every one
 * of those is the server's, because two implementations of split arithmetic eventually disagree,
 * and when they do it is a disagreement between two people about money.
 */
export interface MoneyMoveDrawerProps {
	accounts: WalletRef[];
	available: MoneyView;
	methods?: PaymentMethodView[];
	team?: TeamExtras | null;
	/** The acting wallet's display name, for the From block. */
	activeAccount: WalletRef;
}

/** The five actions this drawer composes. Everything else is configuration, not movement. */
const MOVE_ACTIONS: ReadonlySet<WalletAction> = new Set([
	"top_up",
	"withdraw",
	"transfer",
	"distribute",
	"fund_escrow",
]);

export default function MoneyMoveDrawer(props: MoneyMoveDrawerProps): JSX.Element | null {
	const action = activeAction.value;
	const amount = useSignal<number>(0);
	const note = useSignal<string>("");
	const toId = useSignal<string>("");

	if (!action || !MOVE_ACTIONS.has(action)) return null;

	const currency = props.available.currency;
	const exceeds = action !== "top_up" && amount.value > 0 &&
		Math.round(amount.value * 100) > props.available.minor;
	// A transfer without a destination is not a composed movement, so it cannot proceed to the
	// confirmation — the modal's whole job is to state exactly where the money is going.
	const needsDestination = action === "transfer" && !toId.value;
	const ready = amount.value > 0 && !exceeds && !needsDestination;

	const destinations = props.accounts.filter((a) =>
		`${a.scope}:${a.id}` !== `${props.activeAccount.scope}:${props.activeAccount.id}`
	);
	const toLabel = action === "transfer"
		? destinations.find((a) => `${a.scope}:${a.id}` === toId.value)?.name ?? "another wallet"
		: action === "withdraw"
		? "your bank"
		: action === "distribute"
		? `${props.team?.splitRule.previewShares.length ?? 0} members`
		: action === "fund_escrow"
		? "escrow"
		: props.activeAccount.name;

	const proceed = () => {
		const minor = Math.round(amount.value * 100);
		moveFlow.value = {
			kind: action === "fund_escrow" ? "fund_escrow" : action as never,
			step: "confirm",
			amountDisplay: formatMoney(minor, currency),
			amountMinor: minor,
			currency,
			fromLabel: action === "top_up" ? "your funding method" : props.activeAccount.name,
			toLabel,
			note: note.value || null,
			message: null,
			recipients: props.team?.splitRule.previewShares.length ?? 0,
		};
	};

	return (
		<Drawer
			visible
			position="right"
			class="wlt-drawer"
			header={ACTION_LABEL[action]}
			onVisibleChange={(v) => {
				if (!v) closeWalletAction();
			}}
		>
			<div class="wlt-drawer__body">
				<section class="wlt-drawer__section">
					<h3 class="wlt-drawer__sectitle wlt-label">From</h3>
					<WalletIdCard account={props.activeAccount} size="md" readonly />
				</section>

				{action === "transfer" && destinations.length > 0 && (
					<section class="wlt-drawer__section">
						<h3 class="wlt-drawer__sectitle wlt-label">To</h3>
						<div class="wlt-formfield">
							<Select
								options={destinations.map((a) => ({
									label: a.name,
									value: `${a.scope}:${a.id}`,
								}))}
								value={toId.value}
								placeholder="Choose a wallet"
								aria-label="Destination wallet"
								onValueChange={(v) => {
									if (typeof v === "string") toId.value = v;
								}}
							/>
						</div>
					</section>
				)}

				{action === "distribute" && props.team && (
					<section class="wlt-drawer__section">
						<h3 class="wlt-drawer__sectitle wlt-label">How it divides</h3>
						<SplitPreview team={props.team} />
					</section>
				)}

				<section class="wlt-drawer__section">
					<h3 class="wlt-drawer__sectitle wlt-label">Amount</h3>
					<div class="wlt-formfield">
						<InputNumber
							value={amount.value}
							min={0}
							aria-label={`Amount in ${currency}`}
							onValueChange={(v) => {
								amount.value = typeof v === "number" ? v : 0;
							}}
						/>
					</div>
					<p class="wlt-drawer__available">
						Available <Money value={props.available} size="body" showFx={false} />
					</p>
					{exceeds && <Message severity="warning">That is more than this wallet holds.</Message>}
					{needsDestination && amount.value > 0 && (
						<Message severity="warning">Choose a destination wallet.</Message>
					)}
				</section>

				{action === "transfer" && (
					<section class="wlt-drawer__section">
						<h3 class="wlt-drawer__sectitle wlt-label">Note</h3>
						<div class="wlt-formfield">
							<InputText
								value={note.value}
								placeholder="Optional"
								aria-label="Transfer note"
								onValueChange={(v) => {
									note.value = v;
								}}
							/>
						</div>
					</section>
				)}
			</div>

			<footer class="wlt-drawer__foot">
				<Button variant="text" label="Cancel" onClick={closeWalletAction} />
				<Button variant="filled" label="Continue" disabled={!ready} onClick={proceed} />
			</footer>
		</Drawer>
	);
}
