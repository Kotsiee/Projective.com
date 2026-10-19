/**
 * split-model — the demo stage's Team pay (`?demo=splits`) as a pure simulation over a typed fixture
 * (`flows/LANDING.md` §4.4 "Team pay", §5 rows C1, C4, E1, E2, N1–N5, N8, §6 V5). It never fetches
 * and never writes: every figure is integer minor units.
 *
 * {@link teamSplitPlan} is `finance.fn_team_split_plan`
 * (`supabase/migrations/00001200_functions_finance_core.sql:97-169`) line for line — the one plan
 * both the release (`fn_split_team_payout`, `:176-217`) and the console's preview read:
 *
 *   - no payout (null or ≤ 0) → an empty plan with no rule (`:124-127`);
 *   - `benevolent_dictator` → everything to the vault (`:133-137`);
 *   - `finders_fee` with a finder → the finder's `(payout × finder_bp) / 10000` first (`:138-141`);
 *   - then the vault's `(rest × vault_bp) / 10000` (`:142`), and the pool is what is left (`:143`);
 *   - each ACTIVE member with a stake above 0, in stake order (largest first, then member id),
 *     takes `(pool × percent_bp) / 10000` (`:145-155`);
 *   - whatever the floors leave — and any stake nobody active holds — is dust, and the vault keeps
 *     it: `vault_total = vault + (pool − paid)` (`:157-167`). So the plan always adds up to the
 *     payout, to the penny (N4).
 *
 * The payout the team splits is the stage's release, `amount − fee` (`:742-745`, through
 * `releaseSplit`); the even split is the product's `evenSplit` (`packages/backend/services/
 * workspace/mappers.ts:1014-1030`: `floor(10000 / n)` each, the spare basis points on the owner).
 * The vault rate is a fixed fixture fact (10%, as the seeded teams keep, N2), never a control: the
 * product shows it read-only and saves stakes only (`PayoutPolicyScreen.island.tsx`).
 */
import type { SplitRuleType } from "@projective/types/finance";
import { CLEARS_IN_DAYS, feeRate, money, price, releaseSplit } from "./payments-model.ts";

// #region The plan — fn_team_split_plan, mirrored
/** The team's active split rule (`finance.split_rules`); `null` when the team has none. */
export interface SplitRule {
	ruleType: SplitRuleType;
	vaultBp: number | null;
	finderUserId: string | null;
	finderBp: number | null;
}

/** One member's agreed stake (`finance.contribution_agreements` joined to `org.team_members`). */
export interface SplitStakeInput {
	memberId: string;
	percentBp: number;
	/** `org.team_members.status = 'active'`: only an active member is paid. */
	active: boolean;
}

/** One member's line of the plan. */
export interface SplitPlanMember {
	memberId: string;
	percentBp: number;
	amountMinor: number;
}

/** `fn_team_split_plan`'s answer, field for field. */
export interface TeamSplitPlan {
	payoutMinor: number;
	ruleType: SplitRuleType | null;
	vaultBp: number;
	finderUserId: string | null;
	finderMinor: number;
	/** The vault's cut, before the dust. */
	vaultMinor: number;
	/** In the plan's order: stake descending, then member id. */
	members: SplitPlanMember[];
	/** What the floors left over (and any unpaid stake), which the vault keeps. */
	dustMinor: number;
	/** The vault's cut plus the dust. */
	vaultTotalMinor: number;
}

/** Integer division as SQL's `bigint / bigint` does it, for the non-negative amounts the plan sees. */
function div(numerator: number, denominator: number): number {
	return Math.trunc(numerator / denominator);
}

/**
 * The team's payout plan for `payoutMinor` — `finance.fn_team_split_plan`, mirrored. Member ids are
 * ordered as the database orders `member_user_id` (a uuid, which sorts as its lowercase hex text).
 */
export function teamSplitPlan(
	payoutMinor: number | null,
	rule: SplitRule | null,
	stakes: readonly SplitStakeInput[],
): TeamSplitPlan {
	if (payoutMinor === null || payoutMinor <= 0) {
		return {
			payoutMinor: 0,
			ruleType: null,
			vaultBp: 0,
			finderUserId: null,
			finderMinor: 0,
			vaultMinor: 0,
			members: [],
			dustMinor: 0,
			vaultTotalMinor: 0,
		};
	}
	if (rule?.ruleType === "benevolent_dictator") {
		return {
			payoutMinor,
			ruleType: rule.ruleType,
			vaultBp: 10_000,
			finderUserId: null,
			finderMinor: 0,
			vaultMinor: payoutMinor,
			members: [],
			dustMinor: 0,
			vaultTotalMinor: payoutMinor,
		};
	}

	let rest = payoutMinor;
	let finderMinor = 0;
	if (rule?.ruleType === "finders_fee" && rule.finderUserId !== null) {
		finderMinor = div(payoutMinor * (rule.finderBp ?? 0), 10_000);
		rest = payoutMinor - finderMinor;
	}
	const vaultMinor = div(rest * (rule?.vaultBp ?? 0), 10_000);
	const pool = rest - vaultMinor;

	const members = stakes
		.filter((stake) => stake.active && stake.percentBp > 0)
		.sort((a, b) =>
			b.percentBp - a.percentBp || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0)
		)
		.map((stake) => ({
			memberId: stake.memberId,
			percentBp: stake.percentBp,
			amountMinor: div(pool * stake.percentBp, 10_000),
		}));
	const paid = members.reduce((sum, member) => sum + member.amountMinor, 0);

	return {
		payoutMinor,
		ruleType: rule?.ruleType ?? "co_op",
		vaultBp: rule?.vaultBp ?? 0,
		finderUserId: finderMinor > 0 ? rule?.finderUserId ?? null : null,
		finderMinor,
		vaultMinor,
		members,
		dustMinor: pool - paid,
		vaultTotalMinor: vaultMinor + (pool - paid),
	};
}

/**
 * An even split over `memberIds` — the product's `evenSplit`: `floor(10000 / n)` basis points each,
 * the spare ones on the owner (or the first member when the owner is not among them).
 */
export function evenStakes(
	memberIds: readonly string[],
	ownerId: string | null,
): Array<{ memberId: string; bp: number }> {
	if (memberIds.length === 0) return [];
	const base = Math.floor(10_000 / memberIds.length);
	const spare = 10_000 - base * memberIds.length;
	const target = ownerId !== null && memberIds.includes(ownerId) ? ownerId : memberIds[0];
	return memberIds.map((memberId) => ({ memberId, bp: memberId === target ? base + spare : base }));
}

/** Whether stakes form a whole split: the database accepts a total of exactly 0 or 10 000 bp (`00001200:270-287`). */
export function stakesAddUp(stakes: readonly { bp: number }[]): boolean {
	const total = stakes.reduce((sum, stake) => sum + stake.bp, 0);
	return total === 10_000;
}

/**
 * How a split reads — the product's `deriveSplitModel`: even when every stake is within one basis
 * point of every other (3334 / 3333 / 3333 is even), custom otherwise.
 */
export function splitModelOf(stakes: readonly { bp: number }[]): "even" | "custom" {
	if (stakes.length === 0) return "custom";
	const bps = stakes.map((stake) => stake.bp);
	return Math.max(...bps) - Math.min(...bps) <= 1 ? "even" : "custom";
}
// #endregion

// #region Fixture
/** One member of the example team. */
export interface TeamPayMember {
	id: string;
	/** Their role, the row's name (§4.4: Owner, Designer, Developer). */
	role: string;
}

/** The example: a stage payment reaching a three-person team. */
export interface TeamPayFixture {
	currency: string;
	/** The approved stage's price (minor units). */
	stageMinor: number;
	rule: SplitRule;
	members: readonly TeamPayMember[];
	ownerId: string;
	/** The "Custom split" example (§4.4 frame 5: 50%, 30% and 20%). */
	customBp: Readonly<Record<string, number>>;
}

/** The §4.4 fixture: a £2,000 stage; Owner, Designer, Developer; a 10% vault (a fixed fact, N2). */
export const TEAM_PAY_FIXTURE: TeamPayFixture = {
	currency: "GBP",
	stageMinor: 200_000,
	rule: { ruleType: "co_op", vaultBp: 1_000, finderUserId: null, finderBp: null },
	members: [
		{ id: "owner", role: "Owner" },
		{ id: "designer", role: "Designer" },
		{ id: "developer", role: "Developer" },
	],
	ownerId: "owner",
	customBp: { owner: 5_000, designer: 3_000, developer: 2_000 },
};

/** A split as the demo holds it: each member's basis points, in the fixture's order. */
export type DemoStakes = ReadonlyArray<{ memberId: string; bp: number }>;

/** The fixture's even split (3334 / 3333 / 3333: the owner takes the spare point). */
export function evenSplitOf(fixture: TeamPayFixture = TEAM_PAY_FIXTURE): DemoStakes {
	return evenStakes(fixture.members.map((member) => member.id), fixture.ownerId);
}

/** The fixture's custom example (50 / 30 / 20). */
export function customSplitOf(fixture: TeamPayFixture = TEAM_PAY_FIXTURE): DemoStakes {
	return fixture.members.map((member) => ({
		memberId: member.id,
		bp: fixture.customBp[member.id] ?? 0,
	}));
}
// #endregion

// #region The picture
/** One row: "{role} · {pct} · {amount} · clears in 7 days". */
export interface TeamPayRow {
	key: string;
	role: string;
	/** The share as the row writes it (`33.34%`, `50%`). */
	pct: string;
	bp: number;
	/** `null` while the fee, and so every amount, is unknown (§4). */
	amountMinor: number | null;
}

/** The whole picture at one split. */
export interface TeamPayView {
	stageMinor: number;
	feeMinor: number | null;
	/** What the team receives, before its split; `null` while the fee is unknown. */
	payoutMinor: number | null;
	plan: TeamSplitPlan | null;
	/** One row per member, in the fixture's order. */
	members: TeamPayRow[];
	/** The vault's row: its rate, and its cut plus the dust. */
	vault: TeamPayRow;
	/** The vault's cut before the dust. */
	vaultCutMinor: number | null;
	dustMinor: number | null;
	model: "even" | "custom";
	/** The stakes add up to 100% (they always do here: the bar keeps them whole). */
	whole: boolean;
}

/** A share as the rows and frames write it: `33.34%`, `50%`, `42.5%`. */
export function sharePercent(bp: number): string {
	return `${Number((bp / 100).toFixed(2))}%`;
}

/** The picture at `stakes`. */
export function teamPayView(
	stakes: DemoStakes,
	feeBp: number | null,
	fixture: TeamPayFixture = TEAM_PAY_FIXTURE,
): TeamPayView {
	const release = feeBp === null ? null : releaseSplit(fixture.stageMinor, feeBp);
	const plan = release === null ? null : teamSplitPlan(
		release.payoutMinor,
		fixture.rule,
		stakes.map((stake) => ({ memberId: stake.memberId, percentBp: stake.bp, active: true })),
	);
	const bpOf = (id: string) => stakes.find((stake) => stake.memberId === id)?.bp ?? 0;
	const vaultBp = fixture.rule.vaultBp ?? 0;
	return {
		stageMinor: fixture.stageMinor,
		feeMinor: release?.feeMinor ?? null,
		payoutMinor: release?.payoutMinor ?? null,
		plan,
		members: fixture.members.map((member) => ({
			key: member.id,
			role: member.role,
			pct: sharePercent(bpOf(member.id)),
			bp: bpOf(member.id),
			amountMinor: plan === null
				? null
				: plan.members.find((line) => line.memberId === member.id)?.amountMinor ?? 0,
		})),
		vault: {
			key: "vault",
			role: TEAM_PAY_COPY.vault,
			pct: sharePercent(vaultBp),
			bp: vaultBp,
			amountMinor: plan?.vaultTotalMinor ?? null,
		},
		vaultCutMinor: plan?.vaultMinor ?? null,
		dustMinor: plan?.dustMinor ?? null,
		model: splitModelOf(stakes),
		whole: stakesAddUp(stakes),
	};
}
// #endregion

// #region Copy
/** The demo's fixed words (§4.4 "Team pay", verbatim; the labels name the demo's own parts). */
export const TEAM_PAY_COPY = {
	even: "Example even split",
	custom: "Custom split",
	/** The fixed line, never a control (N2). */
	vaultLine: "This team keeps 10% in its vault.",
	validation: "Shares must add up to 100%.",
	/** Static text, never a control (N8). */
	comingSoon:
		"Coming soon with Pro Team: a finder's fee, or paying everything into the team vault.",
	vault: "Team vault",
	dust: "Any spare penny goes to the vault. It all adds up.",
	clears: `clears in ${CLEARS_IN_DAYS} days`,
	dragHint: "Drag a divider to change the shares.",
	stakes: "Member stakes",
	splitGroup: "How the team's pay splits",
	/** The release's figures, in the pricing calculator's own labels (§4.9). */
	stagePrice: "Stage price",
	teamReceives: "The team receives",
} as const;

/** The fee's label, as the pricing calculator writes it (§4.9): "Projective fee (5%)". */
export function feeLabel(feeBp: number): string {
	return `Projective fee (${feeRate(feeBp)})`;
}

/** "three" for 3: the frames say how many ways the pool splits. */
function waysWord(count: number): string {
	return ["no", "one", "two", "three", "four", "five", "six"][count] ?? String(count);
}

/** "a, b and c". */
function listOf(items: readonly string[]): string {
	if (items.length <= 1) return items.join("");
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A row as one line of text: "{role} · {pct} · {amount} · clears in 7 days" (the amount dropped while unknown). */
export function rowText(row: TeamPayRow, currency = TEAM_PAY_FIXTURE.currency): string {
	return [
		row.role,
		row.pct,
		...(row.amountMinor === null ? [] : [money(row.amountMinor, currency)]),
		TEAM_PAY_COPY.clears,
	].join(" · ");
}

/** The approved line (frame 1): "A £2,000 stage is approved. The {platformFee} fee leaves {net}." — without the fee, its first sentence. */
export function approvedStageLine(
	feeBp: number | null,
	fixture: TeamPayFixture = TEAM_PAY_FIXTURE,
): string {
	const head = `A ${price(fixture.stageMinor, fixture.currency)} stage is approved.`;
	if (feeBp === null) return head;
	const { payoutMinor } = releaseSplit(fixture.stageMinor, feeBp);
	return `${head} The ${feeRate(feeBp)} fee leaves ${money(payoutMinor, fixture.currency)}.`;
}

/** Which part of the picture a frame shows: the release, then the vault's cut, the shares, the dust, custom shares, clearing. */
export type TeamPayPhase = "approved" | "vault" | "shares" | "dust" | "custom" | "clears";

/** One frame (§4.4 "Team pay" 1–6). */
export interface TeamPayFrame {
	lines: string[];
	phase: TeamPayPhase;
	stakes: DemoStakes;
}

/** The frame-mode sequence, verbatim, with the fee's figures resolved or dropped (§4). */
export function teamPayFrames(
	feeBp: number | null,
	fixture: TeamPayFixture = TEAM_PAY_FIXTURE,
): TeamPayFrame[] {
	const even = evenSplitOf(fixture);
	const custom = customSplitOf(fixture);
	const evenView = teamPayView(even, feeBp, fixture);
	const known = evenView.plan !== null;
	const shares = (view: TeamPayView) =>
		listOf(view.members.map((row) => money(row.amountMinor ?? 0, fixture.currency)));
	const pcts = (stakes: DemoStakes) => listOf(stakes.map((stake) => sharePercent(stake.bp)));
	const ways = waysWord(fixture.members.length);
	const vaultPct = sharePercent(fixture.rule.vaultBp ?? 0);
	return [
		{ lines: [approvedStageLine(feeBp, fixture)], phase: "approved", stakes: even },
		{
			lines: [
				known
					? `The team keeps ${vaultPct} in its shared vault: ${
						money(evenView.vaultCutMinor ?? 0, fixture.currency)
					}.`
					: `The team keeps ${vaultPct} in its shared vault.`,
			],
			phase: "vault",
			stakes: even,
		},
		{
			lines: [
				known
					? `The rest splits ${ways} ways: ${shares(evenView)}.`
					: `The rest splits ${ways} ways: ${pcts(even)}.`,
			],
			phase: "shares",
			stakes: even,
		},
		{ lines: [TEAM_PAY_COPY.dust], phase: "dust", stakes: even },
		{
			lines: [
				known
					? `Try custom shares: ${pcts(custom)}. Watch the amounts change.`
					: `Try custom shares: ${pcts(custom)}.`,
			],
			phase: "custom",
			stakes: custom,
		},
		{
			lines: [`Each share clears in ${CLEARS_IN_DAYS} days. Then members can withdraw it.`],
			phase: "clears",
			stakes: custom,
		},
	];
}

/** What the live region says after the split changes: every row, in order. */
export function splitAnnouncement(
	view: TeamPayView,
	fixture: TeamPayFixture = TEAM_PAY_FIXTURE,
): string {
	return [...view.members, view.vault].map((row) => `${rowText(row, fixture.currency)}.`).join(" ");
}
// #endregion
