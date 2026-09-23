import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/wallet.css";
import { Drawer, Message } from "@projective/ui/feedback";
import { Button, InputNumber, InputText, Select } from "@projective/ui/fields";
import { WalletIdCard } from "../components/WalletIdCard.tsx";
import { SplitPreview } from "../components/SplitPreview.tsx";
import { Money } from "../components/Money.tsx";
import { ACTION_LABEL } from "../core/capability.ts";
import { activeAction, closeWalletAction, type MoveEnd, moveFlow, newAttemptKey } from "../core/wallet-state.ts";
import { formatMoney, toMinorUnits } from "../types/wallet-types.ts";
import type {
	BusinessExtras,
	MoneyView,
	PaymentMethodView,
	TeamExtras,
	WalletAction,
	WalletRef,
	WalletScope,
} from "../types/wallet-types.ts";

/**
 * MoneyMoveDrawer — where a movement is COMPOSED, before the modal where it is committed.
 *
 * Splitting composition from confirmation is the whole reason this is a drawer and not a modal: a
 * drawer keeps the ledger legible behind it, so a user can check a balance against a row while
 * deciding an amount, and the irreversible step gets its own, deliberately more absolute, surface.
 *
 * **Amounts are entered in the wallet's OWN currency**, never the display currency. A movement is not
 * a conversion: a USD vault moves dollars whatever currency the page is drawn in, so the field is
 * labelled with the wallet's currency and converted to minor units with that currency's exponent.
 *
 * The client's arithmetic here is presentational only: it compares the entered amount to the
 * available balance so Continue can be blocked, and it formats what the user typed for the confirm
 * button's label. **It never computes a fee, a split, a rate, or a resulting balance** — every one
 * of those is the server's, because two implementations of split arithmetic eventually disagree,
 * and when they do it is a disagreement between two people about money.
 *
 * Funding escrow has no amount field at all: the stage's requirement is what its assigned tickets were
 * priced at, and the server refuses a figure that differs from the one shown here.
 */
export interface MoneyMoveDrawerProps {
	accounts: WalletRef[];
	available: MoneyView;
	methods?: PaymentMethodView[];
	team?: TeamExtras | null;
	/** Business extras, for the stages Fund escrow can fund. */
	business?: BusinessExtras | null;
	/** The acting wallet, for the From block and as the movement's source. */
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

/** A figure in the currency it is actually held in (the origin of a converted view). */
function own(view: MoneyView): { minor: number; currency: string } {
	return view.origin
		? { minor: view.origin.minor, currency: view.origin.currency.toUpperCase() }
		: { minor: view.minor, currency: view.currency.toUpperCase() };
}

/** The `scope:id` key a destination option carries. */
function keyOf(ref: { scope: string; id: string }): string {
	return `${ref.scope}:${ref.id}`;
}

/** Parse a destination option back into the wallet a mutation names. */
function endOf(key: string): MoveEnd {
	const at = key.indexOf(":");
	return { scope: key.slice(0, at) as WalletScope, id: key.slice(at + 1) };
}

export default function MoneyMoveDrawer(props: MoneyMoveDrawerProps): JSX.Element | null {
	const action = activeAction.value;
	const amount = useSignal<number>(0);
	const note = useSignal<string>("");
	const toId = useSignal<string>("");
	const stageId = useSignal<string>("");

	// A fresh composition for every action opened: an amount typed into Transfer must not reappear as a
	// pre-filled Distribute.
	useEffect(() => {
		amount.value = 0;
		note.value = "";
		toId.value = "";
		stageId.value = "";
	}, [action]);

	if (!action || !MOVE_ACTIONS.has(action)) return null;

	const holding = own(props.available);
	const currency = holding.currency;
	const fundable = props.business?.fundable ?? [];
	const stage = action === "fund_escrow" ? fundable.find((s) => s.stageId === stageId.value) ?? null : null;
	const stageOwn = stage ? own(stage.amount) : null;

	const minor = action === "fund_escrow" ? stageOwn?.minor ?? 0 : toMinorUnits(amount.value, currency) ?? 0;
	const exceeds = action !== "top_up" && minor > 0 && minor > holding.minor;
	// A transfer without a destination is not a composed movement, so it cannot proceed to the
	// confirmation — the modal's whole job is to state exactly where the money is going.
	const needsDestination = action === "transfer" && !toId.value;
	const needsStage = action === "fund_escrow" && !stage;
	const ready = minor > 0 && !exceeds && !needsDestination && !needsStage;

	const source = { scope: props.activeAccount.scope, id: props.activeAccount.id };
	const destinations = props.accounts.filter((a) => a.scope !== "aggregate" && keyOf(a) !== keyOf(source));
	const recipients = props.team?.splitRule.previewShares.length ?? 0;
	const toLabel = action === "transfer"
		? destinations.find((a) => keyOf(a) === toId.value)?.name ?? "another wallet"
		: action === "withdraw"
		? "your bank"
		: action === "distribute"
		? `${recipients} ${recipients === 1 ? "member" : "members"}`
		: action === "fund_escrow"
		? stage ? `${stage.stageName} · ${stage.projectTitle}` : "escrow"
		: props.activeAccount.name;

	const proceed = () => {
		const moveCurrency = action === "fund_escrow" && stageOwn ? stageOwn.currency : currency;
		moveFlow.value = {
			kind: action as "transfer" | "withdraw" | "top_up" | "fund_escrow" | "distribute",
			step: "confirm",
			amountDisplay: formatMoney(minor, moveCurrency),
			amountMinor: minor,
			currency: moveCurrency,
			from: source as MoveEnd,
			to: action === "transfer" ? endOf(toId.value) : null,
			stageId: action === "fund_escrow" ? stageId.value : null,
			fromLabel: action === "top_up" ? "your funding method" : props.activeAccount.name,
			toLabel,
			note: action === "transfer" ? note.value.trim() || null : null,
			idempotencyKey: newAttemptKey(),
			message: null,
			recipients,
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

				{action === "transfer" && (
					<section class="wlt-drawer__section">
						<h3 class="wlt-drawer__sectitle wlt-label">To</h3>
						{destinations.length > 0
							? (
								<div class="wlt-formfield">
									<Select
										options={destinations.map((a) => ({ label: a.name, value: keyOf(a) }))}
										value={toId.value}
										placeholder="Choose a wallet"
										aria-label="Destination wallet"
										onValueChange={(v) => {
											if (typeof v === "string") toId.value = v;
										}}
									/>
								</div>
							)
							: <p class="wlt-prose wlt-drawer__note">You have no other wallet to move money to.</p>}
					</section>
				)}

				{action === "fund_escrow" && (
					<section class="wlt-drawer__section">
						<h3 class="wlt-drawer__sectitle wlt-label">Stage</h3>
						{fundable.length > 0
							? (
								<div class="wlt-formfield">
									<Select
										options={fundable.map((s) => ({
											label: `${s.stageName} · ${s.projectTitle}`,
											value: s.stageId,
										}))}
										value={stageId.value}
										placeholder="Choose a stage"
										aria-label="Stage to fund"
										onValueChange={(v) => {
											if (typeof v === "string") stageId.value = v;
										}}
									/>
								</div>
							)
							: <p class="wlt-prose wlt-drawer__note">No assigned stage is waiting for its escrow.</p>}
						{stage && (
							<p class="wlt-prose wlt-drawer__note">
								{stage.ticketCount} {stage.ticketCount === 1 ? "ticket" : "tickets"}{" "}
								at their agreed prices. Funding commits exactly what the work was priced at.
							</p>
						)}
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
					{action === "fund_escrow"
						? (
							<p class="wlt-drawer__figure">
								{stage ? <Money value={stage.amount} size="body" /> : "Choose a stage to see its amount."}
							</p>
						)
						: (
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
						)}
					<p class="wlt-drawer__available">
						Available <Money value={props.available} size="body" showFx={false} />
					</p>
					{exceeds && <Message severity="warning">That is more than this wallet holds.</Message>}
					{needsDestination && minor > 0 && destinations.length > 0 && (
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
