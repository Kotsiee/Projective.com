/**
 * The team Payouts module's server half (Teams work order C4): the Preview ledger mapped from
 * `finance.preview_team_split(team, gross)`, the templates the plan unlocks and the members' vault
 * capabilities from the detail's payout block — pure mappers, and the preview read through an injected
 * I/O seam.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import type { LiveActor } from "./live-support.ts";
import type { PartyCard } from "../profile/party-cards.ts";
import {
	buildPayoutPolicy,
	type MoneyMember,
	previewTeamSplit,
	type RawSplitPreview,
	teamMoneyFacts,
	toSplitPreview,
	unlockedTemplatesOf,
	vaultCapabilitiesOf,
} from "./live-money.ts";

// #region Fixtures
const TEAM = "3f1c2a9e-0000-4000-8000-000000000001";
const ACTOR = { userId: "u-owner", accessToken: "token" } as unknown as LiveActor;
const PEOPLE = new Map([
	["u-ana", { username: "ana", name: "Ana Reyes", avatar: null }],
	["u-ben", { username: "ben", name: "Ben Okafor", avatar: null }],
]);

/** A deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/**
 * `finance.preview_team_split(team, gross)`'s answer, computed the way the SQL computes it: the fee
 * truncated at `fee_bp`, then `finance.fn_team_split_plan` — the finder's floor, the vault's floor of
 * the rest, each staked member's floor of the pool, the dust left over.
 */
function rawPreview(
	gross: number,
	feeBp: number,
	rule: {
		type: "co_op" | "finders_fee" | "benevolent_dictator";
		vaultBp: number;
		finderBp?: number;
	},
	stakes: readonly { user: string; bp: number }[],
): RawSplitPreview {
	const fee = Math.floor((gross * feeBp) / 10_000);
	const payout = Math.max(gross - fee, 0);
	const base = {
		escrow_id: null,
		gross_minor: gross,
		currency: null,
		fee_minor: fee,
		fee_bp: feeBp,
	};
	if (rule.type === "benevolent_dictator") {
		return {
			...base,
			finder_bp: null,
			plan: {
				payout_minor: payout,
				rule_type: rule.type,
				vault_bp: 10_000,
				finder_user_id: null,
				finder_minor: 0,
				vault_minor: payout,
				members: [],
				dust_minor: 0,
				vault_total_minor: payout,
			},
		};
	}
	let rest = payout;
	let finder = 0;
	if (rule.type === "finders_fee") {
		finder = Math.floor((payout * (rule.finderBp ?? 0)) / 10_000);
		rest = payout - finder;
	}
	const vault = Math.floor((rest * rule.vaultBp) / 10_000);
	const pool = rest - vault;
	let paid = 0;
	const members = stakes.filter((s) => s.bp > 0).map((s) => {
		const amount = Math.floor((pool * s.bp) / 10_000);
		paid += amount;
		return { member_user_id: s.user, percent_bp: s.bp, amount_minor: amount };
	});
	return {
		...base,
		finder_bp: rule.type === "finders_fee" ? rule.finderBp ?? null : null,
		plan: {
			payout_minor: payout,
			rule_type: rule.type,
			vault_bp: rule.vaultBp,
			finder_user_id: finder > 0 ? "u-ben" : null,
			finder_minor: finder,
			vault_minor: vault,
			members,
			dust_minor: pool - paid,
			vault_total_minor: vault + pool - paid,
		},
	};
}
// #endregion

// #region The preview ledger
Deno.test("toSplitPreview: the total equals the amount priced — 50 random amounts, every template", () => {
	const rand = prng(1018);
	const types = ["co_op", "finders_fee", "benevolent_dictator"] as const;
	for (let round = 0; round < 50; round++) {
		const gross = 1 + Math.floor(rand() * 100_000_000_000);
		const n = 1 + Math.floor(rand() * 9);
		const weights = Array.from({ length: n }, () => Math.floor(rand() * 1000));
		const sum = weights.reduce((a, b) => a + b, 0) || 1;
		const bps = weights.map((w) => Math.floor((w * 10_000) / sum));
		bps[0] += 10_000 - bps.reduce((a, b) => a + b, 0);
		const raw = rawPreview(
			gross,
			[500, 300, 0][round % 3],
			{
				type: types[round % 3],
				vaultBp: Math.floor(rand() * 4000),
				finderBp: 1 + Math.floor(rand() * 3000),
			},
			bps.map((bp, i) => ({ user: `u-${i}`, bp })),
		);
		const preview = toSplitPreview(raw, PEOPLE, "GBP");
		assertStrictEquals(preview.gross.minor, gross, `round ${round}`);
		assertStrictEquals(preview.total.minor, gross, `round ${round}: total ${preview.total.minor}`);
		assertStrictEquals(
			preview.lines.reduce((acc, line) => acc + line.amount.minor, 0),
			gross,
			`round ${round}: the lines sum to the amount`,
		);
		assert(preview.lines.every((line) => line.amount.minor >= 0 && line.amount.currency === "GBP"));
	}
});

Deno.test("toSplitPreview: the plan's order, the finder and members named, rates carried", () => {
	const preview = toSplitPreview(
		rawPreview(100_000, 500, { type: "finders_fee", vaultBp: 1000, finderBp: 1000 }, [
			{ user: "u-ana", bp: 6000 },
			{ user: "u-ben", bp: 4000 },
		]),
		PEOPLE,
		"gbp",
	);
	assertEquals(preview.currency, "GBP");
	assertEquals(preview.ruleType, "finders_fee");
	assertEquals(
		preview.lines.map((l) => [l.kind, l.name, l.bp, l.amount.minor]),
		[
			["fee", null, 500, 5000],
			["finder", "Ben Okafor", 1000, 9500],
			["vault", null, 1000, 8550],
			["member", "Ana Reyes", 6000, 46170],
			["member", "Ben Okafor", 4000, 30780],
			["dust", null, null, 0],
		],
	);
	assertEquals(preview.total.minor, 100_000);
});

Deno.test("toSplitPreview: benevolent_dictator is the fee and the vault — no members, no dust", () => {
	const preview = toSplitPreview(
		rawPreview(123_457, 500, { type: "benevolent_dictator", vaultBp: 10_000 }, []),
		PEOPLE,
		"USD",
	);
	assertEquals(preview.lines.map((l) => l.kind), ["fee", "vault"]);
	assertEquals(preview.total.minor, 123_457);
});

Deno.test("toSplitPreview: a finder's fee too small to pay still shows its line, unnamed", () => {
	const preview = toSplitPreview(
		rawPreview(7, 500, { type: "finders_fee", vaultBp: 0, finderBp: 1 }, [{
			user: "u-ana",
			bp: 10_000,
		}]),
		PEOPLE,
		"GBP",
	);
	const finder = preview.lines.find((l) => l.kind === "finder");
	assertEquals([finder?.name, finder?.amount.minor], [null, 0]);
	assertEquals(preview.total.minor, 7);
});
// #endregion

// #region The payout block
Deno.test("unlockedTemplatesOf: template order, unknown dropped, absent is co_op only", () => {
	assertEquals(unlockedTemplatesOf(["benevolent_dictator", "co_op", "by_role"]), [
		"co_op",
		"benevolent_dictator",
	]);
	assertEquals(unlockedTemplatesOf(null), ["co_op"]);
	assertEquals(unlockedTemplatesOf(undefined), ["co_op"]);
	assertEquals(unlockedTemplatesOf([]), []);
});

Deno.test("vaultCapabilitiesOf: the enum's order, unknown dropped", () => {
	assertEquals(vaultCapabilitiesOf(["withdraw", "view", "teleport", "distribute"]), [
		"view",
		"distribute",
		"withdraw",
	]);
	assertEquals(vaultCapabilitiesOf(null), []);
});

const MEMBERS: MoneyMember[] = [
	{
		memberId: "m-ana",
		userId: "u-ana",
		isOwner: true,
		person: { username: "ana", name: "Ana Reyes", avatar: null },
		capabilities: ["manage_finances", "withdraw_funds"],
	},
	{
		memberId: "m-ben",
		userId: "u-ben",
		isOwner: false,
		person: { username: "ben", name: "Ben Okafor", avatar: null },
		capabilities: [],
	},
];

Deno.test("buildPayoutPolicy: stakes carry the user id; the plan's templates and the vault readout travel", () => {
	const facts = teamMoneyFacts(
		{
			rule: { rule_type: "co_op", vault_bp: 1000, finder_user_id: null, finder_bp: null },
			wallet: null,
			preview: null,
			unlocked_templates: ["co_op", "finders_fee"],
			vault_capabilities: [
				{ user_id: "u-ana", capabilities: ["view", "distribute", "withdraw", "manage_members"] },
				{ user_id: "u-ben", capabilities: ["view"] },
			],
		},
		[
			{ user_id: "u-ana", share_bp: 7000, share_held: false },
			{ user_id: "u-ben", share_bp: 3000, share_held: true },
		],
	);
	const policy = buildPayoutPolicy(MEMBERS, facts);
	assertEquals(policy.stakes.map((s) => [s.memberId, s.userId, s.shareBp, s.held]), [
		["m-ana", "u-ana", 7000, false],
		["m-ben", "u-ben", 3000, true],
	]);
	assertEquals(policy.unlockedTemplates, ["co_op", "finders_fee"]);
	assertEquals(policy.vaultAccess, [
		{
			memberId: "m-ana",
			name: "Ana Reyes",
			capabilities: ["view", "distribute", "withdraw", "manage_members"],
		},
		{ memberId: "m-ben", name: "Ben Okafor", capabilities: ["view"] },
	]);
});

Deno.test("buildPayoutPolicy: a read without the new keys is co_op only, with no vault readout", () => {
	const facts = teamMoneyFacts(
		{ rule: null, wallet: null, preview: null },
		[{ user_id: "u-ana", share_bp: 10_000, share_held: false }],
	);
	const policy = buildPayoutPolicy(MEMBERS.slice(0, 1), facts);
	assertEquals(policy.unlockedTemplates, ["co_op"]);
	assertEquals(policy.vaultAccess, []);
});
// #endregion

// #region The preview read
function cards(): Map<string, PartyCard> {
	return new Map([...PEOPLE].map(([id, p]) => [id, {
		userId: id,
		username: p.username,
		name: p.name,
		isFreelancer: true,
		avatar: null,
		avatarLarge: null,
	}]));
}

Deno.test("previewTeamSplit: prices the amount the reader chose and names its people in one batch", async () => {
	const calls: { name: string; args: Record<string, unknown> }[] = [];
	const asked: string[][] = [];
	const res = await previewTeamSplit(
		{ workspaceId: TEAM, amountMinor: 100_000, currency: "GBP" },
		ACTOR,
		{
			rpc: <T>(_a: LiveActor, _s: string, name: string, args: Record<string, unknown> = {}) => {
				calls.push({ name, args });
				return Promise.resolve({
					ok: true as const,
					data: rawPreview(100_000, 500, { type: "co_op", vaultBp: 1000 }, [
						{ user: "u-ana", bp: 5000 },
						{ user: "u-ben", bp: 5000 },
					]) as T,
				});
			},
			partyCards: (_a, ids) => {
				asked.push([...ids]);
				return Promise.resolve(cards());
			},
		},
	);
	assert(res.ok);
	assertEquals(calls, [{
		name: "preview_team_split",
		args: { p_team_id: TEAM, p_gross_minor: 100_000 },
	}]);
	assertEquals(asked, [["u-ana", "u-ben"]]);
	assertEquals(res.data?.total.minor, 100_000);
	assertEquals(res.data?.lines.filter((l) => l.kind === "member").map((l) => l.name), [
		"Ana Reyes",
		"Ben Okafor",
	]);
});

Deno.test("previewTeamSplit: a malformed team id is refused before the database", async () => {
	let called = false;
	const res = await previewTeamSplit(
		{ workspaceId: "not-a-uuid", amountMinor: 100, currency: "GBP" },
		ACTOR,
		{
			rpc: () => {
				called = true;
				return Promise.resolve({ ok: true as const, data: null as never });
			},
			partyCards: () => Promise.resolve(new Map()),
		},
	);
	assertEquals([res.ok, res.status, called], [false, 404, false]);
});
// #endregion
