import type {
	AccessView,
	ActivityRange,
	ActivityView,
	AuditRow,
	BillRow,
	BudgetBurn,
	BusinessExtras,
	CategorySlice,
	DepositRuleView,
	FlowPoint,
	FundingSource,
	FundingView,
	IncomeSmootherState,
	IncomingItem,
	InvoicesView,
	LedgerLine,
	MethodsView,
	MoneyView,
	PayoutDestination,
	PayoutHistoryRow,
	PayoutScheduleView,
	PayoutsView,
	PersonalExtras,
	SimFundMix,
	SimKyc,
	SimSmoother,
	SimStanding,
	SpendApprovalView,
	SpendingCapView,
	SplitMember,
	SplitRuleView,
	SplitShare,
	StandingComponent,
	StandingGate,
	StandingRung,
	StatementRow,
	TeamExtras,
	TransactionListParams,
	TransactionPage,
	TxnCategory,
	VaultMember,
	WalletAction,
	WalletOverview,
	WalletQuery,
	WalletRef,
	WalletSim,
	WalletStanding,
	WalletSwitcher,
	WalletVariant,
	WalletVerification,
} from "@projective/types/finance";
import {
	capabilitiesForRole,
	convertMinorUnits,
	currencyExponent,
	formatMoney,
	type FundState,
	resolveRate,
	type SplitRuleType,
	type VaultCapability,
	type VaultRole,
	walletVariant,
} from "@projective/types/finance";
import { FX_FIXTURE_BASE, FX_FIXTURE_RATES } from "./fx-fixtures.ts";

/**
 * wallet fixtures — the fat {@link WalletBackendService}'s deterministic finance world while
 * `FINANCE_BACKEND_LIVE` is off. Like every sibling read projection it DERIVES a coherent set of wallets
 * (a personal wallet, two team vaults, two business wallets) from the SAME multi-tenant cast the rest of
 * the app uses (`nav-fixtures` teams/businesses — `northwind`/`atlas-collective`,
 * `monarch-labs`/`verdant-studio`), so a wallet agrees on identity with the switcher, the profile, and
 * the projects that produced its ledger lines. No RNG — a stable id hash seeds every figure and a fixed
 * reference clock keeps SSR and the island's refetch identical (watch the TDZ: the reference clock +
 * helpers are declared ABOVE the cast, which builds at module init).
 *
 * ALL money math lives here (the fat service is the only place a balance, split, fee, or FX conversion is
 * computed — root CLAUDE.md §2): {@link previewSplit} runs the 5%-fee → vault-cut → template →
 * remainder-to-vault division (finance-model.md §5), {@link toMoney} converts origin → display currency
 * via a snapshot FX table and formats it, and {@link resolveVerification} runs the KYC gate. The client
 * only renders the resulting {@link MoneyView}s.
 *
 * Because this is a WRITE surface, the derived wallets seed a mutable module-level {@link STATE} so
 * top-up / withdraw / transfer / distribute / method / rule / schedule mutations are fully exercisable
 * with the gate off (optimistic, per-process, no persistence). The RLS-scoped `finance.*` tables + money
 * functions replace it behind the same gate with zero shape churn.
 *
 * **Simulation knobs** ({@link WalletSim}) let the Dev Context Switcher reach every state at runtime — a
 * vault role, a KYC state, an Income-Smoother state, a fund-state mix, and a display currency — passed
 * as query params the island refetches with (the server never sees the client seam directly). Ignored
 * on the live path.
 */

// #region Reference clock + deterministic helpers (declared before the cast — it builds at module init)
/** Fixed reference "now" (no `Date.now()`), matching the sibling fixtures. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const DAY = 86_400_000;
/** `security.platform_params.pending_release_days` — the 7-day safety window (finance-model.md §7). */
const PENDING_WINDOW_DAYS = 7;
const HOUR = 3_600_000;

/** A tiny stable hash → non-negative int (unsigned `>>>`, per the documented hash-index gotcha). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/** A deterministic pseudo-value in [0,1) from a string seed. */
function frac(seed: string): number {
	return (hash(seed) % 100000) / 100000;
}

/** An Unsplash face URL (the shared avatar convention). */
function face(id: string): string {
	return `https://images.unsplash.com/${id}?auto=format&fit=facearea&facepad=3&w=96&h=96&q=80`;
}

/** `today` / `2 days ago` / `12 Jul` relative to {@link NOW}. */
function dateLabel(ms: number): string {
	const diff = Math.floor(NOW / DAY) - Math.floor(ms / DAY);
	if (diff <= 0) return "Today";
	if (diff === 1) return "Yesterday";
	if (diff < 7) return `${diff} days ago`;
	return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** `Clears in 3 days` / `Available today` from an availability epoch. */
function clearingLabel(ms: number): string {
	const diff = Math.ceil((ms - NOW) / DAY);
	if (diff <= 0) return "Clearing now";
	if (diff === 1) return "Clears tomorrow";
	return `Clears in ${diff} days`;
}
// #endregion

// #region FX (the seeded snapshot table, GBP base) + money projection
/**
 * The fixture FX snapshot every finance surface projects money through.
 *
 * **This used to be a private three-entry table (`{ GBP: 1, USD: 1.27, EUR: 1.17 }`) with a `?? 1`
 * fallback, and it was silently wrong for nine of the twelve offerable display currencies.** An
 * unknown code resolved to a rate of exactly 1, so a $95.00 product rendered as `AED 74.80` where the
 * real rate makes it AED 348.58 — a 4.7× understatement presented with full confidence, on a price a
 * buyer was about to pay. It was invisible in review because the three currencies it did cover are
 * the three anyone tests with.
 *
 * It now reads {@link FX_FIXTURE_RATES} — the SAME twelve-currency table `FxService` serves to the
 * client and `00005050_seed_reference_data.sql` seeds into `finance.fx_rates`. That is the point:
 * the server's figure and the client's re-projection of it are now derived from one table, so they
 * cannot disagree. (finance-model.md §11: store-in-origin, GBP base, snapshot-at-commit. **Who bears
 * the FX spread is an OPEN business question (root §8) — we display the rate and the converted
 * amount only and NEVER model a conversion fee here.**)
 */
const FX_TABLE = { base: FX_FIXTURE_BASE, rates: FX_FIXTURE_RATES };

/**
 * The FX multiplier `to = from × rate`, resolved through the SSOT's own {@link resolveRate}.
 *
 * Delegating rather than dividing two lookups matters for a pair where NEITHER side is the base:
 * `resolveRate` triangulates through it (`from → GBP → to`), which is the arithmetic the client runs.
 * A local `t / f` happens to agree today, but a table that ever gained a non-triangulable pair would
 * split the two answers, and only one of them is what the buyer is charged.
 *
 * Returns `1` only for a genuinely unresolvable pair, and that case can no longer arise for an
 * offerable currency — every one of the twelve has an entry.
 */
function fxRate(from: string, to: string): number {
	return resolveRate(FX_TABLE, from, to) ?? 1;
}

/**
 * Convert a minor-unit amount between currencies.
 *
 * **Exponent-aware, which the previous implementation was not.** It multiplied minor units by the
 * rate directly, with a comment asserting the fixture set was "2dp — exponent-stable". JPY has
 * exponent 0. So ¥ figures were wrong by a further factor of 100 on top of the rate error: the two
 * bugs compounded, and the more plausible the result looked the harder it was to notice.
 * {@link convertMinorUnits} is the SSOT's converter and takes both exponents explicitly.
 */
function convertMinor(minor: number, from: string, to: string): number {
	const src = from.toUpperCase();
	const dst = to.toUpperCase();
	if (src === dst) return minor;
	return convertMinorUnits(minor, fxRate(src, dst), currencyExponent(src), currencyExponent(dst));
}

/**
 * Build a {@link MoneyView}: convert an origin-currency amount into the viewer's display currency, format
 * it (server-side, deterministic), and attach the origin `(amount, currency, rate)` when they differ.
 *
 * Exported so the sibling finance fixtures (basket · checkout · cards) project money through the SAME
 * FX snapshot and the SAME formatter. A second conversion table is how two finance surfaces come to
 * quote one price two ways.
 */
export function toMoney(minor: number, origin: string, display: string, locale: string): MoneyView {
	const conv = convertMinor(minor, origin, display);
	const sameCcy = origin.toUpperCase() === display.toUpperCase();
	return {
		minor: conv,
		currency: display,
		display: formatMoney(conv, display, locale),
		origin: sameCcy ? null : {
			minor,
			currency: origin,
			display: formatMoney(minor, origin, locale),
			fxRate: Math.round(fxRate(origin, display) * 10000) / 10000,
		},
	};
}
// #endregion

// The dev-simulation + read-query shapes are the SSOT's ({@link WalletSim} / {@link WalletQuery}); this
// service resolves them. `SimKyc`/`SimSmoother`/`SimFundMix` are re-exported for the thin routes' parsing.
export type {
	SimFundMix,
	SimKyc,
	SimSmoother,
	WalletQuery,
	WalletSim,
} from "@projective/types/finance";

// #region The cast (reused ids/handles/avatars — agrees with nav-fixtures)
interface MemberSeed {
	userId: string;
	handle: string;
	name: string;
	avatar: string;
	role: VaultRole;
	stakeBp: number;
}

interface WalletSeed {
	scope: "personal" | "team" | "business" | "organisation";
	id: string;
	handle: string | null;
	name: string;
	avatar: string | null;
	/** The wallet's own currency (origin of its stored figures). */
	currency: string;
	/** The acting user's coarse role on this wallet. */
	viewerRole: VaultRole;
	/** Base balances in the wallet currency (minor units) — the `normal` fund mix. */
	availableMinor: number;
	lockedMinor: number;
	pendingMinor: number;
	onHoldMinor: number;
	lifetimeMinor: number;
	/** Team/business membership roster (for splits, caps, access). */
	members: MemberSeed[];
	/** Team split ruleset (teams only). */
	splitRule?: { type: SplitRuleType; vaultBp: number; finderHandle?: string; finderBp?: number };
	/** Business monthly budget (businesses only). */
	budgetMinor?: number;
}

/** The acting user every personal figure is owned by (a fixed identity, like the catalogue seller). */
const ACTING = {
	userId: "u-ahmed",
	handle: "ahmed",
	name: "Ahmed K.",
	avatar: face("photo-1506794778202-cad84cf45f1d"),
};

/** A small people cast for team/business rosters (reused across vaults). */
const PEOPLE: Record<string, { userId: string; handle: string; name: string; avatar: string }> = {
	ahmed: { userId: ACTING.userId, handle: "ahmed", name: "Ahmed K.", avatar: ACTING.avatar },
	mara: {
		userId: "u-mara",
		handle: "maradv",
		name: "Mara D.",
		avatar: face("photo-1544005313-94ddf0286df2"),
	},
	tomas: {
		userId: "u-tomas",
		handle: "tomasp",
		name: "Tomas P.",
		avatar: face("photo-1500648767791-00dcc994a43e"),
	},
	lena: {
		userId: "u-lena",
		handle: "lenak",
		name: "Lena K.",
		avatar: face("photo-1438761681033-6461ffad8d80"),
	},
	sofia: {
		userId: "u-sofia",
		handle: "sofiar",
		name: "Sofia R.",
		avatar: face("photo-1487412720507-e7ab37603c6f"),
	},
	darius: {
		userId: "u-darius",
		handle: "dariusn",
		name: "Darius N.",
		avatar: face("photo-1633332755192-727a05c4013d"),
	},
};

/** Build a member seed from the people cast. */
function member(key: string, role: VaultRole, stakeBp: number): MemberSeed {
	const p = PEOPLE[key];
	return { userId: p.userId, handle: p.handle, name: p.name, avatar: p.avatar, role, stakeBp };
}

/** The deterministic wallet cast (TDZ-safe — helpers above are already defined). */
const SEEDS: WalletSeed[] = [
	{
		scope: "personal",
		id: ACTING.userId,
		handle: ACTING.handle,
		name: "Personal wallet",
		avatar: ACTING.avatar,
		currency: "GBP",
		viewerRole: "owner",
		availableMinor: 482_640,
		lockedMinor: 240_000,
		pendingMinor: 128_500,
		onHoldMinor: 45_000,
		lifetimeMinor: 8_640_000,
		members: [],
	},
	{
		scope: "team",
		id: "northwind",
		handle: "northwind",
		name: "Northwind Studio",
		avatar: face("photo-1500648767791-00dcc994a43e"),
		currency: "GBP",
		viewerRole: "admin",
		availableMinor: 1_284_000,
		lockedMinor: 620_000,
		pendingMinor: 310_000,
		onHoldMinor: 0,
		lifetimeMinor: 22_400_000,
		members: [
			member("tomas", "owner", 3500),
			member("ahmed", "admin", 2500),
			member("mara", "member", 2000),
			member("darius", "member", 2000),
		],
		splitRule: { type: "co_op", vaultBp: 1000 },
	},
	{
		scope: "team",
		id: "atlas-collective",
		handle: "atlascollective",
		name: "Atlas Collective",
		avatar: face("photo-1544005313-94ddf0286df2"),
		currency: "EUR",
		viewerRole: "member",
		availableMinor: 742_000,
		lockedMinor: 180_000,
		pendingMinor: 96_000,
		onHoldMinor: 60_000,
		lifetimeMinor: 15_900_000,
		members: [
			member("sofia", "owner", 0),
			member("mara", "admin", 0),
			member("ahmed", "member", 0),
			member("lena", "member", 0),
			member("darius", "member", 0),
		],
		splitRule: { type: "finders_fee", vaultBp: 500, finderHandle: "sofiar", finderBp: 2000 },
	},
	{
		scope: "business",
		id: "monarch-labs",
		handle: "monarchlabs",
		name: "Monarch Labs",
		avatar: face("photo-1438761681033-6461ffad8d80"),
		currency: "GBP",
		viewerRole: "owner",
		availableMinor: 3_420_000,
		lockedMinor: 1_180_000,
		pendingMinor: 240_000,
		onHoldMinor: 0,
		lifetimeMinor: 41_200_000,
		members: [
			member("ahmed", "owner", 0),
			member("lena", "admin", 0),
			member("tomas", "pm", 0),
			member("mara", "pm", 0),
		],
		budgetMinor: 5_000_000,
	},
	{
		scope: "business",
		id: "verdant-studio",
		handle: "verdantstudio",
		name: "Verdant Studio",
		avatar: face("photo-1487412720507-e7ab37603c6f"),
		currency: "GBP",
		viewerRole: "admin",
		availableMinor: 1_960_000,
		lockedMinor: 540_000,
		pendingMinor: 120_000,
		onHoldMinor: 0,
		lifetimeMinor: 18_300_000,
		members: [
			member("sofia", "owner", 0),
			member("ahmed", "admin", 0),
			member("darius", "pm", 0),
		],
		budgetMinor: 3_000_000,
	},
];

const SEED_BY_KEY = new Map(SEEDS.map((s) => [`${s.scope}:${s.id}`, s]));
// #endregion

// #region Mutable session store (seeded lazily from the cast)
interface WalletMutable {
	availableMinor: number;
	lockedMinor: number;
	pendingMinor: number;
	onHoldMinor: number;
	lifetimeMinor: number;
	/** Appended ledger lines from mutations (newest first), origin-currency minor units. */
	extraLines: RawLine[];
	incomeSmootherEnrolled: boolean;
	incomeSmootherTargetMinor: number | null;
	extraMethods: FundingMethodSeed[];
	extraRules: DepositRuleSeed[];
	payoutMode: string;
	payoutInstant: boolean;
	payoutThresholdMinor: number | null;
}

interface FundingMethodSeed {
	id: string;
	label: string;
	brand: string | null;
	last4: string | null;
	role: "funding" | "payout" | "both";
	isDefaultFunding: boolean;
	isDefaultPayout: boolean;
}

interface DepositRuleSeed {
	id: string;
	amountMinor: number;
	interval: "weekly" | "monthly";
	sourceLabel: string | null;
	nextRunMs: number;
	active: boolean;
	failing: boolean;
}

const STATE = new Map<string, WalletMutable>();
let seq = 0;

/** Lazily seed (and return) the mutable slice for a wallet key. */
function stateFor(key: string): WalletMutable {
	const existing = STATE.get(key);
	if (existing) return existing;
	const seed = SEED_BY_KEY.get(key);
	const seeded: WalletMutable = {
		availableMinor: seed?.availableMinor ?? 0,
		lockedMinor: seed?.lockedMinor ?? 0,
		pendingMinor: seed?.pendingMinor ?? 0,
		onHoldMinor: seed?.onHoldMinor ?? 0,
		lifetimeMinor: seed?.lifetimeMinor ?? 0,
		extraLines: [],
		incomeSmootherEnrolled: key === "personal:u-ahmed",
		incomeSmootherTargetMinor: key === "personal:u-ahmed" ? 420_000 : null,
		extraMethods: [],
		extraRules: [],
		payoutMode: "scheduled_weekly",
		payoutInstant: false,
		payoutThresholdMinor: null,
	};
	STATE.set(key, seeded);
	return seeded;
}
// #endregion

// #region Ledger generation (deterministic, origin-currency)
/** A raw ledger line in the wallet's origin currency (before display projection). */
interface RawLine {
	id: string;
	direction: "credit" | "debit";
	reason: string;
	title: string;
	counterparty: string | null;
	counterpartyHandle: string | null;
	amountMinor: number;
	/** Origin currency of this line (usually the wallet currency; a few cross-currency lines differ). */
	currency: string;
	fundState: FundState;
	category: TxnCategory;
	refKind: LedgerLine["refKind"];
	refId: string | null;
	href: string | null;
	at: number;
}

/** Known project slugs the ledger links to (coherence with `/projects` + `/view`). */
const PROJECTS: { id: string; name: string }[] = [
	{ id: "helia-wallet-redesign", name: "Helia wallet redesign" },
	{ id: "verdant-brand-refresh", name: "Verdant brand refresh" },
	{ id: "gradient-motion-kit", name: "Gradient motion kit" },
	{ id: "monarch-design-system", name: "Monarch design system" },
	{ id: "atlas-landing-sprint", name: "Atlas landing sprint" },
];

const CATEGORIES: { category: TxnCategory; reason: string; dir: "credit" | "debit" }[] = [
	{ category: "earning", reason: "escrow_release", dir: "credit" },
	{ category: "escrow", reason: "escrow_hold", dir: "debit" },
	{ category: "fee", reason: "platform_fee", dir: "debit" },
	{ category: "payout", reason: "payout", dir: "debit" },
	{ category: "deposit", reason: "deposit", dir: "credit" },
	{ category: "refund", reason: "escrow_refund", dir: "credit" },
	{ category: "spend", reason: "escrow_hold", dir: "debit" },
	{ category: "transfer", reason: "transfer", dir: "debit" },
];

/** The chart/label metadata for a category. */
function categoryTitle(cat: TxnCategory, project: string): string {
	switch (cat) {
		case "earning":
			return `Escrow release · ${project}`;
		case "escrow":
			return `Escrow funded · ${project}`;
		case "fee":
			return `Platform fee · ${project}`;
		case "payout":
			return "Payout to bank";
		case "deposit":
			return "Wallet top-up";
		case "refund":
			return `Fair-exit refund · ${project}`;
		case "spend":
			return `Stage funding · ${project}`;
		case "transfer":
			return "Transfer between wallets";
		case "withdrawal":
			return "Withdrawal";
	}
}

/** Generate the deterministic base ledger for a wallet (origin currency), newest first. */
function baseLedger(seed: WalletSeed): RawLine[] {
	const count = seed.scope === "personal" ? 34 : seed.scope === "team" ? 30 : 38;
	const lines: RawLine[] = [];
	for (let i = 0; i < count; i++) {
		const s = `${seed.scope}:${seed.id}:${i}`;
		const h = hash(s);
		const spec = CATEGORIES[h % CATEGORIES.length];
		const project = PROJECTS[(h >>> 3) % PROJECTS.length];
		// A few personal lines are priced in a foreign currency to demonstrate the origin hover.
		const foreign = seed.scope === "personal" && i % 11 === 3;
		const currency = foreign ? (i % 2 === 0 ? "EUR" : "USD") : seed.currency;
		const base = 8_000 + (h % 240_000);
		const amountMinor = spec.category === "fee"
			? Math.round(base * 0.05)
			: spec.category === "deposit"
			? 50_000 + (h % 200_000)
			: base;
		const at = NOW - (i * 2 + (h % 3)) * DAY - (h % 12) * HOUR;
		const fundState: FundState = spec.category === "earning"
			? (i % 5 === 0 ? "pending" : "available")
			: spec.category === "escrow" || spec.category === "spend"
			? "locked"
			: spec.category === "refund" && i % 7 === 0
			? "on_hold"
			: "available";
		const cp = spec.category === "earning" || spec.category === "refund"
			? PEOPLE[Object.keys(PEOPLE)[(h >>> 5) % Object.keys(PEOPLE).length]]
			: null;
		lines.push({
			id: `${seed.scope[0]}${seed.id.slice(0, 3)}-${i}`,
			direction: spec.dir,
			reason: spec.reason,
			title: categoryTitle(spec.category, project.name),
			counterparty: cp?.name ?? null,
			counterpartyHandle: cp?.handle ?? null,
			amountMinor,
			currency,
			fundState,
			category: spec.category,
			refKind: spec.category === "payout"
				? "payout"
				: spec.category === "deposit"
				? "deposit"
				: spec.category === "fee"
				? "fee"
				: spec.category === "transfer"
				? "transfer"
				: "stage",
			refId: project.id,
			href:
				spec.category === "payout" || spec.category === "deposit" || spec.category === "transfer"
					? null
					: `/projects/${project.id}`,
			at,
		});
	}
	return lines;
}

/** The full origin-currency ledger (base + mutation-appended), newest first. */
function rawLedger(seed: WalletSeed): RawLine[] {
	const key = `${seed.scope}:${seed.id}`;
	const st = stateFor(key);
	return [...st.extraLines, ...baseLedger(seed)].sort((a, b) => b.at - a.at);
}

/** Project a raw line into the display-currency {@link LedgerLine}. */
function toLine(raw: RawLine, display: string, locale: string): LedgerLine {
	return {
		id: raw.id,
		direction: raw.direction,
		reason: raw.reason,
		title: raw.title,
		counterparty: raw.counterparty,
		counterpartyHandle: raw.counterpartyHandle,
		amount: toMoney(raw.amountMinor, raw.currency, display, locale),
		fundState: raw.fundState,
		category: raw.category,
		refKind: raw.refKind,
		refId: raw.refId,
		href: raw.href,
		at: new Date(raw.at).toISOString(),
		dateLabel: dateLabel(raw.at),
	};
}
// #endregion

// #region Balances (fund-state mix aware)
interface Balances {
	availableMinor: number;
	lockedMinor: number;
	pendingMinor: number;
	onHoldMinor: number;
	lifetimeMinor: number;
}

/** Resolve a wallet's balances under the current mutation state + a simulated fund-state mix. */
function resolveBalances(seed: WalletSeed, mix: SimFundMix): Balances {
	const st = stateFor(`${seed.scope}:${seed.id}`);
	const base: Balances = {
		availableMinor: st.availableMinor,
		lockedMinor: st.lockedMinor,
		pendingMinor: st.pendingMinor,
		onHoldMinor: st.onHoldMinor,
		lifetimeMinor: st.lifetimeMinor,
	};
	switch (mix) {
		case "locked":
			return { ...base, lockedMinor: base.lockedMinor + 320_000, pendingMinor: 0, onHoldMinor: 0 };
		case "pending":
			return { ...base, pendingMinor: base.pendingMinor + 210_000, onHoldMinor: 0 };
		case "dispute":
			return { ...base, onHoldMinor: base.onHoldMinor + 180_000 };
		case "normal":
		default:
			return base;
	}
}
// #endregion

// #region Verification (KYC gate)
/** Resolve the KYC/verification gate for a wallet + subject, honouring the simulated KYC state. */
function resolveVerification(
	variant: WalletVariant,
	isFreelancer: boolean,
	sim: SimKyc,
): WalletVerification {
	const subject: WalletVerification["subject"] = variant === "business"
		? "business"
		: isFreelancer
		? "freelancer"
		: "client";

	// Individual clients need no ID (tap-and-pay) — always clear (finance-model §KYC/KYB Gating).
	if (subject === "client") {
		return {
			subject,
			kycStatus: "verified",
			tier: 1,
			payoutReady: true,
			canWithdraw: true,
			canEarn: true,
			prompt: null,
			href: null,
		};
	}

	const verifyHref = "/settings/verification";
	if (sim === "unverified") {
		return {
			subject,
			kycStatus: "unverified",
			tier: null,
			payoutReady: false,
			canWithdraw: false,
			canEarn: false,
			prompt: subject === "business"
				? "Verify your business (KYB) to operate this vault"
				: "Verify your identity to start earning",
			href: verifyHref,
		};
	}
	if (sim === "payout_setup") {
		return {
			subject,
			kycStatus: "verified",
			tier: 2,
			payoutReady: false,
			canWithdraw: false,
			canEarn: true,
			prompt: "Add a payout method to get paid",
			href: "/wallet/payouts",
		};
	}
	return {
		subject,
		kycStatus: "verified",
		tier: subject === "business" ? 3 : 2,
		payoutReady: true,
		canWithdraw: true,
		canEarn: true,
		prompt: null,
		href: null,
	};
}
// #endregion

// #region Split preview (5% fee → vault cut → template → remainder-to-vault)
const PLATFORM_FEE_BP = 500;

/** Human label for a split ruleset. */
function splitLabel(type: SplitRuleType): string {
	switch (type) {
		case "co_op":
			return "Co-op · equal shares";
		case "finders_fee":
			return "Finder's fee";
		case "benevolent_dictator":
			return "Benevolent dictator";
	}
}

interface SplitOutcome {
	feeMinor: number;
	vaultMinor: number;
	shares: { member: MemberSeed; minor: number; shareBp: number }[];
}

/**
 * Divide a gross payout: 5% platform fee off gross → `vaultBp` cut off the net → the template distributes
 * the remainder → any leftover minor unit goes to the Team Vault (so the ledger nets to zero).
 * finance-model.md §5.
 */
function previewSplit(
	grossMinor: number,
	rule: { type: SplitRuleType; vaultBp: number; finderHandle?: string; finderBp?: number },
	members: MemberSeed[],
): SplitOutcome {
	const feeMinor = Math.round(grossMinor * PLATFORM_FEE_BP / 10000);
	const netMinor = grossMinor - feeMinor;
	const vaultCut = Math.round(netMinor * rule.vaultBp / 10000);
	let remainder = netMinor - vaultCut;
	const shares: { member: MemberSeed; minor: number; shareBp: number }[] = [];

	if (rule.type === "benevolent_dictator") {
		// 100% to the Team Vault; members receive nothing until the admin distributes manually.
		return {
			feeMinor,
			vaultMinor: vaultCut + remainder,
			shares: members.map((m) => ({ member: m, minor: 0, shareBp: 0 })),
		};
	}

	let finderMinor = 0;
	let recipients = members;
	if (rule.type === "finders_fee" && rule.finderHandle && rule.finderBp) {
		finderMinor = Math.round(remainder * rule.finderBp / 10000);
		const finder = members.find((m) => m.handle === rule.finderHandle);
		if (finder) {
			shares.push({ member: finder, minor: finderMinor, shareBp: rule.finderBp });
			remainder -= finderMinor;
			recipients = members.filter((m) => m.handle !== rule.finderHandle);
		}
	}

	const n = recipients.length || 1;
	const per = Math.floor(remainder / n);
	let distributed = 0;
	for (const m of recipients) {
		shares.push({ member: m, minor: per, shareBp: Math.round(per / netMinor * 10000) });
		distributed += per;
	}
	// Deterministic remainder rounding → the leftover minor unit(s) go to the Team Vault.
	const leftover = remainder - distributed;
	return { feeMinor, vaultMinor: vaultCut + leftover, shares };
}
// #endregion

// #region Flow series
/** Deterministic in/out flow for a wallet over the last `days`, bucketed into `buckets` points. */
function flowSeries(seed: WalletSeed, days: number, buckets: number, display: string): FlowPoint[] {
	const perBucket = days / buckets;
	const scale = seed.scope === "business" ? 2.2 : seed.scope === "team" ? 1.6 : 1;
	const out: FlowPoint[] = [];
	for (let b = 0; b < buckets; b++) {
		const startMs = NOW - (buckets - b) * perBucket * DAY;
		const s = `${seed.scope}:${seed.id}:flow:${days}:${b}`;
		const inMinor = Math.round((30_000 + frac(`${s}:in`) * 180_000) * scale);
		const outMinor = Math.round((18_000 + frac(`${s}:out`) * 120_000) * scale);
		out.push({
			label: new Date(startMs).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
			inMinor: convertMinor(inMinor, seed.currency, display),
			outMinor: convertMinor(outMinor, seed.currency, display),
		});
	}
	return out;
}
// #endregion

// #region Incoming (money on the way)
function incoming(seed: WalletSeed, display: string, locale: string): IncomingItem[] {
	const items: IncomingItem[] = [];
	const st = stateFor(`${seed.scope}:${seed.id}`);
	// Pending releases inside the 7-day safety window.
	if (st.pendingMinor > 0) {
		const clearMs = NOW + 3 * DAY;
		items.push({
			id: `${seed.id}-pending`,
			kind: "pending_release",
			label: "Escrow release clearing",
			amount: toMoney(st.pendingMinor, seed.currency, display, locale),
			state: "pending",
			clearingLabel: clearingLabel(clearMs),
			clearingAt: new Date(clearMs).toISOString(),
			// 4 of the 7-day window elapsed (release was 4 days ago, 3 days remain).
			clearingFraction: 4 / PENDING_WINDOW_DAYS,
			href: "/wallet/transactions",
		});
	}
	// Escrow funded on active stages (locked capital on its way to release).
	if (st.lockedMinor > 0) {
		items.push({
			id: `${seed.id}-escrow`,
			kind: "escrow_funded",
			label: "Escrow funded · Helia wallet redesign",
			amount: toMoney(Math.round(st.lockedMinor * 0.6), seed.currency, display, locale),
			state: "locked",
			clearingLabel: "On active stage",
			clearingAt: null,
			// Escrowed capital has not entered a clearing window at all.
			clearingFraction: 0,
			href: "/projects/helia-wallet-redesign",
		});
	}
	// An incoming scheduled payout (personal only).
	if (seed.scope === "personal") {
		const runMs = NOW + 2 * DAY;
		items.push({
			id: `${seed.id}-payout`,
			kind: "payout",
			label: "Weekly payout to bank",
			amount: toMoney(Math.round(st.availableMinor * 0.4), seed.currency, display, locale),
			state: "available",
			clearingLabel: clearingLabel(runMs),
			clearingAt: new Date(runMs).toISOString(),
			clearingFraction: 5 / PENDING_WINDOW_DAYS,
			href: "/wallet/payouts",
		});
	}
	return items;
}
// #endregion

// #region Quick actions (capability-gated)
function quickActionsFor(
	variant: WalletVariant,
	caps: VaultCapability[],
	/** Retained for the live path, which will re-check it server-side before money moves. */
	_verification: WalletVerification,
	/** The personal extras, so the Smoother's enrol affordance is offered only where it can be used. */
	personal: PersonalExtras | null,
): WalletAction[] {
	const actions: WalletAction[] = [];
	if (caps.includes("add_funds")) actions.push("top_up");
	/*
	 * Offered on CAPABILITY alone, deliberately — an outstanding verification step does not remove
	 * this action, it locks it. The two gates behave differently on purpose: a capability the viewer
	 * will never hold is absent, but a step they can still complete is shown locked with the way
	 * forward attached. Removing it here would hide the path to getting paid from exactly the person
	 * who needs to find it. The surface reads `verification.canWithdraw` to draw the lock, and the
	 * server re-checks it before any money actually moves.
	 */
	if (caps.includes("withdraw")) actions.push("withdraw");
	if (caps.includes("view")) actions.push("transfer");
	if (variant === "team" && caps.includes("distribute")) actions.push("distribute");
	if (caps.includes("spend")) actions.push("fund_escrow");
	if (caps.includes("add_funds")) actions.push("new_recurring");
	/*
	 * The three CONFIGURATION actions. They were defined end to end — label, capability requirement,
	 * glyph, and a footer rig ready to draw them — and then never offered by this function, so
	 * `/wallet/methods` had no way to add a method, `/wallet/payouts` no way to change the schedule it
	 * described as changeable, and an eligible Smoother no way to enrol. Each screen's empty state
	 * pointed at "the action bar" for a control the action bar was never given.
	 *
	 * They sit AFTER the movement actions deliberately: on the Overview these are the tail, and the
	 * rig's `VIEW_ACTION` map promotes each one to the lead on the page it belongs to.
	 */
	if (caps.includes("add_funds")) actions.push("add_method");
	if (caps.includes("withdraw")) actions.push("set_payout");
	/* `eligible` only: the label is "Smooth income", which is an offer, not a settings screen. An
	   already-enrolled subject needs an ADJUST action that does not exist yet, and offering them a
	   control whose label misdescribes it is worse than offering nothing. */
	if (personal?.incomeSmoother?.status === "eligible") actions.push("enrol_smoother");
	if (variant !== "personal" && !caps.includes("spend")) actions.push("request_spend");
	return actions;
}
// #endregion

// #region Variant extras
function personalExtras(
	seed: WalletSeed,
	isFreelancer: boolean,
	display: string,
	locale: string,
	sim: WalletSim,
): PersonalExtras {
	const st = stateFor(`${seed.scope}:${seed.id}`);
	if (!isFreelancer) {
		// Individual client — funding + spend context, no earner cards.
		return {
			incomeSmoother: null,
			taxPot: null,
			projectedFromLocked: null,
			fundingSource: "Visa ·· 6411",
			spentThisMonth: toMoney(184_500, seed.currency, display, locale),
		};
	}
	return {
		incomeSmoother: resolveSmoother(seed, display, locale, sim.smoother ?? "auto"),
		taxPot: {
			id: `${seed.id}-taxpot`,
			purpose: "tax",
			name: "Tax set-aside",
			balance: toMoney(96_400, seed.currency, display, locale),
			autoAllocateBp: 2000,
		},
		projectedFromLocked: toMoney(Math.round(st.lockedMinor * 0.9), seed.currency, display, locale),
		fundingSource: null,
		spentThisMonth: null,
	};
}

/** Resolve the Income Smoother card state (eligibility gate: 3 months history + volume). */
function resolveSmoother(
	seed: WalletSeed,
	display: string,
	locale: string,
	sim: SimSmoother,
): IncomeSmootherState {
	const st = stateFor(`${seed.scope}:${seed.id}`);
	const enrolled = sim === "enrolled" || (sim === "auto" && st.incomeSmootherEnrolled);
	const status: IncomeSmootherState["status"] = sim === "ineligible"
		? "ineligible"
		: sim === "eligible"
		? "eligible"
		: enrolled
		? "enrolled"
		: "eligible";
	const target = st.incomeSmootherTargetMinor ?? 420_000;
	return {
		status,
		feeBp: 50,
		monthsRequired: 3,
		monthsElapsed: status === "ineligible" ? 1 : 6,
		weeksToGo: status === "ineligible" ? 8 : 0,
		targetMonthly: status === "enrolled" ? toMoney(target, seed.currency, display, locale) : null,
		projected: status === "enrolled"
			? toMoney(Math.round(target * 0.98), seed.currency, display, locale)
			: null,
	};
}

function teamExtras(seed: WalletSeed, display: string, locale: string): TeamExtras {
	const rule = seed.splitRule ?? { type: "co_op", vaultBp: 1000 };
	const grossMinor = 480_000;
	const outcome = previewSplit(grossMinor, rule, seed.members);
	const shares: SplitShare[] = outcome.shares
		.filter((s) => s.minor > 0 || rule.type === "benevolent_dictator")
		.map((s) => ({
			name: s.member.name,
			handle: s.member.handle,
			amount: toMoney(s.minor, seed.currency, display, locale),
			shareBp: s.shareBp,
		}));
	const splitRule: SplitRuleView = {
		ruleType: rule.type,
		label: splitLabel(rule.type),
		vaultBp: rule.vaultBp,
		finderHandle: rule.finderHandle ?? null,
		finderBp: rule.finderBp ?? null,
		previewGross: toMoney(grossMinor, seed.currency, display, locale),
		previewFee: toMoney(outcome.feeMinor, seed.currency, display, locale),
		previewVault: toMoney(outcome.vaultMinor, seed.currency, display, locale),
		previewShares: shares,
	};
	const members: SplitMember[] = seed.members.map((m) => ({
		userId: m.userId,
		handle: m.handle,
		name: m.name,
		avatar: m.avatar,
		stakeBp: m.stakeBp,
		role: m.role,
	}));
	return {
		splitRule,
		members,
		vaultBalance: toMoney(
			Math.round(stateFor(`${seed.scope}:${seed.id}`).availableMinor * 0.18),
			seed.currency,
			display,
			locale,
		),
	};
}

function businessExtras(seed: WalletSeed, display: string, locale: string): BusinessExtras {
	const budget = seed.budgetMinor ?? 3_000_000;
	const spent = Math.round(budget * (0.42 + frac(`${seed.id}:burn`) * 0.3));
	const burnDown: BudgetBurn = {
		label: "July operating budget",
		budget: toMoney(budget, seed.currency, display, locale),
		spent: toMoney(spent, seed.currency, display, locale),
		remaining: toMoney(budget - spent, seed.currency, display, locale),
		utilizationBp: Math.round(spent / budget * 10000),
		points: burnPoints(seed, budget, spent),
	};
	return {
		burnDown,
		caps: spendingCaps(seed, display, locale),
		invoicesDue: 3,
		invoicesDueAmount: toMoney(268_000, seed.currency, display, locale),
	};
}

function burnPoints(seed: WalletSeed, budget: number, spent: number): BudgetBurn["points"] {
	const days = 30;
	const pts: BudgetBurn["points"] = [];
	let actual = 0;
	for (let d = 0; d <= days; d += 3) {
		const planned = Math.round(budget * (d / days));
		actual = Math.min(
			spent,
			Math.round(spent * (d / days) * (0.8 + frac(`${seed.id}:bp:${d}`) * 0.5)),
		);
		pts.push({
			label: new Date(NOW - (days - d) * DAY).toLocaleDateString("en-GB", {
				day: "numeric",
				month: "short",
			}),
			plannedMinor: planned,
			actualMinor: actual,
		});
	}
	return pts;
}

function spendingCaps(seed: WalletSeed, display: string, locale: string): SpendingCapView[] {
	return seed.members
		.filter((m) => m.role === "pm" || m.role === "admin")
		.map((m, i) => {
			const capMinor = 500_000 + i * 250_000;
			const spentMinor = Math.round(capMinor * (0.3 + frac(`${seed.id}:cap:${m.handle}`) * 0.65));
			return {
				id: `${seed.id}-cap-${m.handle}`,
				memberName: m.name,
				memberHandle: m.handle,
				avatar: m.avatar,
				cap: toMoney(capMinor, seed.currency, display, locale),
				spent: toMoney(spentMinor, seed.currency, display, locale),
				interval: "monthly" as const,
				utilizationBp: Math.round(spentMinor / capMinor * 10000),
				resetsLabel: "Resets 1 Aug",
			};
		});
}
// #endregion

// #region Wallet ref + role resolution
/** The acting user's coarse role on a wallet, honouring the simulated vault role. */
function resolveViewerRole(seed: WalletSeed, sim: WalletSim): VaultRole {
	if (seed.scope === "personal") return "owner";
	return sim.vaultRole ?? seed.viewerRole;
}

function walletRef(seed: WalletSeed, display: string, locale: string, sim: WalletSim): WalletRef {
	const st = stateFor(`${seed.scope}:${seed.id}`);
	return {
		scope: seed.scope,
		id: seed.id,
		handle: seed.handle,
		name: seed.name,
		avatar: seed.avatar,
		role: seed.scope === "personal" ? null : resolveViewerRole(seed, sim),
		available: toMoney(st.availableMinor, seed.currency, display, locale),
	};
}
// #endregion

// #region Resolve the target wallet + display currency
/** Resolve which seed the query targets (default: the active context, else personal). */
function resolveSeed(query: WalletQuery): WalletSeed | "aggregate" {
	const w = query.wallet;
	if (w === "aggregate") return "aggregate";
	if (w) {
		const [scope, id] = w.split(":");
		if (scope === "personal") return SEEDS[0];
		const found = SEEDS.find((s) => s.scope === scope && s.id === id);
		if (found) return found;
	}
	return SEEDS[0]; // personal wallet is the default active context
}

/** The display currency: the query's, else the wallet's own currency. */
function displayCcy(query: WalletQuery, seedCurrency: string): string {
	return (query.display || seedCurrency).toUpperCase();
}

const LOCALE = "en-GB";
// #endregion

// #region Public reads
/** The wallet switcher — the active wallet, the selectable accounts, and the aggregate rollup. */
export function switcher(query: WalletQuery): WalletSwitcher {
	const active = resolveSeed(query);
	const display = query.display?.toUpperCase() || "GBP";
	const accounts = SEEDS.map((s) => walletRef(s, display, LOCALE, query.sim ?? {}));
	// Aggregate = personal + every vault (exclude system wallets — none surfaced).
	let sumMinor = 0;
	for (const s of SEEDS) {
		sumMinor += convertMinor(stateFor(`${s.scope}:${s.id}`).availableMinor, s.currency, display);
	}
	const aggregate: WalletRef = {
		scope: "aggregate",
		id: "",
		handle: null,
		name: "All accounts",
		avatar: null,
		role: null,
		available: {
			minor: sumMinor,
			currency: display,
			display: formatMoney(sumMinor, display, LOCALE),
			origin: null,
		},
	};
	const activeRef = active === "aggregate"
		? aggregate
		: walletRef(active, display, LOCALE, query.sim ?? {});
	return { active: activeRef, accounts, aggregate };
}

// #region Standing (the earned rung + its commission taper)
/**
 * The five-rung ladder, verbatim from `finance-model.md` §16.3. Score + stage floors are BOTH gates —
 * a flawless single engagement must not vault a subject to the top — and only the commission column
 * tapers (the flat 5% service fee never does, §16.4).
 */
const STANDING_LADDER: readonly StandingRung[] = [
	{ level: 1, label: "New", minScore: 0, minStages: 0, commissionBp: 800 },
	{ level: 2, label: "Established", minScore: 55, minStages: 5, commissionBp: 800 },
	{ level: 3, label: "Trusted", minScore: 70, minStages: 20, commissionBp: 750 },
	{ level: 4, label: "Expert", minScore: 82, minStages: 50, commissionBp: 700 },
	{ level: 5, label: "Elite", minScore: 92, minStages: 120, commissionBp: 650 },
];

/** The weighted Reliability Index inputs (§16.3 — weights sum to 100). */
const STANDING_COMPONENTS: readonly {
	key: StandingComponent["key"];
	label: string;
	weight: number;
}[] = [
	{ key: "completion", label: "Stage completion", weight: 25 },
	{ key: "on_time", label: "On-time delivery", weight: 25 },
	{ key: "reviews", label: "Review scores", weight: 20 },
	{ key: "dispute_free", label: "Dispute-free rate", weight: 15 },
	{ key: "workload", label: "Workload reliability", weight: 10 },
	{ key: "tenure", label: "Tenure", weight: 5 },
];

/** The rung a `(score, stagesCompleted)` pair resolves to — mirrors `org.fn_level_for_score`. */
function rungFor(score: number, stages: number): StandingRung {
	let resolved = STANDING_LADDER[0];
	for (const rung of STANDING_LADDER) {
		if (score >= rung.minScore && stages >= rung.minStages) resolved = rung;
	}
	return resolved;
}

/** The `(score, stages)` pair a dev-sim knob forces, or `null` to derive from the subject. */
function simStandingPair(sim: SimStanding | undefined): { score: number; stages: number } | null {
	switch (sim) {
		case "l1":
			return { score: 41.5, stages: 2 };
		case "l2":
			return { score: 62.4, stages: 11 };
		case "l3":
			return { score: 74.8, stages: 27 };
		case "l4":
			return { score: 86.2, stages: 63 };
		case "l5":
			return { score: 95.1, stages: 148 };
		// The honest edge case: the SCORE gate for L5 is cleared but the 120-stage volume floor is
		// not, so the subject is still L4. The gauge must not imply promotion.
		case "stage_floor":
			return { score: 93.6, stages: 74 };
		default:
			return null;
	}
}

/**
 * The Standing projection for a wallet. Buyer-only subjects carry NO Standing (a client wallet, a
 * business/organisation vault, the aggregate) → `null`, so the surface omits the gauge entirely
 * rather than drawing an empty one.
 *
 * Everything is derived deterministically from the seed handle (no RNG); the commission money is
 * priced against the seed's own lifetime volume so the figures agree with the balances above them.
 */
function standingFor(
	seed: WalletSeed,
	variant: WalletVariant,
	isFreelancer: boolean,
	display: string,
	locale: string,
	sim: WalletSim,
): WalletStanding | null {
	// Standing is a SELLER signal. A buyer-only individual and every business/organisation vault
	// carry none (finance-model.md §16.3 · entitlements `standingLevel` is null for buyer subjects).
	if (variant === "business") return null;
	if (variant === "personal" && !isFreelancer) return null;

	const forced = simStandingPair(sim.standing);
	const f = frac(`standing:${seed.id}`);
	const score = forced?.score ?? Math.round((58 + f * 36) * 10) / 10;
	const stages = forced?.stages ?? 12 + Math.floor(f * 70);

	const current = rungFor(score, stages);
	const next = STANDING_LADDER.find((r) => r.level === current.level + 1) ?? null;

	const scoreToNext = next ? Math.max(0, Math.round((next.minScore - score) * 10) / 10) : 0;
	const stagesToNext = next ? Math.max(0, next.minStages - stages) : 0;
	const blockedBy: StandingGate = !next
		? "none"
		: scoreToNext > 0 && stagesToNext > 0
		? "both"
		: scoreToNext > 0
		? "score"
		: stagesToNext > 0
		? "stages"
		: "none";

	// Per-component scores: distribute around the index so the disclosure sums back to `score`.
	const components: StandingComponent[] = STANDING_COMPONENTS.map((c, i) => {
		const spread = (frac(`sc:${seed.id}:${c.key}`) - 0.5) * 14;
		return {
			key: c.key,
			label: c.label,
			weight: c.weight,
			scored: Math.min(100, Math.max(0, Math.round((score + spread + i * 0.4) * 10) / 10)),
		};
	});

	// The taper made concrete: price the CURRENT and NEXT rates against the trailing-12m volume the
	// commission was actually charged on. Derived from the seed's own lifetime, never invented.
	const volumeMinor = Math.round(seed.lifetimeMinor * 0.34);
	const paidMinor = Math.round((volumeMinor * current.commissionBp) / 10000);
	const atNextMinor = next && next.commissionBp !== current.commissionBp
		? Math.round((volumeMinor * next.commissionBp) / 10000)
		: null;

	return {
		subject: variant === "team" ? "team" : "freelancer",
		level: current.level,
		label: current.label,
		score,
		stagesCompleted: stages,
		ladder: [...STANDING_LADDER],
		next,
		scoreToNext,
		stagesToNext,
		blockedBy,
		commissionBp: current.commissionBp,
		nextCommissionBp: next && next.commissionBp !== current.commissionBp ? next.commissionBp : null,
		platformFeeBp: PLATFORM_FEE_BP,
		components,
		commissionPaid: toMoney(paidMinor, seed.currency, display, locale),
		commissionAtNext: atNextMinor === null
			? null
			: toMoney(atNextMinor, seed.currency, display, locale),
		volumeWindow: toMoney(volumeMinor, seed.currency, display, locale),
		windowLabel: "Last 12 months",
	};
}
// #endregion

/** The Overview hub projection for the query's wallet (or the aggregate). */
export function overview(query: WalletQuery): WalletOverview {
	const seed = resolveSeed(query);
	const sim = query.sim ?? {};
	const isFreelancer = query.isFreelancer ?? true;

	if (seed === "aggregate") return aggregateOverview(query);

	const display = displayCcy(query, seed.currency);
	const variant = walletVariant(seed.scope);
	const role = resolveViewerRole(seed, sim);
	const caps = capabilitiesForRole(role);
	const verification = resolveVerification(variant, isFreelancer, sim.kyc ?? "verified");
	const bal = resolveBalances(seed, sim.fundMix ?? "normal");
	const lines = rawLedger(seed).slice(0, 8).map((r) => toLine(r, display, LOCALE));
	/*
	 * Hoisted out of the literal below because `quickActionsFor` needs the Smoother's state: the enrol
	 * affordance is offered only where there is something to enrol IN, and `SmootherPanel` deliberately
	 * renders no CTA of its own (the body owns viewing and selecting only).
	 */
	const personal = variant === "personal"
		? personalExtras(seed, isFreelancer, display, LOCALE, sim)
		: null;

	return {
		ref: walletRef(seed, display, LOCALE, sim),
		variant,
		balances: {
			currency: display,
			availableCents: convertMinor(bal.availableMinor, seed.currency, display),
			lockedCents: convertMinor(bal.lockedMinor, seed.currency, display),
			pendingCents: convertMinor(bal.pendingMinor, seed.currency, display),
			onHoldCents: convertMinor(bal.onHoldMinor, seed.currency, display),
			lifetimeCents: convertMinor(bal.lifetimeMinor, seed.currency, display),
		},
		available: toMoney(bal.availableMinor, seed.currency, display, LOCALE),
		locked: toMoney(bal.lockedMinor, seed.currency, display, LOCALE),
		pending: toMoney(bal.pendingMinor, seed.currency, display, LOCALE),
		onHold: toMoney(bal.onHoldMinor, seed.currency, display, LOCALE),
		lifetime: toMoney(bal.lifetimeMinor, seed.currency, display, LOCALE),
		// The whole the four-state meter divides — summed server-side so the client never totals money.
		capital: toMoney(
			bal.availableMinor + bal.lockedMinor + bal.pendingMinor + bal.onHoldMinor,
			seed.currency,
			display,
			LOCALE,
		),
		lockedStageCount: bal.lockedMinor > 0 ? 1 + (hash(`stages:${seed.id}`) % 4) : 0,
		heldCaseCount: bal.onHoldMinor > 0 ? 1 + (hash(`cases:${seed.id}`) % 2) : 0,
		incoming: incoming(seed, display, LOCALE),
		flow: flowSeries(seed, 90, 12, display),
		flowRange: "90d",
		recent: lines,
		quickActions: quickActionsFor(variant, caps, verification, personal),
		capabilities: caps,
		verification,
		standing: standingFor(seed, variant, isFreelancer, display, LOCALE, sim),
		personal,
		team: variant === "team" ? teamExtras(seed, display, LOCALE) : null,
		business: variant === "business" ? businessExtras(seed, display, LOCALE) : null,
	};
}

/** The read-only "All accounts" aggregate overview (a personal rollup — no actions). */
function aggregateOverview(query: WalletQuery): WalletOverview {
	const display = query.display?.toUpperCase() || "GBP";
	let available = 0, locked = 0, pending = 0, onHold = 0, lifetime = 0;
	const allLines: RawLine[] = [];
	for (const s of SEEDS) {
		const bal = resolveBalances(s, query.sim?.fundMix ?? "normal");
		available += convertMinor(bal.availableMinor, s.currency, display);
		locked += convertMinor(bal.lockedMinor, s.currency, display);
		pending += convertMinor(bal.pendingMinor, s.currency, display);
		onHold += convertMinor(bal.onHoldMinor, s.currency, display);
		lifetime += convertMinor(bal.lifetimeMinor, s.currency, display);
		for (const r of baseLedger(s).slice(0, 3)) {
			allLines.push({
				...r,
				amountMinor: convertMinor(r.amountMinor, r.currency, display),
				currency: display,
			});
		}
	}
	allLines.sort((a, b) => b.at - a.at);
	const money = (m: number): MoneyView => ({
		minor: m,
		currency: display,
		display: formatMoney(m, display, LOCALE),
		origin: null,
	});
	const flow: FlowPoint[] = SEEDS.reduce((acc, s) => {
		const series = flowSeries(s, 90, 12, display);
		return series.map((p, i) => ({
			label: p.label,
			inMinor: (acc[i]?.inMinor ?? 0) + p.inMinor,
			outMinor: (acc[i]?.outMinor ?? 0) + p.outMinor,
		}));
	}, [] as FlowPoint[]);
	const ref = switcher(query).aggregate;
	return {
		ref,
		variant: "personal",
		balances: {
			currency: display,
			availableCents: available,
			lockedCents: locked,
			pendingCents: pending,
			onHoldCents: onHold,
			lifetimeCents: lifetime,
		},
		available: money(available),
		locked: money(locked),
		pending: money(pending),
		onHold: money(onHold),
		lifetime: money(lifetime),
		capital: money(available + locked + pending + onHold),
		lockedStageCount: 0,
		heldCaseCount: 0,
		incoming: [],
		flow,
		flowRange: "90d",
		recent: allLines.slice(0, 8).map((r) => toLine(r, display, LOCALE)),
		quickActions: [], // aggregate is read-only — actions live on the individual wallets
		capabilities: ["view"],
		verification: resolveVerification("personal", query.isFreelancer ?? true, "verified"),
		// The rollup spans several subjects, so no single rung applies — the gauge is omitted.
		standing: null,
		personal: null,
		team: null,
		business: null,
	};
}

/** Filter + sort + page the ledger for the Transactions table. */
export function transactions(query: WalletQuery, params: TransactionListParams): TransactionPage {
	const seed = resolveSeed(query);
	const seeds = seed === "aggregate" ? SEEDS : [seed];
	const display = seed === "aggregate"
		? (query.display?.toUpperCase() || "GBP")
		: displayCcy(query, seed.currency);

	let raws: RawLine[] = [];
	for (const s of seeds) raws.push(...rawLedger(s));
	raws.sort((a, b) => b.at - a.at);

	if (params.direction) raws = raws.filter((r) => r.direction === params.direction);
	if (params.fundState) raws = raws.filter((r) => r.fundState === params.fundState);
	if (params.category) raws = raws.filter((r) => r.category === params.category);
	if (params.project) raws = raws.filter((r) => r.refId === params.project);
	if (params.from) {
		const fromMs = Date.parse(params.from);
		if (Number.isFinite(fromMs)) raws = raws.filter((r) => r.at >= fromMs);
	}
	if (params.to) {
		const toMs = Date.parse(params.to);
		if (Number.isFinite(toMs)) raws = raws.filter((r) => r.at <= toMs);
	}
	if (params.search) {
		const q = params.search.toLowerCase();
		raws = raws.filter((r) =>
			r.title.toLowerCase().includes(q) || (r.counterparty?.toLowerCase().includes(q) ?? false)
		);
	}

	const sort = params.sort ?? "date";
	const asc = (params.dir ?? "desc") === "asc";
	raws.sort((a, b) => {
		let c = 0;
		if (sort === "amount") c = a.amountMinor - b.amountMinor;
		else if (sort === "counterparty") {
			c = (a.counterparty ?? "").localeCompare(b.counterparty ?? "");
		} else if (sort === "category") c = a.category.localeCompare(b.category);
		else if (sort === "status") c = a.fundState.localeCompare(b.fundState);
		else c = a.at - b.at;
		return asc ? c : -c;
	});

	const total = raws.length;
	const limit = Math.min(200, Math.max(1, params.limit ?? 40));
	let start = 0;
	if (params.cursor) {
		const at = raws.findIndex((r) => r.id === params.cursor);
		start = at >= 0 ? at + 1 : 0;
	}
	const pageRaws = raws.slice(start, start + limit);
	const nextCursor = start + limit < total ? pageRaws[pageRaws.length - 1]?.id ?? null : null;

	return {
		items: pageRaws.map((r) => toLine(r, display, LOCALE)),
		hasMore: start + limit < total,
		nextCursor,
		total,
		projects: PROJECTS.slice(),
	};
}

/** The Activity charts projection. */
export function activity(query: WalletQuery, range: ActivityRange): ActivityView {
	const seed = resolveSeed(query);
	const seeds = seed === "aggregate" ? SEEDS : [seed];
	const display = seed === "aggregate"
		? (query.display?.toUpperCase() || "GBP")
		: displayCcy(query, (seed as WalletSeed).currency);
	const days = range === "30d" ? 30 : range === "90d" ? 90 : 365;
	const buckets = range === "30d" ? 30 : range === "90d" ? 13 : 12;

	// Aggregate flow across the target wallets.
	let flow: FlowPoint[] = [];
	for (const s of seeds) {
		const series = flowSeries(s, days, buckets, display);
		flow = flow.length === 0 ? series : flow.map((p, i) => ({
			label: p.label,
			inMinor: p.inMinor + series[i].inMinor,
			outMinor: p.outMinor + series[i].outMinor,
		}));
	}

	// By category + by project, from the ledger.
	const raws: RawLine[] = [];
	for (const s of seeds) {
		for (const r of rawLedger(s)) {
			raws.push({
				...r,
				amountMinor: convertMinor(r.amountMinor, r.currency, display),
				currency: display,
			});
		}
	}
	const catTotals = new Map<TxnCategory, number>();
	const projTotals = new Map<string, number>();
	let totalIn = 0, totalOut = 0;
	for (const r of raws) {
		catTotals.set(r.category, (catTotals.get(r.category) ?? 0) + r.amountMinor);
		if (r.refId) projTotals.set(r.refId, (projTotals.get(r.refId) ?? 0) + r.amountMinor);
		if (r.direction === "credit") totalIn += r.amountMinor;
		else totalOut += r.amountMinor;
	}
	const catSum = [...catTotals.values()].reduce((a, b) => a + b, 0) || 1;
	const byCategory: CategorySlice[] = [...catTotals.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([category, minor]) => ({
			category,
			amount: {
				minor,
				currency: display,
				display: formatMoney(minor, display, LOCALE),
				origin: null,
			},
			shareBp: Math.round(minor / catSum * 10000),
		}));
	const byProject = [...projTotals.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(([id, minor]) => {
			const p = PROJECTS.find((x) => x.id === id);
			return {
				id,
				name: p?.name ?? id,
				amount: {
					minor,
					currency: display,
					display: formatMoney(minor, display, LOCALE),
					origin: null,
				},
			};
		});

	const money = (m: number): MoneyView => ({
		minor: m,
		currency: display,
		display: formatMoney(m, display, LOCALE),
		origin: null,
	});
	const first = seeds[0];
	const variant = walletVariant(first.scope);
	const isFreelancer = query.isFreelancer ?? true;
	return {
		range,
		flow,
		byCategory,
		byProject,
		totalIn: money(totalIn),
		totalOut: money(totalOut),
		net: money(totalIn - totalOut),
		lockedCapital: variant !== "business" && isFreelancer
			? money(
				convertMinor(stateFor(`${first.scope}:${first.id}`).lockedMinor, first.currency, display),
			)
			: null,
		projectedIncome: variant !== "business" && isFreelancer
			? money(
				convertMinor(
					Math.round(stateFor(`${first.scope}:${first.id}`).lockedMinor * 0.9),
					first.currency,
					display,
				),
			)
			: null,
		burnDown: variant === "business" ? businessExtras(first, display, LOCALE).burnDown : null,
	};
}
// #endregion

// #region Methods / funding / payouts / invoices / access reads
function fundingMethods(seed: WalletSeed): FundingMethodSeed[] {
	const st = stateFor(`${seed.scope}:${seed.id}`);
	const base: FundingMethodSeed[] = seed.scope === "personal"
		? [
			{
				id: "pm-visa",
				label: "Visa credit",
				brand: "Visa",
				last4: "6411",
				role: "both",
				isDefaultFunding: true,
				isDefaultPayout: false,
			},
			{
				id: "pm-bank",
				label: "Monzo current",
				brand: "Monzo",
				last4: "8820",
				role: "payout",
				isDefaultFunding: false,
				isDefaultPayout: true,
			},
		]
		: [
			{
				id: "pm-corp",
				label: "Corporate card",
				brand: "Amex",
				last4: "1004",
				role: "funding",
				isDefaultFunding: true,
				isDefaultPayout: false,
			},
			{
				id: "pm-payout",
				label: "Business account",
				brand: "Barclays",
				last4: "5567",
				role: "payout",
				isDefaultFunding: false,
				isDefaultPayout: true,
			},
		];
	return [...base, ...st.extraMethods];
}

export function methods(query: WalletQuery): MethodsView {
	const seed = resolveSeed(query);
	if (seed === "aggregate") return { methods: [] };
	return {
		methods: fundingMethods(seed).map((m) => ({
			id: m.id,
			provider: "stripe",
			brand: m.brand,
			last4: m.last4,
			label: m.label,
			methodRole: m.role,
			isDefaultFunding: m.isDefaultFunding,
			isDefaultPayout: m.isDefaultPayout,
			status: "active" as const,
		})),
	};
}

export function funding(query: WalletQuery): FundingView {
	const seed = resolveSeed(query);
	if (seed === "aggregate") {
		return { sources: [], rules: [], balance: switcher(query).aggregate.available };
	}
	const display = displayCcy(query, seed.currency);
	const st = stateFor(`${seed.scope}:${seed.id}`);
	const sources: FundingSource[] = fundingMethods(seed)
		.filter((m) => m.role === "funding" || m.role === "both")
		.map((m) => ({
			id: m.id,
			label: m.label,
			brand: m.brand,
			last4: m.last4,
			role: m.role,
			isDefault: m.isDefaultFunding,
		}));
	const baseRules: DepositRuleSeed[] = seed.scope === "personal"
		? [{
			id: "dr-1",
			amountMinor: 20_000,
			interval: "weekly",
			sourceLabel: "Visa ·· 6411",
			nextRunMs: NOW + 4 * DAY,
			active: true,
			failing: false,
		}]
		: [{
			id: "dr-2",
			amountMinor: 500_000,
			interval: "monthly",
			sourceLabel: "Corporate card",
			nextRunMs: NOW + 12 * DAY,
			active: true,
			failing: seed.id === "verdant-studio",
		}];
	const rules: DepositRuleView[] = [...baseRules, ...st.extraRules].map((r) => ({
		id: r.id,
		amount: toMoney(r.amountMinor, seed.currency, display, LOCALE),
		interval: r.interval,
		sourceLabel: r.sourceLabel,
		nextRunLabel: dateLabel(r.nextRunMs).replace("Today", "today"),
		active: r.active,
		failureNote: r.failing ? "Last run failed — card declined. Retrying in 2 days." : null,
	}));
	return { sources, rules, balance: toMoney(st.availableMinor, seed.currency, display, LOCALE) };
}

export function payouts(query: WalletQuery): PayoutsView {
	const seed = resolveSeed(query);
	const sim = query.sim ?? {};
	if (seed === "aggregate") {
		const zero = switcher(query).aggregate.available;
		return {
			schedule: {
				mode: "manual",
				destinationLabel: null,
				threshold: null,
				instant: false,
				nextRunLabel: null,
			},
			destinations: [],
			incomeSmoother: null,
			instantAvailable: zero,
			instantFeeLabel: "Select a wallet to withdraw",
			history: [],
			verification: resolveVerification("personal", query.isFreelancer ?? true, "verified"),
		};
	}
	const display = displayCcy(query, seed.currency);
	const st = stateFor(`${seed.scope}:${seed.id}`);
	const variant = walletVariant(seed.scope);
	const destinations: PayoutDestination[] = fundingMethods(seed)
		.filter((m) => m.role === "payout" || m.role === "both")
		.map((m) => ({
			id: m.id,
			label: m.label,
			brand: m.brand,
			last4: m.last4,
			isDefault: m.isDefaultPayout,
		}));
	const schedule: PayoutScheduleView = {
		mode: st.payoutMode as PayoutScheduleView["mode"],
		destinationLabel: destinations.find((d) => d.isDefault)?.label ?? destinations[0]?.label ??
			null,
		threshold: st.payoutThresholdMinor
			? toMoney(st.payoutThresholdMinor, seed.currency, display, LOCALE)
			: null,
		instant: st.payoutInstant,
		nextRunLabel: st.payoutMode === "manual" ? null : "Fri 24 Jul",
	};
	const history: PayoutHistoryRow[] = Array.from({ length: 6 }, (_, i) => {
		const at = NOW - (i * 7 + 2) * DAY;
		const amt = 120_000 + (hash(`${seed.id}:po:${i}`) % 180_000);
		return {
			id: `po-${seed.id}-${i}`,
			amount: toMoney(amt, seed.currency, display, LOCALE),
			status: (i === 0 ? "in_transit" : i === 4 ? "failed" : "paid") as PayoutHistoryRow["status"],
			destinationLabel: destinations[0]?.label ?? "Bank account",
			at: new Date(at).toISOString(),
			dateLabel: dateLabel(at),
		};
	});
	return {
		schedule,
		destinations,
		incomeSmoother: variant !== "business"
			? resolveSmoother(seed, display, LOCALE, sim.smoother ?? "auto")
			: null,
		instantAvailable: toMoney(st.availableMinor, seed.currency, display, LOCALE),
		// Instant Payout fee magnitude is TBD platform-wide (finance-model §1.4) — never a fabricated %.
		instantFeeLabel: "A small fee applies — shown before you confirm",
		history,
		verification: resolveVerification(variant, query.isFreelancer ?? true, sim.kyc ?? "verified"),
	};
}

export function invoices(query: WalletQuery): InvoicesView {
	const seed = resolveSeed(query);
	if (seed === "aggregate" || seed.scope !== "business") {
		return { current: null, statements: [], bills: [], caps: [] };
	}
	const display = displayCcy(query, seed.currency);
	const statements: StatementRow[] = Array.from({ length: 6 }, (_, i) => {
		const start = new Date(NOW - (i + 1) * 30 * DAY);
		const inMinor = 800_000 + (hash(`${seed.id}:st:${i}:in`) % 900_000);
		const outMinor = 600_000 + (hash(`${seed.id}:st:${i}:out`) % 700_000);
		return {
			id: `st-${seed.id}-${i}`,
			periodLabel: start.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
			totalIn: toMoney(inMinor, seed.currency, display, LOCALE),
			totalOut: toMoney(outMinor, seed.currency, display, LOCALE),
			totalFees: toMoney(Math.round(inMinor * 0.05), seed.currency, display, LOCALE),
			status: (i === 0 ? "issued" : "final") as StatementRow["status"],
			hasPdf: i !== 0,
		};
	});
	const bills: BillRow[] = [
		{
			id: `bill-${seed.id}-1`,
			label: "Stage invoice · Monarch design system",
			amount: toMoney(148_000, seed.currency, display, LOCALE),
			dueLabel: "Due in 4 days",
			status: "issued",
			overdue: false,
		},
		{
			id: `bill-${seed.id}-2`,
			label: "Consolidated monthly · June",
			amount: toMoney(120_000, seed.currency, display, LOCALE),
			dueLabel: "Overdue 2 days",
			status: "overdue",
			overdue: true,
		},
	];
	return {
		current: {
			id: `st-${seed.id}-current`,
			periodLabel: "July · accruing",
			totalIn: toMoney(640_000, seed.currency, display, LOCALE),
			totalOut: toMoney(410_000, seed.currency, display, LOCALE),
			totalFees: toMoney(32_000, seed.currency, display, LOCALE),
			status: "draft",
			hasPdf: false,
		},
		statements,
		bills,
		caps: spendingCaps(seed, display, LOCALE),
	};
}

export function access(query: WalletQuery): AccessView {
	const seed = resolveSeed(query);
	const sim = query.sim ?? {};
	if (seed === "aggregate" || seed.scope === "personal") {
		return { members: [], caps: [], approvals: [], audit: [], viewerCapabilities: ["view"] };
	}
	const display = displayCcy(query, seed.currency);
	const members: VaultMember[] = seed.members.map((m) => ({
		userId: m.userId,
		handle: m.handle,
		name: m.name,
		avatar: m.avatar,
		role: m.role,
		capabilities: capabilitiesForRole(m.role),
	}));
	const approvals: SpendApprovalView[] = [
		{
			id: `ap-${seed.id}-1`,
			requesterName: seed.members[2]?.name ?? "Tomas P.",
			requesterHandle: seed.members[2]?.handle ?? "tomasp",
			amount: toMoney(340_000, seed.currency, display, LOCALE),
			reason: "Fund the Monarch design-system stage escrow",
			status: "pending",
			at: new Date(NOW - 6 * HOUR).toISOString(),
			dateLabel: "6 hours ago",
		},
	];
	const audit: AuditRow[] = Array.from({ length: 8 }, (_, i) => {
		const actor = seed.members[i % seed.members.length];
		const at = NOW - (i * 8 + 3) * HOUR;
		const actions = ["add_funds", "spend", "distribute", "withdraw", "transfer"] as const;
		const action = actions[i % actions.length];
		return {
			id: `au-${seed.id}-${i}`,
			actorName: actor.name,
			actorHandle: actor.handle,
			action,
			amount: toMoney(
				40_000 + (hash(`${seed.id}:au:${i}`) % 220_000),
				seed.currency,
				display,
				LOCALE,
			),
			label: `${actor.name} · ${action.replace("_", " ")}`,
			at: new Date(at).toISOString(),
			dateLabel: dateLabel(at),
		};
	});
	return {
		members,
		caps: spendingCaps(seed, display, LOCALE),
		approvals,
		audit,
		viewerCapabilities: capabilitiesForRole(resolveViewerRole(seed, sim)),
	};
}
// #endregion

// #region Write mutations (stub — mutate the session store, return the fresh overview)
/** Append a mutation ledger line and adjust the running available balance. */
function pushLine(
	key: string,
	seedCurrency: string,
	line: Omit<RawLine, "id" | "at" | "currency"> & { currency?: string },
): void {
	const st = stateFor(key);
	st.extraLines.unshift({
		id: `mx-${++seq}`,
		at: NOW,
		currency: line.currency ?? seedCurrency,
		...line,
	} as RawLine);
}

/** Resolve the seed a mutation targets (never the aggregate). */
function mutationSeed(scope: string, contextId: string): WalletSeed | null {
	if (scope === "personal") return SEEDS[0];
	return SEEDS.find((s) => s.scope === scope && s.id === contextId) ?? null;
}

export interface MutationOutcome {
	ok: boolean;
	message: string;
	overview?: WalletOverview;
	/** A soft failure status (422/403/404) when `ok` is false. */
	status?: number;
}

function outcome(
	seed: WalletSeed,
	display: string | null,
	sim: WalletSim | undefined,
	message: string,
): MutationOutcome {
	return {
		ok: true,
		message,
		overview: overview({ wallet: `${seed.scope}:${seed.id}`, display, sim, isFreelancer: true }),
	};
}

export function topUp(
	input: {
		scope: string;
		contextId: string;
		amountMinor: number;
		currency: string;
		display?: string | null;
		sim?: WalletSim;
	},
): MutationOutcome {
	const seed = mutationSeed(input.scope, input.contextId);
	if (!seed) return { ok: false, status: 404, message: "No such wallet." };
	const minor = convertMinor(input.amountMinor, input.currency, seed.currency);
	const st = stateFor(`${seed.scope}:${seed.id}`);
	st.availableMinor += minor;
	st.lifetimeMinor += minor;
	pushLine(`${seed.scope}:${seed.id}`, seed.currency, {
		direction: "credit",
		reason: "deposit",
		title: "Wallet top-up",
		counterparty: null,
		counterpartyHandle: null,
		amountMinor: minor,
		fundState: "available",
		category: "deposit",
		refKind: "deposit",
		refId: null,
		href: null,
	});
	return outcome(seed, input.display ?? null, input.sim, "Wallet topped up.");
}

export function withdraw(
	input: {
		scope: string;
		contextId: string;
		amountMinor: number;
		currency: string;
		instant: boolean;
		display?: string | null;
		sim?: WalletSim;
	},
): MutationOutcome {
	const seed = mutationSeed(input.scope, input.contextId);
	if (!seed) return { ok: false, status: 404, message: "No such wallet." };
	const minor = convertMinor(input.amountMinor, input.currency, seed.currency);
	const st = stateFor(`${seed.scope}:${seed.id}`);
	if (minor > st.availableMinor) {
		return { ok: false, status: 422, message: "Amount exceeds your available balance." };
	}
	st.availableMinor -= minor;
	pushLine(`${seed.scope}:${seed.id}`, seed.currency, {
		direction: "debit",
		reason: "payout",
		title: input.instant ? "Instant payout to bank" : "Payout to bank",
		counterparty: null,
		counterpartyHandle: null,
		amountMinor: minor,
		fundState: "available",
		category: "payout",
		refKind: "payout",
		refId: null,
		href: null,
	});
	return outcome(
		seed,
		input.display ?? null,
		input.sim,
		input.instant ? "Instant payout on its way." : "Withdrawal scheduled.",
	);
}

export function transfer(
	input: {
		fromScope: string;
		fromId: string;
		toScope: string;
		toId: string;
		amountMinor: number;
		currency: string;
		display?: string | null;
		sim?: WalletSim;
	},
): MutationOutcome {
	const from = mutationSeed(input.fromScope, input.fromId);
	const to = mutationSeed(input.toScope, input.toId);
	if (!from || !to) return { ok: false, status: 404, message: "No such wallet." };
	const fromMinor = convertMinor(input.amountMinor, input.currency, from.currency);
	const fromSt = stateFor(`${from.scope}:${from.id}`);
	if (fromMinor > fromSt.availableMinor) {
		return { ok: false, status: 422, message: "Amount exceeds the source balance." };
	}
	fromSt.availableMinor -= fromMinor;
	stateFor(`${to.scope}:${to.id}`).availableMinor += convertMinor(
		input.amountMinor,
		input.currency,
		to.currency,
	);
	pushLine(`${from.scope}:${from.id}`, from.currency, {
		direction: "debit",
		reason: "transfer",
		title: `Transfer to ${to.name}`,
		counterparty: to.name,
		counterpartyHandle: to.handle,
		amountMinor: fromMinor,
		fundState: "available",
		category: "transfer",
		refKind: "transfer",
		refId: null,
		href: null,
	});
	return outcome(from, input.display ?? null, input.sim, "Transfer complete.");
}

export function distribute(
	input: {
		scope: string;
		contextId: string;
		amountMinor: number;
		currency: string;
		display?: string | null;
		sim?: WalletSim;
	},
): MutationOutcome {
	const seed = mutationSeed(input.scope, input.contextId);
	if (!seed || seed.scope !== "team") {
		return { ok: false, status: 422, message: "Only team vaults can distribute." };
	}
	const minor = convertMinor(input.amountMinor, input.currency, seed.currency);
	const st = stateFor(`${seed.scope}:${seed.id}`);
	if (minor > st.availableMinor) {
		return { ok: false, status: 422, message: "Amount exceeds the vault balance." };
	}
	st.availableMinor -= minor;
	pushLine(`${seed.scope}:${seed.id}`, seed.currency, {
		direction: "debit",
		reason: "team_split",
		title: "Distributed to members",
		counterparty: null,
		counterpartyHandle: null,
		amountMinor: minor,
		fundState: "available",
		category: "payout",
		refKind: "payout",
		refId: null,
		href: null,
	});
	return outcome(
		seed,
		input.display ?? null,
		input.sim,
		"Distributed to members per the split ruleset.",
	);
}

export function fundEscrow(
	input: {
		scope: string;
		contextId: string;
		stageId: string;
		amountMinor: number;
		currency: string;
		display?: string | null;
		sim?: WalletSim;
	},
): MutationOutcome {
	const seed = mutationSeed(input.scope, input.contextId);
	if (!seed) return { ok: false, status: 404, message: "No such wallet." };
	const minor = convertMinor(input.amountMinor, input.currency, seed.currency);
	const st = stateFor(`${seed.scope}:${seed.id}`);
	if (minor > st.availableMinor) {
		return { ok: false, status: 422, message: "Amount exceeds your available balance." };
	}
	st.availableMinor -= minor;
	st.lockedMinor += minor;
	pushLine(`${seed.scope}:${seed.id}`, seed.currency, {
		direction: "debit",
		reason: "escrow_hold",
		title: "Escrow funded",
		counterparty: null,
		counterpartyHandle: null,
		amountMinor: minor,
		fundState: "locked",
		category: "escrow",
		refKind: "stage",
		refId: input.stageId,
		href: `/projects/${input.stageId}`,
	});
	return outcome(seed, input.display ?? null, input.sim, "Escrow funded on the stage.");
}

export function addRecurring(
	input: {
		scope: string;
		contextId: string;
		amountMinor: number;
		currency: string;
		interval: "weekly" | "monthly";
		display?: string | null;
		sim?: WalletSim;
	},
): MutationOutcome {
	const seed = mutationSeed(input.scope, input.contextId);
	if (!seed) return { ok: false, status: 404, message: "No such wallet." };
	stateFor(`${seed.scope}:${seed.id}`).extraRules.unshift({
		id: `dr-${++seq}`,
		amountMinor: convertMinor(input.amountMinor, input.currency, seed.currency),
		interval: input.interval,
		sourceLabel: "Default funding source",
		nextRunMs: NOW + (input.interval === "weekly" ? 7 : 30) * DAY,
		active: true,
		failing: false,
	});
	return outcome(seed, input.display ?? null, input.sim, "Recurring deposit created.");
}

export function addMethod(
	input: {
		scope: string;
		contextId: string;
		methodRole: "funding" | "payout" | "both";
		label: string | null;
		display?: string | null;
		sim?: WalletSim;
	},
): MutationOutcome {
	const seed = mutationSeed(input.scope, input.contextId);
	if (!seed) return { ok: false, status: 404, message: "No such wallet." };
	stateFor(`${seed.scope}:${seed.id}`).extraMethods.push({
		id: `pm-${++seq}`,
		label: input.label ?? "New card",
		brand: "Visa",
		last4: String(1000 + (seq % 9000)).slice(0, 4),
		role: input.methodRole,
		isDefaultFunding: false,
		isDefaultPayout: false,
	});
	return outcome(seed, input.display ?? null, input.sim, "Payment method added.");
}

export function setPayout(
	input: {
		scope: string;
		contextId: string;
		mode: string;
		thresholdMinor: number | null;
		instant: boolean;
		currency?: string;
		display?: string | null;
		sim?: WalletSim;
	},
): MutationOutcome {
	const seed = mutationSeed(input.scope, input.contextId);
	if (!seed) return { ok: false, status: 404, message: "No such wallet." };
	const st = stateFor(`${seed.scope}:${seed.id}`);
	st.payoutMode = input.mode;
	st.payoutInstant = input.instant;
	st.payoutThresholdMinor = input.thresholdMinor;
	return outcome(seed, input.display ?? null, input.sim, "Payout schedule updated.");
}

export function enrolSmoother(
	input: { targetMonthlyMinor: number; currency: string; display?: string | null; sim?: WalletSim },
): MutationOutcome {
	const seed = SEEDS[0];
	const st = stateFor(`${seed.scope}:${seed.id}`);
	st.incomeSmootherEnrolled = true;
	st.incomeSmootherTargetMinor = convertMinor(
		input.targetMonthlyMinor,
		input.currency,
		seed.currency,
	);
	return outcome(seed, input.display ?? null, input.sim, "Enrolled in the Income Smoother.");
}

export function decideSpend(
	input: {
		scope: string;
		contextId: string;
		approvalId: string;
		decision: "approve" | "reject";
		display?: string | null;
		sim?: WalletSim;
	},
): MutationOutcome {
	const seed = mutationSeed(input.scope, input.contextId);
	if (!seed) return { ok: false, status: 404, message: "No such wallet." };
	return outcome(
		seed,
		input.display ?? null,
		input.sim,
		input.decision === "approve" ? "Spend approved." : "Spend rejected.",
	);
}

export function requestSpend(
	input: {
		scope: string;
		contextId: string;
		amountMinor: number;
		currency: string;
		reason: string;
		display?: string | null;
		sim?: WalletSim;
	},
): MutationOutcome {
	const seed = mutationSeed(input.scope, input.contextId);
	if (!seed) return { ok: false, status: 404, message: "No such wallet." };
	return outcome(seed, input.display ?? null, input.sim, "Spend request submitted for approval.");
}
// #endregion
