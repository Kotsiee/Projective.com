/**
 * payments-model — the demo stage's Payment protection (`?demo=payments`) as a pure simulation over
 * a typed fixture (`flows/LANDING.md` §4.4 "Payment protection", §5 rows B1, B2, B6, C1, C2, C4, D1,
 * E1, E2, F2–F6, K4, §6 V2). It never fetches and never writes: every figure is integer minor units.
 *
 * The arithmetic is the database's, line for line, so the example can never promise a figure the
 * product would not pay:
 *
 *   - **Release** (`finance.fn_release_ticket_escrow`, `supabase/migrations/
 *     00001200_functions_finance_core.sql:742-745`): `fee := (amount × fee_bp) / 10000` in integer
 *     division, then `payout := amount + bonus − fee`, never below 0. The fee comes out of the
 *     team's payment; the client paid the stage price and nothing on top (C2, C4).
 *   - **Fair Exit** (`finance.fn_fair_exit_split`, the same file `:914-930`, which
 *     `fn_fair_exit_release` settles with at `:961-963`): the tier is 25, 50 or 75 and nothing else
 *     (`projects.cancel_stage_fair_exit`, `00001150_functions_projects_stage_funding_submissions.sql:
 *     1166-1170`, `bp := tier × 100`); `share := (amount × bp) / 10000`; the fee is taken on the
 *     share alone, `(share × fee_bp) / 10000`; the team is paid `share − fee` through the 7-day
 *     clearing (`:975`) and the rest goes straight back to the payer, fee-free (`:980`, F4); the
 *     stage then reads Cancelled (`00001150:1224-1226`, F6).
 *
 * Both fees run through `platformFeeFor`, the platform's one truncating fee function (Decision #187).
 * With the fee unavailable (`feeBp` null) every after-fee figure is `null` and the copy drops its fee
 * clause (§4 "If the fee is unavailable").
 *
 * The story it tells (the §4.4 fixture): a £5,000 wallet and a project in three stages of £1,500,
 * £2,000 and £1,500. Stage 1 is paid for from the wallet and held; the client approves it; the team
 * is paid and Chain Reaction pays for Stage 2 from the wallet (D1); the team's money clears in 7 days
 * and is withdrawn to their bank. "Try Fair Exit" ends Stage 2 instead, at the tier the client picks.
 */
import { platformFeeFor } from "@projective/types/finance/fee";
import { formatMoney } from "@ui/display/core/currency-store.ts";
import { formatFeePercent } from "@features/marketing/about/core/metric-format.ts";

// #region Fixture
/** One stage of the example project. */
export interface PaymentsStage {
	id: string;
	name: string;
	/** What the stage costs (minor units): exactly what the client pays and the escrow holds. */
	priceMinor: number;
}

/** The example: the client's wallet and the project's stages, in order. */
export interface PaymentsFixture {
	/** ISO 4217; every amount is in it. */
	currency: string;
	/** The client's spendable wallet balance before anything is paid (minor units). */
	walletMinor: number;
	stages: readonly PaymentsStage[];
}

/** The §4.4 fixture: wallet £5,000; stages £1,500 / £2,000 / £1,500. */
export const PAYMENTS_FIXTURE: PaymentsFixture = {
	currency: "GBP",
	walletMinor: 500_000,
	stages: [
		{ id: "stage-1", name: "Stage 1", priceMinor: 150_000 },
		{ id: "stage-2", name: "Stage 2", priceMinor: 200_000 },
		{ id: "stage-3", name: "Stage 3", priceMinor: 150_000 },
	],
};

/** The locale every figure is formatted in (§4: GBP, en-GB). */
export const PAYMENTS_LOCALE = "en-GB";

/** Days a payout stays pending before it can be withdrawn (`pending_release_days`, E1). */
export const CLEARS_IN_DAYS = 7;
// #endregion

// #region Arithmetic — the SQL, mirrored
/** One escrow released to its payee. */
export interface ReleaseSplit {
	/** The stage price: what the client paid and the escrow held. */
	grossMinor: number;
	/** The platform fee, deducted from the payee. */
	feeMinor: number;
	/** What the team receives. */
	payoutMinor: number;
}

/**
 * The release of one held escrow (`fn_release_ticket_escrow`, `00001200:742-745`): the fee is the
 * amount times the rate in integer division; the payout is the amount plus any deadline bonus less
 * the fee, floored at 0. The fee is never charged on the bonus.
 */
export function releaseSplit(amountMinor: number, feeBp: number, bonusMinor = 0): ReleaseSplit {
	const feeMinor = platformFeeFor(amountMinor, feeBp);
	return {
		grossMinor: amountMinor,
		feeMinor,
		payoutMinor: Math.max(0, amountMinor + bonusMinor - feeMinor),
	};
}

/** The Fair Exit tiers the reviewer may pick, and no others (`00001150:1166-1169`). */
export const FAIR_EXIT_TIERS = [25, 50, 75] as const;

/** How much of the stage was done, in percent. */
export type FairExitTier = typeof FAIR_EXIT_TIERS[number];

/** Whether `value` is one of the {@link FAIR_EXIT_TIERS}. */
export function isFairExitTier(value: unknown): value is FairExitTier {
	return FAIR_EXIT_TIERS.includes(value as FairExitTier);
}

/** One escrow ended under Fair Exit — `fn_fair_exit_split`'s four outputs. */
export interface FairExitSplit {
	/** The share the team earned: the tier's basis points of the principal. */
	shareMinor: number;
	/** The platform fee on that share only. */
	feeMinor: number;
	/** What the team receives, clearing in 7 days. */
	payoutMinor: number;
	/** What goes straight back to the client, with no fee. */
	refundMinor: number;
}

/**
 * Fair Exit on one held escrow (`fn_fair_exit_split`, `00001200:914-930`): `bp = tier × 100`
 * (`00001150:1170`); `share = (amount × bp) / 10000`; `fee = (share × fee_bp) / 10000`;
 * `payout = max(share − fee, 0)`; `refund = max(amount − share, 0)`.
 *
 * @throws When `tier` is not 25, 50 or 75 — the door refuses it (`00001150:1166-1169`).
 */
export function fairExitSplit(amountMinor: number, tier: number, feeBp: number): FairExitSplit {
	if (!isFairExitTier(tier)) {
		throw new RangeError(`Fair-exit tier must be 25, 50, or 75 (got ${tier}).`);
	}
	const bp = tier * 100;
	const shareMinor = Math.floor((amountMinor * bp) / 10_000);
	const feeMinor = platformFeeFor(shareMinor, feeBp);
	return {
		shareMinor,
		feeMinor,
		payoutMinor: Math.max(shareMinor - feeMinor, 0),
		refundMinor: Math.max(amountMinor - shareMinor, 0),
	};
}
// #endregion

// #region Formatting
/** A figure to the penny: `£1,425.00` (the app's `formatMoney`, GBP, en-GB). */
export function money(minor: number, currency = PAYMENTS_FIXTURE.currency): string {
	return formatMoney(minor, currency, PAYMENTS_LOCALE);
}

/** A fixture price as the copy deck writes it: whole pounds lose their pence (`£1,500`). */
export function price(minor: number, currency = PAYMENTS_FIXTURE.currency): string {
	return money(minor, currency).replace(/\.00$/, "");
}

/**
 * The platform fee as the copy deck's `{platformFee}` (`500` → `5%`, `250` → `2.5%`): the About
 * page's own `formatFeePercent`, so every surface writes the rate the same way.
 */
export const feeRate: (feeBp: number) => string = formatFeePercent;
// #endregion

// #region The journey — the scrubber's five stops
/** The scrubber's stops, in order (§4.4: Held safely → You approve → Team paid → Clears in 7 days → Withdraw to bank). */
export const JOURNEY = ["held", "approve", "paid", "clearing", "withdrawn"] as const;

/** One stop of the {@link JOURNEY}. */
export type JourneyStop = typeof JOURNEY[number];

/** Each stop's label (§4.4, verbatim). */
export const JOURNEY_LABEL: Readonly<Record<JourneyStop, string>> = {
	held: "Held safely",
	approve: "You approve",
	paid: "Team paid",
	clearing: "Clears in 7 days",
	withdrawn: "Withdraw to bank",
};

/** A stage's lifecycle word: its funding tag or, once ended, its stage status; `null` while nothing is held. */
export type PaymentsStageStatus = "funded" | "team_paid" | "cancelled" | null;

/** Each status's label: the product's `FUNDING_STATE_LABEL` "Funded", a release shown as "Team paid" (#283 (b)), the stage's "Cancelled" (F6). */
export const STAGE_STATUS_LABEL: Readonly<Record<Exclude<PaymentsStageStatus, null>, string>> = {
	funded: "Funded",
	team_paid: "Team paid",
	cancelled: "Cancelled",
};

/** Each status's role tone, as the product's `FUNDING_TONE` assigns it (Funded success; Released neutral). */
export const STAGE_STATUS_TONE: Readonly<
	Record<Exclude<PaymentsStageStatus, null>, "success" | "neutral">
> = {
	funded: "success",
	team_paid: "neutral",
	cancelled: "neutral",
};

/** What the visitor chose: a stop on the scrubber, and a Fair Exit tier while Fair Exit is on. */
export interface PaymentsChoice {
	/** Index into {@link JOURNEY}. */
	stop: number;
	/** The tier Stage 2 ends at, or `null` while Fair Exit is off. */
	fairExit: FairExitTier | null;
}

/** One stage as the demo draws it. */
export interface PaymentsStageView extends PaymentsStage {
	status: PaymentsStageStatus;
}

/** The team's side of the money (the freelancers' wallet labels, E1). */
export interface TeamMoney {
	/** Paid out and still clearing ("Clearing · 7 days"); `null` when the fee, and so the net, is unknown. */
	clearingMinor: number | null;
	/** Cleared and spendable ("Available"); a withdrawal takes its amount out at once. */
	availableMinor: number | null;
	/**
	 * On its way to the bank: a started withdrawal debits Available the moment it starts
	 * (`finance.begin_payout` calls `fn_wallet_debit`, `00001240:381-383`), so the money is shown
	 * here and no longer as Available. `null` when the fee, and so the net, is unknown.
	 */
	withdrawingMinor: number | null;
	/** A withdrawal has started: "Withdrawal started. Stripe sends it to the bank." */
	withdrawing: boolean;
	/** Anything has been paid to the team at all. */
	paid: boolean;
}

/** The whole picture at one {@link PaymentsChoice}. */
export interface PaymentsView {
	/** The clamped stop index the picture is drawn at. */
	stop: number;
	stopId: JourneyStop;
	fairExit: FairExitTier | null;
	/** The client's spendable wallet balance. */
	walletMinor: number;
	stages: PaymentsStageView[];
	/** Stage 1's release, once approved; its fee and payout are `null` while the fee is unknown. */
	release: { grossMinor: number; feeMinor: number | null; payoutMinor: number | null } | null;
	/** Stage 2 ended under Fair Exit, or `null`; every figure but the share is `null` while the fee is unknown. */
	exit:
		| {
			stageId: string;
			tier: FairExitTier;
			shareMinor: number;
			feeMinor: number | null;
			payoutMinor: number | null;
			refundMinor: number;
		}
		| null;
	team: TeamMoney;
}

/** The stop index Fair Exit needs: Stage 1 approved, so Stage 2 is held and under way. */
export const FAIR_EXIT_FROM_STOP = JOURNEY.indexOf("paid");

/** `stop` clamped into the journey. */
export function clampStop(stop: number): number {
	if (!Number.isFinite(stop)) return 0;
	return Math.min(JOURNEY.length - 1, Math.max(0, Math.trunc(stop)));
}

/**
 * The picture at `choice` — a pure function of the stop, the Fair Exit tier and the fee, so the
 * scrubber can move both ways and always lands on the same state.
 *
 *   - **Held safely**: Stage 1 is paid for from the wallet, exactly its price (C2), and held: Funded.
 *   - **You approve**: the team works; the money stays held.
 *   - **Team paid**: the release — the team receives the price less the fee (C4), clearing in 7
 *     days — and Chain Reaction holds Stage 2 from the wallet, which covers it (D1).
 *   - **Clears in 7 days**: still clearing.
 *   - **Withdraw to bank**: cleared to Available, then withdrawn (E2): the withdrawal takes the
 *     amount out of Available at once, so it is shown on its way to the bank, never in both places.
 *
 * With Fair Exit on, Stage 2 ends at the tier the moment it is held — the "Team paid" stop
 * ({@link FAIR_EXIT_FROM_STOP}), whatever the scrubber says, since Fair Exit needs a held stage: the
 * team's share less its fee joins what is clearing, the rest returns to the wallet at once, and the
 * stage reads Cancelled. The scrubber's own stop is kept, so turning Fair Exit off goes back to it.
 */
export function paymentsView(
	choice: PaymentsChoice,
	feeBp: number | null,
	fixture: PaymentsFixture = PAYMENTS_FIXTURE,
): PaymentsView {
	const fairExit = choice.fairExit !== null && isFairExitTier(choice.fairExit)
		? choice.fairExit
		: null;
	const stop = fairExit === null ? clampStop(choice.stop) : FAIR_EXIT_FROM_STOP;
	const at = (id: JourneyStop) => stop >= JOURNEY.indexOf(id);
	const [first, second] = fixture.stages;

	let walletMinor = fixture.walletMinor - first.priceMinor;
	const status: PaymentsStageStatus[] = fixture.stages.map((
		_,
		index,
	) => (index === 0 ? "funded" : null));

	let release: PaymentsView["release"] = null;
	if (at("paid")) {
		const split = feeBp === null ? null : releaseSplit(first.priceMinor, feeBp);
		release = {
			grossMinor: first.priceMinor,
			feeMinor: split?.feeMinor ?? null,
			payoutMinor: split?.payoutMinor ?? null,
		};
		status[0] = "team_paid";
		// Chain Reaction: the same task moves on and its next stage is held from the live balance.
		if (second && walletMinor >= second.priceMinor) {
			walletMinor -= second.priceMinor;
			status[1] = "funded";
		}
	}

	let exit: PaymentsView["exit"] = null;
	if (fairExit !== null && second && status[1] === "funded") {
		// The share and the refund do not depend on the rate; the fee and the payout do.
		const split = fairExitSplit(second.priceMinor, fairExit, feeBp ?? 0);
		exit = {
			stageId: second.id,
			tier: fairExit,
			shareMinor: split.shareMinor,
			feeMinor: feeBp === null ? null : split.feeMinor,
			payoutMinor: feeBp === null ? null : split.payoutMinor,
			refundMinor: split.refundMinor,
		};
		walletMinor += split.refundMinor;
		status[1] = "cancelled";
	}

	const releaseNet = release?.payoutMinor ?? null;
	const exitNet = exit?.payoutMinor ?? null;
	const unknown = feeBp === null;
	const cleared = at("withdrawn");
	const team: TeamMoney = {
		paid: release !== null,
		withdrawing: cleared,
		clearingMinor: unknown || release === null
			? null
			: (cleared ? 0 : releaseNet ?? 0) + (exit === null ? 0 : exitNet ?? 0),
		availableMinor: unknown || release === null ? null : 0,
		withdrawingMinor: unknown || release === null ? null : cleared ? releaseNet : 0,
	};

	return {
		stop,
		stopId: JOURNEY[stop],
		fairExit: exit === null ? null : fairExit,
		walletMinor,
		stages: fixture.stages.map((stage, index) => ({ ...stage, status: status[index] })),
		release,
		exit,
		team,
	};
}
// #endregion

// #region Copy
/**
 * The viewport's heading line, read off the fixture (§2.3 "demo viewport · ?demo=payments"): "A
 * £5,000 project in 3 stages".
 */
export function projectLine(fixture: PaymentsFixture = PAYMENTS_FIXTURE): string {
	const total = fixture.stages.reduce((sum, stage) => sum + stage.priceMinor, 0);
	return `A ${price(total, fixture.currency)} project in ${fixture.stages.length} stages`;
}

/** The demo's fixed words (§4.4 "Payment protection", verbatim; the labels name the demo's own parts). */
export const PAYMENTS_COPY = {
	wallet: "Your wallet",
	team: "The team",
	clearing: "Clearing · 7 days",
	available: "Available",
	/** The ledger's label for the money on its way to the bank (E2). */
	withdrawal: "Withdrawal started",
	withdrawn: "Withdrawal started. Stripe sends it to the bank.",
	approve: "Approve and pay",
	fairExitToggle: "Try Fair Exit",
	fairExitQuestion: "How much of the stage was done?",
	scrubber: "Where the money is",
} as const;

/** The frames (§4.4 "Payment protection" 1–6): each frame's lines, and the stop and tier it shows. */
export interface PaymentsFrame {
	lines: string[];
	choice: PaymentsChoice;
	/** The stage the frame speaks about, which the picture marks. */
	focus: string;
}

/** The frame-mode sequence, verbatim, with the fee clauses resolved or dropped (§4). */
export function paymentsFrames(
	feeBp: number | null,
	fixture: PaymentsFixture = PAYMENTS_FIXTURE,
): PaymentsFrame[] {
	const [first, second] = fixture.stages;
	const one = price(first.priceMinor, fixture.currency);
	const exit = feeBp === null ? null : fairExitSplit(second.priceMinor, 50, feeBp);
	return [
		{
			lines: [
				`You pay ${one} for ${first.name}. It's held safely, marked Funded.`,
				`Your wallet goes down by exactly ${one}, with no fee on top.`,
			],
			choice: { stop: 0, fairExit: null },
			focus: first.id,
		},
		{
			lines: ["The team works. Your money stays held."],
			choice: { stop: 1, fairExit: null },
			focus: first.id,
		},
		{
			lines: [approvedLine(first.priceMinor, feeBp, fixture.currency)],
			choice: { stop: 2, fairExit: null },
			focus: first.id,
		},
		{
			lines: ["Their money clears in 7 days. Then they withdraw it to their bank."],
			choice: { stop: 4, fairExit: null },
			focus: first.id,
		},
		{
			lines: [`${second.name} is paid for from your wallet, so work keeps going.`],
			choice: { stop: 2, fairExit: null },
			focus: second.id,
		},
		{
			lines: [
				`Work stopped on ${second.name}? Pick 25%, 50% or 75% done.`,
				...(exit === null ? [] : [
					`At 50%: the team gets ${money(exit.payoutMinor, fixture.currency)}. You get ${
						money(exit.refundMinor, fixture.currency)
					} back, fee-free.`,
				]),
			],
			choice: { stop: FAIR_EXIT_FROM_STOP, fairExit: 50 },
			focus: second.id,
		},
	];
}

/** Frame 3: "You approve. The team receives {net} after the {platformFee} fee." — or, without the fee, "You approve. The team is paid." */
export function approvedLine(
	grossMinor: number,
	feeBp: number | null,
	currency = PAYMENTS_FIXTURE.currency,
): string {
	if (feeBp === null) return "You approve. The team is paid.";
	const { payoutMinor } = releaseSplit(grossMinor, feeBp);
	return `You approve. The team receives ${money(payoutMinor, currency)} after the ${
		feeRate(feeBp)
	} fee.`;
}

/**
 * What the live demo says at its stop (the frames' sentences, placed where they happen): Held safely
 * is frame 1; You approve frame 2; Team paid frames 3 and 5 (the release, then Chain Reaction);
 * Clears in 7 days and Withdraw to bank split frame 4 and add the withdrawal's outcome (E2).
 */
export function stopLines(
	view: PaymentsView,
	feeBp: number | null,
	fixture: PaymentsFixture = PAYMENTS_FIXTURE,
): string[] {
	const frames = paymentsFrames(feeBp, fixture);
	switch (view.stopId) {
		case "held":
			return frames[0].lines;
		case "approve":
			return frames[1].lines;
		case "paid":
			return [...frames[2].lines, ...frames[4].lines];
		case "clearing":
			return ["Their money clears in 7 days."];
		case "withdrawn":
			return ["Then they withdraw it to their bank.", PAYMENTS_COPY.withdrawn];
	}
}

/**
 * The Fair Exit result lines (§4.4 controls, F3, F4): "Team receives {x} · clears in 7 days" and
 * "Back to you {y} · straight away, no fee". Without the fee the figures are hidden (§4) and the lines
 * fall back to the claims' own words, "Team paid · clears in 7 days" (E1) and "The rest comes
 * straight back to you, fee-free." (F4).
 */
export function fairExitLines(
	view: PaymentsView,
	fixture: PaymentsFixture = PAYMENTS_FIXTURE,
): { team: string; back: string } | null {
	const exit = view.exit;
	if (!exit) return null;
	if (exit.payoutMinor === null) {
		return {
			team: "Team paid · clears in 7 days",
			back: "The rest comes straight back to you, fee-free.",
		};
	}
	return {
		team: `Team receives ${money(exit.payoutMinor, fixture.currency)} · clears in 7 days`,
		back: `Back to you ${money(exit.refundMinor, fixture.currency)} · straight away, no fee`,
	};
}

/** The line Fair Exit mode opens with: frame 6's first sentence. */
export function fairExitPrompt(fixture: PaymentsFixture = PAYMENTS_FIXTURE): string {
	return paymentsFrames(null, fixture)[5].lines[0];
}
// #endregion
