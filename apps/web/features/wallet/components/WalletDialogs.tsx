import type { ComponentChildren, JSX, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { Alert, Dialog } from "@projective/ui/feedback";
import {
	Button,
	FormControl,
	InputNumber,
	InputText,
	Select,
	SelectButton,
	Textarea,
} from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { useIsMobile } from "@projective/ui/hooks";
import { MoneyView } from "@projective/ui/display/money";
import { profileHref } from "@features/projects/core/routing.ts";
import { type WalletContext, WalletService } from "../core/WalletService.ts";
import { closeWalletDialog, newAttemptKey, walletDialog } from "../core/wallet-state.ts";
import { methodName, MOVEMENTS, type ResolvedAction } from "../core/wallet-home.ts";
import {
	ACTION_LABEL,
	categoryLabel,
	fundStateLabel,
	heldIn,
	isElsewhere,
} from "../core/wallet-model.ts";
import { formatMoney, toMajorUnits, toMinorUnits } from "../types/wallet-types.ts";
import type {
	FundableStage,
	LedgerLine,
	PaymentMethodView,
	PayoutDestination,
	PayoutScheduleView,
	SpendApprovalView,
	WalletAction,
	WalletActionResult,
	WalletOverview,
	WalletScope,
	WalletSwitcher,
} from "../types/wallet-types.ts";
import type { WalletResult } from "../types/results.ts";
import { incomeSmootherFeeMinor, type WalletCardHandoff } from "@projective/types/finance";
import { StripeElementPanel } from "@features/payments/components/StripeElementPanel.tsx";
import { PaymentsService } from "@features/payments/core/PaymentsService.ts";
import { ActionIcon, CategoryIcon } from "./wallet-glyphs.tsx";

/** The data every wallet dialog draws from. */
export interface WalletDialogData {
	overview: WalletOverview;
	switcher: WalletSwitcher;
	methods: PaymentMethodView[];
	destinations: PayoutDestination[];
	/** The current payout schedule, which its editor opens on. */
	schedule: PayoutScheduleView | null;
	approvals: SpendApprovalView[];
	query: WalletContext;
}

/** Props for {@link WalletDialogs}. */
export interface WalletDialogsProps extends WalletDialogData {
	resolve: (action: WalletAction) => ResolvedAction;
	/** A write succeeded; the refreshed overview, when the server returned one. */
	onChanged: (overview: WalletOverview | null) => void;
}

type Position = "center" | "bottom";
type Outcome = WalletResult<{ result: WalletActionResult & WalletCardHandoff }>;
type Problems<F extends string> = Partial<Record<F, string>>;

const EXIT_MS = 300;

function useClosing(id: number) {
	const shown = useSignal(true);
	const release = () => setTimeout(() => closeWalletDialog(id), EXIT_MS);
	return {
		shown,
		close: () => {
			shown.value = false;
			release();
		},
		onVisibleChange: (v: boolean) => {
			if (!v) release();
		},
	};
}

function Frame(
	props: {
		id: number;
		title: string;
		position: Position;
		footer: VNode;
		role?: "dialog" | "alertdialog";
		focusRef?: { current: HTMLElement | null };
		closing: ReturnType<typeof useClosing>;
		children: ComponentChildren;
	},
): JSX.Element {
	return (
		<Dialog
			visible={props.closing.shown}
			header={props.title}
			footer={<div class="wlt-dlg__foot">{props.footer}</div>}
			position={props.position}
			width="var(--overlay-w-sm)"
			role={props.role}
			initialFocusRef={props.focusRef}
			class="wlt-dlg"
			onVisibleChange={props.closing.onVisibleChange}
		>
			<div class="wlt-dlg__body">{props.children}</div>
		</Dialog>
	);
}

function refuse(found: object, form: HTMLElement | null): boolean {
	if (Object.keys(found).length === 0) return false;
	setTimeout(() => form?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
	return true;
}

function failureOf(res: Outcome | null): string {
	return res?.message ?? Object.values(res?.errors ?? {})[0] ??
		"We couldn't confirm this went through. Check the balance before trying again.";
}

function refKey(scope: string, id: string): string {
	return `${scope}:${id}`;
}

function parseKey(key: string): { scope: WalletScope; id: string } {
	const at = key.indexOf(":");
	return { scope: key.slice(0, at) as WalletScope, id: key.slice(at + 1) };
}

function Done({ amount, message }: { amount: string | null; message: string | null }): JSX.Element {
	return (
		<div class="wlt-dlg__done" role="status">
			<span class="wlt-dlg__donemark" aria-hidden="true">
				<Icon name="check" size="md" />
			</span>
			{amount && <p class="wlt-dlg__amount">{amount}</p>}
			<p class="wlt-dlg__lead">{message ?? "Done."}</p>
		</div>
	);
}

// #region Locked
function LockedDialog(
	{ id, item, position }: { id: number; item: ResolvedAction; position: Position },
) {
	const closing = useClosing(id);
	return (
		<Frame
			id={id}
			title={item.label}
			position={position}
			closing={closing}
			footer={
				<>
					{item.fixHref && <a class="wlt-textlink" href={item.fixHref}>{item.fixLabel}</a>}
					<Button variant="filled" label="Got it" onClick={closing.close} />
				</>
			}
		>
			<div class="wlt-dlg__locked">
				<span class="wlt-dlg__mark" aria-hidden="true">
					<ActionIcon action={item.action} size="md" />
					<Icon name="lock" class="wlt-dlg__lock" />
				</span>
				<p class="wlt-dlg__lead">{item.reason ?? "This isn't available right now."}</p>
			</div>
		</Frame>
	);
}
// #endregion

// #region Movements
/**
 * `card` — the Payment Element is on screen for a top-up's PaymentIntent; `settling` — Stripe accepted
 * the card and the dialog is waiting for the signed webhook to credit the wallet (never assumed).
 */
type MoveStep = "compose" | "review" | "sending" | "card" | "settling" | "done" | "error";

const CONSEQUENCE: Readonly<Partial<Record<WalletAction, string>>> = {
	distribute: "Each member is credited immediately by their agreed share. This can't be reversed.",
	fund_escrow:
		"The amount moves into escrow for the stage and is released to the freelancer when their work is approved.",
	withdraw:
		"The money leaves Projective for your payout account, which pays it to your bank. This can't be reversed.",
	transfer: "The money moves between your wallets straight away. This can't be reversed.",
	top_up: "You'll enter a card next. The amount is added to this wallet once the payment clears.",
};

function MoveDialog(
	props: WalletDialogData & {
		id: number;
		action: WalletAction;
		stageId?: string;
		position: Position;
		onChanged: (overview: WalletOverview | null) => void;
	},
): JSX.Element {
	const { overview, switcher, action } = props;
	const closing = useClosing(props.id);
	const step = useSignal<MoveStep>("compose");
	const amount = useSignal<number | null>(null);
	const destination = useSignal("");
	const method = useSignal("");
	const stageId = useSignal(props.stageId ?? "");
	const note = useSignal("");
	const problems = useSignal<Problems<"amount" | "to" | "stage">>({});
	const outcome = useSignal<string | null>(null);
	const handoff = useSignal<WalletCardHandoff["payment"] | null>(null);
	const attempt = useRef("");
	const formRef = useRef<HTMLDivElement>(null);

	const held = heldIn(overview.available);
	const fundable: FundableStage[] = overview.business?.fundable ?? [];
	const stage = fundable.find((s) => s.stageId === stageId.value) ?? null;
	const currency = action === "fund_escrow" && stage
		? heldIn(stage.amount).currency
		: held.currency;
	const minor = action === "fund_escrow"
		? (stage ? heldIn(stage.amount).minor : 0)
		: (toMinorUnits(amount.value, currency) ?? 0);
	const figure = formatMoney(minor, currency);

	const source = { scope: overview.ref.scope, id: overview.ref.id };
	const walletName = overview.ref.scope === "personal" ? "Your wallet" : overview.ref.name;
	const accounts = switcher.accounts.filter((a) =>
		refKey(a.scope, a.id) !== refKey(source.scope, source.id) &&
		heldIn(a.available).currency === held.currency
	);
	const members = overview.team?.members ?? [];

	const toLabel = action === "transfer"
		? accounts.find((a) => refKey(a.scope, a.id) === destination.value)?.name ?? "another wallet"
		: action === "withdraw"
		? props.destinations.find((d) => d.id === method.value)?.label ?? "your default payout account"
		: action === "distribute"
		? `${members.length} ${members.length === 1 ? "member" : "members"}`
		: action === "fund_escrow"
		? (stage ? `${stage.stageName} · ${stage.projectTitle}` : "escrow")
		: walletName;
	const fromLabel = action === "top_up" ? "A card you enter next" : walletName;

	const review = () => {
		const found: Problems<"amount" | "to" | "stage"> = {};
		if (action === "fund_escrow" && !stage) found.stage = "Choose a stage to fund.";
		if (action === "transfer" && !destination.value) found.to = "Choose where the money is going.";
		if (action !== "fund_escrow" && minor <= 0) found.amount = "Enter an amount.";
		else if (action !== "top_up" && minor > held.minor) {
			found[action === "fund_escrow" ? "stage" : "amount"] = "That's more than this wallet holds.";
		}
		problems.value = found;
		if (refuse(found, formRef.current)) return;
		attempt.current = newAttemptKey();
		step.value = "review";
	};
	const errorFor = (field: "amount" | "to" | "stage") => problems.value[field];

	const send = (): Promise<Outcome> => {
		const display = props.query.display ?? undefined;
		const target = { scope: source.scope, contextId: source.id, display };
		switch (action) {
			case "transfer": {
				const to = parseKey(destination.value);
				return WalletService.transfer({
					fromScope: source.scope,
					fromId: source.id,
					toScope: to.scope,
					toId: to.id,
					amountMinor: minor,
					currency,
					note: note.value.trim() || null,
					display,
					idempotencyKey: attempt.current,
				});
			}
			case "distribute":
				return WalletService.distribute({
					...target,
					amountMinor: minor,
					currency,
					idempotencyKey: attempt.current,
				});
			case "fund_escrow":
				return WalletService.fundEscrow({
					...target,
					stageId: stageId.value,
					amountMinor: minor,
					currency,
				});
			case "withdraw":
				return WalletService.withdraw({
					...target,
					amountMinor: minor,
					currency,
					destinationId: method.value || null,
					instant: false,
					idempotencyKey: attempt.current,
				});
			default:
				return WalletService.topUp({
					...target,
					amountMinor: minor,
					currency,
					methodId: null,
					idempotencyKey: attempt.current,
				});
		}
	};

	const commit = async () => {
		step.value = "sending";
		const res = await send().catch(() => null);
		if (res?.ok && action === "top_up" && res.data?.result?.payment) {
			// Nothing has been charged yet: the card is entered in Stripe's Element next.
			handoff.value = res.data.result.payment;
			step.value = "card";
			return;
		}
		if (res?.ok) {
			outcome.value = res.data?.result?.message ?? res.message ?? null;
			step.value = "done";
			props.onChanged(res.data?.result?.overview ?? null);
			return;
		}
		outcome.value = failureOf(res);
		step.value = "error";
	};

	/**
	 * Stripe accepted the card; the wallet is credited only when the signed webhook settles the payment,
	 * so wait for THAT, then re-read the wallet. A slow webhook is said out loud, never papered over.
	 */
	const settle = async (paymentId: string) => {
		step.value = "settling";
		const settled = await PaymentsService.waitForSettlement(paymentId);
		const fresh = await WalletService.overview(props.query).catch(() => null);
		if (fresh?.ok && fresh.data) props.onChanged(fresh.data.overview);
		if (settled === "failed") {
			outcome.value = "The payment didn't go through. Nothing was added to your wallet.";
			step.value = "error";
			return;
		}
		outcome.value = settled === "succeeded"
			? "Added to your wallet."
			: "Your bank accepted the payment. It will appear in your wallet as soon as it clears.";
		step.value = "done";
	};

	// A top-up's review step charges nothing yet — the card is entered next — so it says so.
	const verb = action === "top_up" ? "Continue to payment" : `${ACTION_LABEL[action]} ${figure}`;
	const footer = step.value === "compose"
		? (
			<>
				<Button variant="text" label="Cancel" onClick={closing.close} />
				<Button variant="filled" label="Continue" onClick={review} />
			</>
		)
		: step.value === "done"
		? <Button variant="filled" label="Done" onClick={closing.close} />
		: step.value === "card" || step.value === "settling"
		? (
			<Button
				variant="text"
				label="Cancel"
				disabled={step.value === "settling"}
				onClick={closing.close}
			/>
		)
		: (
			<>
				<Button
					variant="text"
					label="Back"
					disabled={step.value === "sending"}
					onClick={() => {
						step.value = "compose";
					}}
				/>
				<Button
					variant="filled"
					label={step.value === "error" ? "Try again" : verb}
					loading={step.value === "sending"}
					disabled={step.value === "sending"}
					onClick={() => void commit()}
				/>
			</>
		);

	return (
		<Frame
			id={props.id}
			title={ACTION_LABEL[action]}
			position={props.position}
			closing={closing}
			focusRef={formRef}
			footer={footer}
		>
			{step.value === "compose" && (
				<div class="wlt-form" ref={formRef}>
					<dl class="wlt-dlg__facts">
						<div class="wlt-dlg__fact">
							<dt>{action === "top_up" ? "Into" : "From"}</dt>
							<dd>
								{walletName}
								<span class="wlt-dlg__sub">
									<MoneyView value={overview.available} size="micro" /> available
								</span>
							</dd>
						</div>
					</dl>

					{action === "transfer" && (
						<FormControl
							label="To"
							hint={accounts.length === 0
								? `You have no other ${held.currency} wallet.`
								: undefined}
							error={errorFor("to")}
							status={errorFor("to") ? "invalid" : "default"}
						>
							{({ id, describedBy, status }) => (
								<Select
									id={id}
									aria-describedby={describedBy}
									status={status}
									options={accounts.map((a) => ({
										label: a.scope === "personal" ? "Your wallet" : a.name,
										value: refKey(a.scope, a.id),
									}))}
									value={destination.value}
									placeholder="Choose a wallet"
									disabled={accounts.length === 0}
									fluid
									onValueChange={(v) => {
										destination.value = v;
									}}
								/>
							)}
						</FormControl>
					)}

					{action === "withdraw" && props.destinations.length > 0 && (
						<FormControl label="To">
							{({ id }) => (
								<Select
									id={id}
									options={props.destinations.map((d) => ({ label: d.label, value: d.id }))}
									value={method.value}
									placeholder="Your default payout account"
									fluid
									onValueChange={(v) => {
										method.value = v;
									}}
								/>
							)}
						</FormControl>
					)}

					{action === "fund_escrow" && (
						<FormControl
							label="Stage"
							hint={stage
								? `${stage.ticketCount} ${
									stage.ticketCount === 1 ? "ticket" : "tickets"
								} at their agreed prices`
								: fundable.length === 0
								? "No assigned stage is waiting for its escrow."
								: undefined}
							error={errorFor("stage")}
							status={errorFor("stage") ? "invalid" : "default"}
						>
							{({ id, describedBy, status }) => (
								<Select
									id={id}
									aria-describedby={describedBy}
									status={status}
									options={fundable.map((s) => ({
										label: `${s.stageName} · ${s.projectTitle}`,
										value: s.stageId,
									}))}
									value={stageId.value}
									placeholder="Choose a stage"
									fluid
									onValueChange={(v) => {
										stageId.value = v;
									}}
								/>
							)}
						</FormControl>
					)}

					{action === "fund_escrow"
						? stage && (
							<p class="wlt-dlg__amountline">
								<MoneyView value={stage.amount} size="figure" />
							</p>
						)
						: (
							<FormControl
								label={`Amount (${currency})`}
								error={errorFor("amount")}
								status={errorFor("amount") ? "invalid" : "default"}
							>
								{({ id, describedBy, status }) => (
									<InputNumber
										id={id}
										aria-describedby={describedBy}
										status={status}
										value={amount.value}
										min={0}
										mode="currency"
										currency={currency}
										fluid
										onValueChange={(v) => {
											amount.value = v;
										}}
									/>
								)}
							</FormControl>
						)}

					{action === "distribute" && members.length > 0 && (
						<div class="wlt-dlg__split">
							<p class="wlt-dlg__splithead">Split by agreed stakes</p>
							<ul class="wlt-dlg__members">
								{members.map((m) => (
									<li key={m.userId} class="wlt-dlg__member">
										<span>{m.name}</span>
										<span class="wlt-dlg__stake">{(m.stakeBp / 100).toLocaleString("en-GB")}%</span>
									</li>
								))}
							</ul>
						</div>
					)}

					{action === "transfer" && (
						<FormControl label="Note" hint="Optional">
							{({ id, describedBy }) => (
								<InputText
									id={id}
									aria-describedby={describedBy}
									value={note.value}
									fluid
									onValueChange={(v) => {
										note.value = v;
									}}
								/>
							)}
						</FormControl>
					)}
				</div>
			)}

			{(step.value === "review" || step.value === "sending" || step.value === "error") && (
				<div class="wlt-review">
					<p class="wlt-dlg__amount">{figure}</p>
					<dl class="wlt-dlg__facts">
						<div class="wlt-dlg__fact">
							<dt>From</dt>
							<dd>{fromLabel}</dd>
						</div>
						<div class="wlt-dlg__fact">
							<dt>To</dt>
							<dd>{toLabel}</dd>
						</div>
						{action === "transfer" && note.value.trim() && (
							<div class="wlt-dlg__fact">
								<dt>Note</dt>
								<dd>{note.value.trim()}</dd>
							</div>
						)}
					</dl>
					<p class="wlt-dlg__warn">{CONSEQUENCE[action]}</p>
					{step.value === "error" && <Alert severity="danger">{outcome.value}</Alert>}
				</div>
			)}

			{step.value === "card" && handoff.value && (
				<div class="wlt-review">
					<p class="wlt-dlg__amount">{figure}</p>
					<StripeElementPanel
						mode="payment"
						clientSecret={handoff.value.clientSecret}
						publishableKey={handoff.value.publishableKey}
						submitLabel={`Pay ${figure}`}
						returnPath="/wallet"
						onOutcome={(result) => {
							if (result.ok) void settle(handoff.value!.paymentId);
						}}
					/>
				</div>
			)}

			{step.value === "settling" && (
				<div class="wlt-review" role="status" aria-live="polite">
					<p class="wlt-dlg__amount">{figure}</p>
					<p class="wlt-dlg__lead">Confirming the payment with your bank…</p>
				</div>
			)}

			{step.value === "done" && <Done amount={figure} message={outcome.value} />}
		</Frame>
	);
}
// #endregion

// #region Configuration
const INTERVALS = [
	{ label: "Weekly", value: "weekly" },
	{ label: "Monthly", value: "monthly" },
];

const PAYOUT_MODES = [
	{ label: "Manual", value: "manual" },
	{ label: "Weekly", value: "scheduled_weekly" },
	{ label: "Monthly", value: "scheduled_monthly" },
	{ label: "Threshold", value: "threshold" },
];

function ConfigDialog(
	props: WalletDialogData & {
		id: number;
		action: WalletAction;
		position: Position;
		onChanged: (overview: WalletOverview | null) => void;
	},
): JSX.Element {
	const { overview, action } = props;
	const closing = useClosing(props.id);
	/** `card` — the Payment Element is on screen for Add card's SetupIntent. */
	const phase = useSignal<"form" | "saving" | "card" | "done">("form");
	const setup = useSignal<WalletCardHandoff["setup"] | null>(null);
	const schedule = action === "set_payout" ? props.schedule : null;
	const threshold = schedule?.threshold ? heldIn(schedule.threshold) : null;
	const amount = useSignal<number | null>(
		threshold ? toMajorUnits(threshold.minor, threshold.currency) : null,
	);
	const interval = useSignal("monthly");
	const source = useSignal("");
	const mode = useSignal<string>(schedule?.mode ?? "scheduled_monthly");
	const destination = useSignal(
		props.destinations.find((d) => d.label === schedule?.destinationLabel)?.id ?? "",
	);
	const reason = useSignal("");
	const problems = useSignal<Problems<"amount" | "reason">>({});
	const failure = useSignal<string | null>(null);
	const outcome = useSignal<string | null>(null);
	const formRef = useRef<HTMLDivElement>(null);
	const errorFor = (field: "amount" | "reason") => problems.value[field];

	const currency = heldIn(overview.available).currency;
	const display = props.query.display ?? undefined;
	const base = { scope: overview.ref.scope, contextId: overview.ref.id, display };
	const fundingMethods = props.methods.filter((m) =>
		m.methodRole !== "payout" && m.status === "active"
	);
	const smoother = overview.personal?.incomeSmoother ?? null;
	const needsAmount = action === "new_recurring" || action === "request_spend" ||
		action === "enrol_smoother" ||
		(action === "set_payout" && mode.value === "threshold");

	const save = async () => {
		const minor = toMinorUnits(amount.value, currency) ?? 0;
		const found: Problems<"amount" | "reason"> = {};
		if (needsAmount && minor <= 0) found.amount = "Enter an amount.";
		if (action === "new_recurring" && !source.value) found.amount = found.amount ?? "Choose a saved card to charge.";
		if (action === "request_spend" && !reason.value.trim()) found.reason = "Say what the money is for.";
		problems.value = found;
		if (refuse(found, formRef.current)) return;

		phase.value = "saving";
		failure.value = null;
		const res: Outcome = action === "new_recurring"
			? await WalletService.addRecurring({
				...base,
				amountMinor: minor,
				currency,
				interval: interval.value as "weekly" | "monthly",
				sourceMethodId: source.value || null,
			})
			: action === "add_method"
			? await WalletService.addMethod({ ...base, methodRole: "funding" })
			: action === "set_payout"
			? await WalletService.setPayout({
				...base,
				mode: mode.value as "manual" | "scheduled_weekly" | "scheduled_monthly" | "threshold",
				thresholdMinor: mode.value === "threshold" ? minor : null,
				destinationId: destination.value || null,
				instant: schedule?.instant ?? false,
			})
			: action === "request_spend"
			? await WalletService.requestSpend({
				...base,
				amountMinor: minor,
				currency,
				reason: reason.value.trim(),
			})
			: await WalletService.enrolSmoother({ targetMonthlyMinor: minor, currency, display });

		if (res.ok && action === "add_method" && res.data?.result?.setup) {
			setup.value = res.data.result.setup;
			phase.value = "card";
			return;
		}
		if (res.ok) {
			outcome.value = res.data?.result?.message ?? res.message ?? "Saved.";
			phase.value = "done";
			props.onChanged(res.data?.result?.overview ?? null);
			return;
		}
		failure.value = res.message ?? Object.values(res.errors ?? {})[0] ??
			"That didn't save. Nothing has changed.";
		phase.value = "form";
	};

	/** The card was confirmed at Stripe; the server re-reads the SetupIntent and records it. */
	const recordCard = async (setupIntentId: string) => {
		phase.value = "saving";
		const saved = await PaymentsService.confirmCard({
			setupIntentId,
			scope: overview.ref.scope === "team" || overview.ref.scope === "business" ? overview.ref.scope : "personal",
			contextId: overview.ref.scope === "personal" ? null : overview.ref.id,
		});
		if (!saved.ok || !saved.data) {
			failure.value = saved.message ?? "The card couldn't be saved.";
			phase.value = "card";
			return;
		}
		const fresh = await WalletService.overview(props.query).catch(() => null);
		if (fresh?.ok && fresh.data) props.onChanged(fresh.data.overview);
		outcome.value = `${methodName({ label: null, brand: saved.data.brand, last4: saved.data.last4 })} saved.`;
		phase.value = "done";
	};

	const footer = phase.value === "done"
		? <Button variant="filled" label="Done" onClick={closing.close} />
		: phase.value === "card"
		? <Button variant="text" label="Cancel" onClick={closing.close} />
		: (
			<>
				<Button
					variant="text"
					label="Cancel"
					disabled={phase.value === "saving"}
					onClick={closing.close}
				/>
				<Button
					variant="filled"
					label={action === "request_spend"
						? "Send request"
						: action === "add_method"
						? "Continue"
						: "Save"}
					loading={phase.value === "saving"}
					disabled={phase.value === "saving"}
					onClick={() => void save()}
				/>
			</>
		);

	return (
		<Frame
			id={props.id}
			title={ACTION_LABEL[action]}
			position={props.position}
			closing={closing}
			focusRef={formRef}
			footer={footer}
		>
			{phase.value === "done"
				? <Done amount={null} message={outcome.value} />
				: phase.value === "card" && setup.value
				? (
					<div class="wlt-form">
						<StripeElementPanel
							mode="setup"
							clientSecret={setup.value.clientSecret}
							publishableKey={setup.value.publishableKey}
							submitLabel="Save card"
							returnPath="/wallet"
							onOutcome={(result) => {
								if (result.ok) void recordCard(setup.value!.setupIntentId);
							}}
						/>
						{failure.value && <Alert severity="danger">{failure.value}</Alert>}
					</div>
				)
				: (
					<div class="wlt-form" ref={formRef}>
						{action === "add_method" && (
							<p class="wlt-dlg__lead">
								Save a card to pay into this wallet and for recurring deposits. You'll enter the card with
								Stripe on the next step — its details never reach Projective. Payouts go to your payout
								account, set up under Verification &amp; payouts.
							</p>
						)}

						{action === "new_recurring" && (
							<>
								<FormControl label="How often">
									{({ id }) => (
										<SelectButton
											id={id}
											options={INTERVALS}
											value={interval.value}
											onValueChange={(v) => {
												if (typeof v === "string") interval.value = v;
											}}
										/>
									)}
								</FormControl>
								<FormControl
									label="Charge"
									hint={fundingMethods.length === 0
										? "Save a card first — Add card, in the wallet's actions."
										: "Charged automatically each time; the first charge is one interval from now."}
								>
									{({ id, describedBy }) => (
										<Select
											id={id}
											aria-describedby={describedBy}
											options={fundingMethods.map((m) => ({ label: methodName(m), value: m.id }))}
											value={source.value}
											placeholder="Choose a saved card"
											disabled={fundingMethods.length === 0}
											fluid
											onValueChange={(v) => {
												source.value = v;
											}}
										/>
									)}
								</FormControl>
							</>
						)}

						{action === "set_payout" && (
							<>
								<FormControl label="When money leaves">
									{({ id }) => (
										<SelectButton
											id={id}
											options={PAYOUT_MODES}
											value={mode.value}
											onValueChange={(v) => {
												if (typeof v === "string") mode.value = v;
											}}
										/>
									)}
								</FormControl>
								{props.destinations.length > 0 && (
									<FormControl label="To">
										{({ id }) => (
											<Select
												id={id}
												options={props.destinations.map((d) => ({ label: d.label, value: d.id }))}
												value={destination.value}
												placeholder="Your default payout account"
												fluid
												onValueChange={(v) => {
													destination.value = v;
												}}
											/>
										)}
									</FormControl>
								)}
							</>
						)}

						{action === "enrol_smoother" && smoother && (
							<p class="wlt-dlg__lead">
								Earnings are buffered into a steady monthly payout for a{" "}
								{(smoother.feeBp / 100).toLocaleString("en-GB")}% fee
								{(toMinorUnits(amount.value, currency) ?? 0) > 0 &&
									` — ${
										formatMoney(incomeSmootherFeeMinor(toMinorUnits(amount.value, currency) ?? 0, smoother.feeBp), currency)
									} a month at this target`}.
							</p>
						)}

						{needsAmount && (
							<FormControl
								label={action === "new_recurring"
									? `Amount each time (${currency})`
									: action === "set_payout"
									? `Pay out once it reaches (${currency})`
									: action === "enrol_smoother"
									? `Target each month (${currency})`
									: `Amount (${currency})`}
								error={errorFor("amount")}
								status={errorFor("amount") ? "invalid" : "default"}
							>
								{({ id, describedBy, status }) => (
									<InputNumber
										id={id}
										aria-describedby={describedBy}
										status={status}
										value={amount.value}
										min={0}
										mode="currency"
										currency={currency}
										fluid
										onValueChange={(v) => {
											amount.value = v;
										}}
									/>
								)}
							</FormControl>
						)}

						{action === "request_spend" && (
							<FormControl
								label="What it's for"
								hint="An approver sees this with the amount."
								error={errorFor("reason")}
								status={errorFor("reason") ? "invalid" : "default"}
							>
								{({ id, describedBy, status }) => (
									<Textarea
										id={id}
										aria-describedby={describedBy}
										status={status}
										value={reason.value}
										rows={3}
										fluid
										onValueChange={(v) => {
											reason.value = v;
										}}
									/>
								)}
							</FormControl>
						)}

						{failure.value && <Alert severity="danger">{failure.value}</Alert>}
					</div>
				)}
		</Frame>
	);
}
// #endregion

// #region Transaction detail
function LineDialog(
	{ id, line, position }: { id: number; line: LedgerLine; position: Position },
): JSX.Element {
	const closing = useClosing(id);
	const credit = line.direction === "credit";
	const when = new Date(line.at);
	const origin = line.amount.origin;
	const elsewhere = isElsewhere(line.href);
	return (
		<Frame
			id={id}
			title={credit ? "Money in" : "Money out"}
			position={position}
			closing={closing}
			footer={
				<>
					{elsewhere && (
						<a class="wlt-textlink" href={line.href!}>Open {line.refKind ?? "details"}</a>
					)}
					<Button variant="filled" label="Done" onClick={closing.close} />
				</>
			}
		>
			<div class="wlt-detail">
				<span class="wlt-detail__mark" data-category={line.category} aria-hidden="true">
					<CategoryIcon category={line.category} size="md" />
				</span>
				<p class="wlt-detail__amount">
					<MoneyView
						value={line.amount}
						size="figure"
						sign={credit ? "+" : "−"}
						tone={credit ? "credit" : "default"}
						hideOrigin
					/>
				</p>
				<p class="wlt-detail__title">{line.title}</p>
				<dl class="wlt-dlg__facts">
					<div class="wlt-dlg__fact">
						<dt>Status</dt>
						<dd>{fundStateLabel(line.fundState)}</dd>
					</div>
					<div class="wlt-dlg__fact">
						<dt>Category</dt>
						<dd>{categoryLabel(line.category)}</dd>
					</div>
					{line.counterparty && (
						<div class="wlt-dlg__fact">
							<dt>{credit ? "From" : "To"}</dt>
							<dd>
								{line.counterpartyHandle
									? (
										<a class="wlt-textlink" href={profileHref(line.counterpartyHandle)}>
											{line.counterparty}
										</a>
									)
									: line.counterparty}
							</dd>
						</div>
					)}
					<div class="wlt-dlg__fact">
						<dt>Date</dt>
						<dd>
							<time dateTime={line.at}>
								{Number.isFinite(when.getTime())
									? when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
									: line.dateLabel}
							</time>
						</dd>
					</div>
					{origin && (
						<div class="wlt-dlg__fact">
							<dt>Original</dt>
							<dd>
								{origin.display} {origin.currency} · 1 {origin.currency} ={" "}
								{origin.fxRate.toLocaleString("en-GB", { maximumFractionDigits: 4 })} {line.amount.currency}
							</dd>
						</div>
					)}
					{line.refId && (
						<div class="wlt-dlg__fact">
							<dt>Reference</dt>
							<dd class="wlt-mono">{line.refId}</dd>
						</div>
					)}
				</dl>
			</div>
		</Frame>
	);
}
// #endregion

// #region Spend approval
function ApprovalDialog(
	props: {
		id: number;
		approval: SpendApprovalView;
		overview: WalletOverview;
		query: WalletContext;
		position: Position;
		onChanged: (overview: WalletOverview | null) => void;
	},
): JSX.Element {
	const { approval } = props;
	const closing = useClosing(props.id);
	const phase = useSignal<"ask" | "sending" | "done">("ask");
	const outcome = useSignal<string | null>(null);
	const failure = useSignal<string | null>(null);

	const decide = async (decision: "approve" | "reject") => {
		phase.value = "sending";
		failure.value = null;
		const res = await WalletService.decideSpend({
			scope: props.overview.ref.scope,
			contextId: props.overview.ref.id,
			approvalId: approval.id,
			decision,
			display: props.query.display ?? undefined,
		});
		if (res.ok) {
			outcome.value = res.data?.result?.message ??
				(decision === "approve" ? "Request approved." : "Request declined.");
			phase.value = "done";
			props.onChanged(res.data?.result?.overview ?? null);
			return;
		}
		failure.value = res.message ?? "That decision didn't go through. Nothing has changed.";
		phase.value = "ask";
	};

	return (
		<Frame
			id={props.id}
			title="Spend request"
			position={props.position}
			closing={closing}
			footer={phase.value === "done"
				? <Button variant="filled" label="Done" onClick={closing.close} />
				: (
					<>
						<Button
							variant="outlined"
							severity="danger"
							label="Decline"
							disabled={phase.value === "sending"}
							onClick={() => void decide("reject")}
						/>
						<Button
							variant="filled"
							label="Approve"
							loading={phase.value === "sending"}
							disabled={phase.value === "sending"}
							onClick={() => void decide("approve")}
						/>
					</>
				)}
		>
			{phase.value === "done"
				? <Done amount={null} message={outcome.value} />
				: (
					<div class="wlt-review">
						<p class="wlt-dlg__amount">
							<MoneyView value={approval.amount} size="figure" />
						</p>
						<dl class="wlt-dlg__facts">
							<div class="wlt-dlg__fact">
								<dt>From</dt>
								<dd>
									{approval.requesterHandle
										? (
											<a class="wlt-textlink" href={profileHref(approval.requesterHandle)}>
												{approval.requesterName}
											</a>
										)
										: approval.requesterName}
								</dd>
							</div>
							<div class="wlt-dlg__fact">
								<dt>Requested</dt>
								<dd>{approval.dateLabel}</dd>
							</div>
							{approval.reason && (
								<div class="wlt-dlg__fact">
									<dt>For</dt>
									<dd>{approval.reason}</dd>
								</div>
							)}
						</dl>
						{failure.value && <Alert severity="danger">{failure.value}</Alert>}
					</div>
				)}
		</Frame>
	);
}
// #endregion

/** Renders whichever wallet dialog is open, as a bottom sheet on a phone. */
export function WalletDialogs(props: WalletDialogsProps): JSX.Element | null {
	const open = walletDialog.value;
	const position: Position = useIsMobile() ? "bottom" : "center";
	if (!open) return null;
	switch (open.kind) {
		case "line":
			return <LineDialog key={open.id} id={open.id} line={open.line} position={position} />;
		case "approval": {
			const approval = props.approvals.find((a) => a.id === open.approvalId);
			return approval
				? (
					<ApprovalDialog
						key={open.id}
						id={open.id}
						approval={approval}
						overview={props.overview}
						query={props.query}
						position={position}
						onChanged={props.onChanged}
					/>
				)
				: null;
		}
		case "action": {
			const item = props.resolve(open.action);
			if (item.locked) {
				return <LockedDialog key={open.id} id={open.id} item={item} position={position} />;
			}
			return MOVEMENTS.has(open.action)
				? (
					<MoveDialog
						key={open.id}
						{...props}
						id={open.id}
						action={open.action}
						stageId={open.stageId}
						position={position}
					/>
				)
				: (
					<ConfigDialog
						key={open.id}
						{...props}
						id={open.id}
						action={open.action}
						position={position}
					/>
				);
		}
	}
}
