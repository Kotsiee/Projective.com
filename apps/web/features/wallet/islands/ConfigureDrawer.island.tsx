import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/wallet.css";
import { Drawer, Message } from "@projective/ui/feedback";
import { Button, InputNumber, InputText, Select, SelectButton } from "@projective/ui/fields";
import { Money } from "../components/Money.tsx";
import { ACTION_LABEL } from "../core/capability.ts";
import { WalletService } from "../core/WalletService.ts";
import {
	actionTarget,
	activeAction,
	closeWalletAction,
	currentWalletContext,
	notifyWalletChanged,
} from "../core/wallet-state.ts";
import type {
	MoneyView,
	PaymentMethodView,
	PersonalExtras,
	WalletAction,
} from "../types/wallet-types.ts";

/**
 * ConfigureDrawer — where the five CONFIGURATION actions are performed.
 *
 * {@link MoneyMoveDrawer} composes the five actions that MOVE money and hands them to a confirmation
 * modal that deliberately removes the escape route. These five change a standing arrangement instead:
 * a recurring deposit, a saved instrument, a payout cadence, an income target, a spend request. They
 * are reversible, so they commit from here directly — a confirmation step for a reversible setting is
 * the interruption-for-its-own-sake pattern the surface avoids everywhere else.
 *
 * It exists because all five were reachable in *code* and nowhere in the *interface*: the labels,
 * capability requirements, glyphs and `WalletService` methods all shipped, `MoneyMoveDrawer` returned
 * `null` for every one of them, and it was the only consumer of `activeAction`. So the Methods page
 * could not add a method, the Payouts page could not change the schedule it described as changeable,
 * an eligible Income Smoother could not be enrolled in, and "New recurring" — visible in the footer
 * rig on four pages — opened nothing at all.
 *
 * **Add method collects no card data, by construction.** Card details are collected and held by
 * Stripe and never touch our servers, so this drawer has no PAN field, no expiry, no CVV: it captures
 * the role and the label we actually store, then hands off. An input that looks like it takes a card
 * number would be a claim about custody that the rest of this surface spends its whole design
 * refusing to make.
 */
export interface ConfigureDrawerProps {
	/** Saved instruments, for the recurring source and the payout destination. */
	methods: PaymentMethodView[];
	/** The acting wallet's available balance, shown where an amount is being set against it. */
	available: MoneyView;
	/** Personal extras, for the Smoother's eligibility copy and fee. */
	personal?: PersonalExtras | null;
}

/** The five actions this drawer configures. Everything else is movement, and belongs to the other one. */
const CONFIG_ACTIONS: ReadonlySet<WalletAction> = new Set([
	"new_recurring",
	"add_method",
	"set_payout",
	"request_spend",
	"enrol_smoother",
]);

const INTERVALS = [
	{ label: "Weekly", value: "weekly" },
	{ label: "Monthly", value: "monthly" },
];

const PAYOUT_MODES = [
	{ label: "Manual", value: "manual" },
	{ label: "Weekly", value: "scheduled_weekly" },
	{ label: "Monthly", value: "scheduled_monthly" },
	{ label: "At a threshold", value: "threshold" },
];

const METHOD_ROLES = [
	{ label: "Paying in", value: "funding" },
	{ label: "Getting paid", value: "payout" },
	{ label: "Both", value: "both" },
];

function methodLabel(m: PaymentMethodView): string {
	const name = m.label ?? m.brand ?? m.provider;
	return m.last4 ? `${name} ·· ${m.last4}` : name;
}

export default function ConfigureDrawer(props: ConfigureDrawerProps): JSX.Element | null {
	const action = activeAction.value;

	const amount = useSignal<number>(0);
	const interval = useSignal<string>("monthly");
	const sourceId = useSignal<string>("");
	const role = useSignal<string>("funding");
	const label = useSignal<string>("");
	const mode = useSignal<string>("scheduled_weekly");
	const destinationId = useSignal<string>("");
	const reason = useSignal<string>("");
	const busy = useSignal<boolean>(false);
	const error = useSignal<string | null>(null);

	if (!action || !CONFIG_ACTIONS.has(action)) return null;

	const ctx = currentWalletContext();
	const target = actionTarget.value ?? { scope: "personal", contextId: "" };
	const currency = props.available.currency;
	const base = {
		scope: target.scope as never,
		contextId: target.contextId,
		display: ctx.display ?? undefined,
	};

	const fundingMethods = props.methods.filter((m) => m.methodRole !== "payout");
	const payoutMethods = props.methods.filter((m) => m.methodRole !== "funding");
	const smoother = props.personal?.incomeSmoother ?? null;
	const needsThreshold = action === "set_payout" && mode.value === "threshold";

	const ready = action === "add_method"
		? true
		: action === "set_payout"
		? !needsThreshold || amount.value > 0
		: action === "request_spend"
		? amount.value > 0 && reason.value.trim().length > 0
		: amount.value > 0;

	const commit = async () => {
		busy.value = true;
		error.value = null;
		const minor = Math.round(amount.value * 100);
		const res = action === "new_recurring"
			? await WalletService.addRecurring({
				...base,
				amountMinor: minor,
				currency,
				interval: interval.value as never,
				sourceMethodId: sourceId.value || null,
			})
			: action === "add_method"
			? await WalletService.addMethod({
				...base,
				methodRole: role.value as never,
				provider: "stripe",
				/* The opaque handle a real Stripe Elements session returns. There is no card data here
				   to tokenize, which is the point — see the class docstring. */
				token: "XXXX-XXXX",
				label: label.value || null,
			})
			: action === "set_payout"
			? await WalletService.setPayout({
				...base,
				mode: mode.value as never,
				thresholdMinor: needsThreshold ? minor : null,
				destinationId: destinationId.value || null,
				instant: false,
			})
			: action === "request_spend"
			? await WalletService.requestSpend({
				...base,
				amountMinor: minor,
				currency,
				reason: reason.value.trim(),
			})
			: await WalletService.enrolSmoother({
				targetMonthlyMinor: minor,
				currency,
				display: ctx.display ?? undefined,
			});

		busy.value = false;
		if (res.ok) {
			notifyWalletChanged();
			closeWalletAction();
			return;
		}
		/*
		 * The server names the problem and the drawer stays open holding what the user typed — a
		 * failed save that also loses the input makes the user pay twice for one fault. The fallback
		 * says what did NOT happen, because "something went wrong" leaves them unsure whether the
		 * money moved.
		 */
		error.value = res.message ?? Object.values(res.errors ?? {})[0] ??
			"That did not save. Nothing has changed.";
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
				{action === "add_method" && (
					<>
						<section class="wlt-drawer__section">
							<h3 class="wlt-drawer__sectitle wlt-label">What it is for</h3>
							<SelectButton
								options={METHOD_ROLES}
								value={role.value}
								aria-label="What this method is for"
								onValueChange={(v) => {
									if (typeof v === "string") role.value = v;
								}}
							/>
						</section>
						<section class="wlt-drawer__section">
							<h3 class="wlt-drawer__sectitle wlt-label">Name it</h3>
							<div class="wlt-formfield">
								<InputText
									value={label.value}
									placeholder="Business card"
									aria-label="Method name"
									onValueChange={(v) => {
										label.value = v;
									}}
								/>
							</div>
							<p class="wlt-prose wlt-drawer__note">
								Card details are collected and held by Stripe. Projective stores only the brand, the
								last four digits, your name for it, and whether it is active.
							</p>
						</section>
					</>
				)}

				{action === "new_recurring" && (
					<>
						<section class="wlt-drawer__section">
							<h3 class="wlt-drawer__sectitle wlt-label">How often</h3>
							<SelectButton
								options={INTERVALS}
								value={interval.value}
								aria-label="Deposit interval"
								onValueChange={(v) => {
									if (typeof v === "string") interval.value = v;
								}}
							/>
						</section>
						{fundingMethods.length > 0 && (
							<section class="wlt-drawer__section">
								<h3 class="wlt-drawer__sectitle wlt-label">From</h3>
								<div class="wlt-formfield">
									<Select
										options={fundingMethods.map((m) => ({ label: methodLabel(m), value: m.id }))}
										value={sourceId.value}
										placeholder="Your default funding method"
										aria-label="Funding method"
										onValueChange={(v) => {
											if (typeof v === "string") sourceId.value = v;
										}}
									/>
								</div>
							</section>
						)}
					</>
				)}

				{action === "set_payout" && (
					<>
						<section class="wlt-drawer__section">
							<h3 class="wlt-drawer__sectitle wlt-label">When money leaves</h3>
							<SelectButton
								options={PAYOUT_MODES}
								value={mode.value}
								aria-label="Payout frequency"
								onValueChange={(v) => {
									if (typeof v === "string") mode.value = v;
								}}
							/>
						</section>
						{payoutMethods.length > 0 && (
							<section class="wlt-drawer__section">
								<h3 class="wlt-drawer__sectitle wlt-label">To</h3>
								<div class="wlt-formfield">
									<Select
										options={payoutMethods.map((m) => ({ label: methodLabel(m), value: m.id }))}
										value={destinationId.value}
										placeholder="Your default payout destination"
										aria-label="Payout destination"
										onValueChange={(v) => {
											if (typeof v === "string") destinationId.value = v;
										}}
									/>
								</div>
							</section>
						)}
					</>
				)}

				{action === "enrol_smoother" && smoother && (
					<section class="wlt-drawer__section">
						<p class="wlt-prose">
							Smoothing buffers what you earn into a steadier monthly figure. The fee is{" "}
							{(smoother.feeBp / 100).toFixed(1)}% of buffered income.
						</p>
					</section>
				)}

				{/* One amount field, labelled for whatever the action is setting. */}
				{(action !== "add_method" && !(action === "set_payout" && !needsThreshold)) && (
					<section class="wlt-drawer__section">
						<h3 class="wlt-drawer__sectitle wlt-label">
							{action === "new_recurring"
								? "How much, each time"
								: action === "set_payout"
								? "Pay out once it reaches"
								: action === "enrol_smoother"
								? "Target each month"
								: "How much"}
						</h3>
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
						{action === "request_spend" && (
							<p class="wlt-drawer__available">
								This vault holds <Money value={props.available} size="body" showFx={false} />
							</p>
						)}
					</section>
				)}

				{action === "request_spend" && (
					<section class="wlt-drawer__section">
						<h3 class="wlt-drawer__sectitle wlt-label">What it is for</h3>
						<div class="wlt-formfield">
							<InputText
								value={reason.value}
								placeholder="Contractor invoice, March"
								aria-label="Reason for the request"
								onValueChange={(v) => {
									reason.value = v;
								}}
							/>
						</div>
						<p class="wlt-prose wlt-drawer__note">
							An approver sees this alongside the amount, so say what the money is for.
						</p>
					</section>
				)}

				{error.value && <Message severity="danger">{error.value}</Message>}
			</div>

			<footer class="wlt-drawer__foot">
				<Button variant="text" label="Cancel" onClick={closeWalletAction} />
				<Button
					variant="filled"
					label={busy.value
						? "Saving…"
						: action === "add_method"
						? "Continue to Stripe"
						: action === "request_spend"
						? "Send request"
						: "Save"}
					loading={busy.value}
					disabled={!ready || busy.value}
					onClick={() => void commit()}
				/>
			</footer>
		</Drawer>
	);
}
