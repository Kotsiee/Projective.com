/**
 * The Overview's rules (`overview-model.ts`, Teams work order C1): exactly one filled control in every
 * setup state, no control a viewer cannot use, no money a viewer was not answered, the zones that
 * stand in for a dismissed hero, and the previews built from the B7 payload.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
	presetCapabilities,
	type SetupStep,
	type SetupStepId,
	type WorkspaceCapability,
	type WorkspaceDetail,
	WorkspaceDetailSchema,
} from "@projective/types/workspace";
import {
	activityRows,
	filledControls,
	heroDismissKey,
	liveProjectCount,
	overviewMetrics,
	overviewModel,
	projectPreview,
	readHeroDismissed,
	setupHero,
	writeHeroDismissed,
} from "./overview-model.ts";

// #region Fixtures
const TEAM_STEPS: SetupStepId[] = ["invite", "money", "profile", "verification", "publish"];
const BUSINESS_STEPS: SetupStepId[] = ["logo", "bio", "invite", "money", "verification"];

/** The team step's module, as `setupSteps` addresses it. */
const HREF: Record<SetupStepId, string> = {
	invite: "/teams/northloop/invitations",
	money: "/teams/northloop/payouts",
	profile: "/@northloop/edit",
	logo: "/@northloop/edit",
	bio: "/@northloop/edit",
	verification: "/teams/northloop/verification",
	publish: "/teams/northloop/settings",
};

/** Steps in `ids` order, `done` per the mask bit, `actionable` per `can`. */
function stepsOf(
	ids: readonly SetupStepId[],
	doneMask: number,
	can: (id: SetupStepId) => boolean = () => true,
): SetupStep[] {
	return ids.map((id, i) => ({
		id,
		label: `Step ${id}`,
		note: `Why ${id}`,
		done: (doneMask & (1 << i)) !== 0,
		href: HREF[id],
		actionable: can(id),
	}));
}

const money = (minor: number, currency = "USD") => ({
	minor,
	currency,
	display: `${currency} ${minor}`,
	origin: null,
});

const member = (id: string) => ({
	id,
	handle: id,
	name: id,
	avatar: "",
	email: null,
	roleId: "r",
	rolePreset: "member" as const,
	state: "active" as const,
	overrides: { granted: [], revoked: [] },
	joinedAt: "2026-09-01T00:00:00Z",
	title: null,
	workload: 0,
	availability: "available" as const,
});

/** A draft one-person team for `caps`, parsed through the SSOT so every default is real. */
function teamDetail(
	caps: readonly WorkspaceCapability[],
	over: Record<string, unknown> = {},
): WorkspaceDetail {
	return WorkspaceDetailSchema.parse({
		id: "team-1",
		kind: "team",
		name: "Northloop",
		handle: "northloop",
		avatar: "",
		banner: "",
		tagline: "",
		status: "draft",
		verification: "unverified",
		verificationPrompt: "Verify the owner's identity.",
		createdAt: "2026-09-01T00:00:00Z",
		viewerRoleId: "r",
		viewerMemberId: "m-1",
		viewerCapabilities: [...caps],
		isActing: false,
		members: [member("m-1")],
		roles: [],
		invites: [],
		payout: null,
		spend: null,
		finance: {
			available: money(0),
			locked: money(0),
			pending: money(0),
			walletHref: "/wallet?w=team:team-1",
		},
		projects: [],
		activity: [],
		setup: stepsOf(TEAM_STEPS, 0, () => true),
		canPropose: false,
		...over,
	});
}

const OWNER = presetCapabilities("owner", "team");
const PLAIN: WorkspaceCapability[] = ["view_analytics"];

/** Every step's control as `id:tier` (filled marked `*`), or `id:-` for none. */
const controls = (steps: { id: string; action: { tier: number; filled: boolean } | null }[]) =>
	steps.map((s) =>
		s.action ? `${s.id}:${s.action.tier}${s.action.filled ? "*" : ""}` : `${s.id}:-`
	);
// #endregion

// #region The one filled control
Deno.test("hero: exactly one filled control in every setup state the owner can act on", () => {
	for (const [kind, ids] of [["team", TEAM_STEPS], ["business", BUSINESS_STEPS]] as const) {
		for (let mask = 0; mask < 1 << ids.length; mask++) {
			const steps = stepsOf(ids, mask);
			const hero = setupHero({ name: "Northloop", steps, dismissed: false });
			const allDone = mask === (1 << ids.length) - 1;
			if (allDone) {
				assertStrictEquals(hero, null, `${kind} ${mask}: a finished setup draws no hero`);
				continue;
			}
			assert(hero, `${kind} ${mask}: an open step draws the hero`);
			const filled = hero.steps.filter((s) => s.action?.filled);
			assertEquals(filled.length, 1, `${kind} mask ${mask}: ${controls(hero.steps)}`);
			// The fill sits on the first open step, and takes its tier.
			const first = steps.find((s) => !s.done)!;
			assertEquals(filled[0].id, first.id);
			assertEquals(filled[0].action!.tier, first.id === "invite" ? 2 : 3);
			assertEquals(hero.steps.find((s) => s.current)?.id, first.id);
		}
	}
});

Deno.test("hero: the overview carries exactly the hero's fill — every zone, every state", () => {
	for (let mask = 0; mask < 1 << TEAM_STEPS.length; mask++) {
		const detail = teamDetail(OWNER, { setup: stepsOf(TEAM_STEPS, mask) });
		const model = overviewModel(detail, { dismissed: false });
		assertEquals(filledControls(model), mask === 31 ? 0 : 1, `mask ${mask}`);
	}
});

Deno.test("hero: invite is tier 2, publish tier 3, the rest tier-4 links; publish only as the step at hand", () => {
	const fresh = setupHero({ name: "Northloop", steps: stepsOf(TEAM_STEPS, 0), dismissed: false })!;
	assertEquals(controls(fresh.steps), [
		"invite:2*",
		"money:4",
		"profile:4",
		"verification:4",
		"publish:-",
	]);
	assertEquals(fresh.steps[0].action!.kind, "invite");
	assertEquals(fresh.steps[0].action!.label, "Invite member");
	assertEquals(fresh.steps[1].action!.href, "/teams/northloop/payouts");
	// Everything but publishing done → Publish is the fill.
	const last = setupHero({
		name: "Northloop",
		steps: stepsOf(TEAM_STEPS, 0b01111),
		dismissed: false,
	})!;
	assertEquals(controls(last.steps), [
		"invite:-",
		"money:-",
		"profile:-",
		"verification:-",
		"publish:3*",
	]);
	assertEquals(last.steps[4].action!.kind, "publish");
	assertEquals([last.title, last.progress, last.percent], [
		"Get Northloop ready",
		"4 of 5 done",
		80,
	]);
	// A split step at hand is a filled link to its page.
	const split = setupHero({ name: "N", steps: stepsOf(TEAM_STEPS, 0b00001), dismissed: false })!;
	assertEquals(split.steps[1].action, {
		kind: "link",
		tier: 3,
		filled: true,
		label: "Step money",
		href: "/teams/northloop/payouts",
	});
});

Deno.test("hero: a done step reads Done; an open one its note", () => {
	const hero = setupHero({ name: "N", steps: stepsOf(TEAM_STEPS, 0b00011), dismissed: false })!;
	assertEquals(hero.steps.map((s) => s.note), [
		"Done",
		"Done",
		"Why profile",
		"Why verification",
		"Why publish",
	]);
});
// #endregion

// #region No dead controls
Deno.test("plain member: the hero shows where the team is, and offers nothing", () => {
	const detail = teamDetail(PLAIN, { setup: stepsOf(TEAM_STEPS, 0, () => false) });
	const model = overviewModel(detail, { dismissed: false });
	assert(model.hero);
	assertEquals(model.hero.steps.every((s) => s.action === null), true);
	assertEquals(filledControls(model), 0);
	assertEquals(model.hero.steps.find((s) => s.current)?.id, "invite");
});

Deno.test("plain member: no money tile and no money — the read answered none", () => {
	const detail = teamDetail(PLAIN, {
		allowance: null,
		members: [member("m-1"), member("m-2")],
		canPropose: true,
	});
	const metrics = overviewMetrics(detail);
	assertEquals(metrics.map((m) => m.key), ["members", "live"]);
	assertEquals(metrics.some((m) => m.type === "money"), false);
});

Deno.test("partial rights: the fill goes to the first step the viewer can act on", () => {
	const onlyProfile = setupHero({
		name: "N",
		steps: stepsOf(TEAM_STEPS, 0, (id) => id === "profile"),
		dismissed: false,
	})!;
	assertEquals(controls(onlyProfile.steps), [
		"invite:-",
		"money:-",
		"profile:3*",
		"verification:-",
		"publish:-",
	]);
	// The team is still AT the invite step — the current marker does not follow the viewer's rights.
	assertEquals(onlyProfile.steps.find((s) => s.current)?.id, "invite");
	// An admin without the money right: invite filled, split silent, publish not yet.
	const admin = setupHero({
		name: "N",
		steps: stepsOf(TEAM_STEPS, 0, (id) => id !== "money"),
		dismissed: false,
	})!;
	assertEquals(controls(admin.steps), [
		"invite:2*",
		"money:-",
		"profile:4",
		"verification:4",
		"publish:-",
	]);
});

Deno.test("hero: a link step with no page offers no control", () => {
	const steps = stepsOf(TEAM_STEPS, 0b00001).map((s) => s.id === "money" ? { ...s, href: "" } : s);
	const hero = setupHero({ name: "N", steps, dismissed: false })!;
	assertEquals(controls(hero.steps), [
		"invite:-",
		"money:-",
		"profile:3*",
		"verification:4",
		"publish:-",
	]);
});
// #endregion

// #region Zones
Deno.test("zones: the hero carries the two-member rule and the lock; dismissed, the notices return", () => {
	const detail = teamDetail(OWNER);
	const shown = overviewModel(detail, { dismissed: false });
	assert(shown.hero);
	assertStrictEquals(shown.propose, null);
	assertEquals(shown.lock, false);
	const hidden = overviewModel(detail, { dismissed: true });
	assertStrictEquals(hidden.hero, null);
	assertEquals(hidden.propose, { canInvite: true });
	assertEquals(hidden.lock, true);
	assertEquals(filledControls(hidden), 0);
	// A plain member is told the rule but offered no invite.
	assertEquals(overviewModel(teamDetail(PLAIN), { dismissed: true }).propose, { canInvite: false });
});

Deno.test("zones: an active, verified, two-member team draws no hero and no notices", () => {
	const detail = teamDetail(OWNER, {
		status: "active",
		verification: "verified",
		verificationPrompt: null,
		canPropose: true,
		members: [member("m-1"), member("m-2")],
		setup: stepsOf(TEAM_STEPS, 31),
	});
	const model = overviewModel(detail, { dismissed: false });
	assertStrictEquals(model.hero, null);
	assertStrictEquals(model.propose, null);
	assertEquals(model.lock, false);
	assertEquals(model.projectsHref, "/teams/northloop/projects");
});

Deno.test("zones: the two-member rule is a team's — a business is never told it", () => {
	const detail = teamDetail(OWNER, {
		kind: "business",
		canPropose: true,
		setup: stepsOf(BUSINESS_STEPS, 31),
	});
	assertStrictEquals(overviewModel(detail, { dismissed: true }).propose, null);
});
// #endregion

// #region Metrics
Deno.test("metrics: the vault from the payout block, the allowance from B7", () => {
	const detail = teamDetail(OWNER, {
		payout: {
			walletId: "w-1",
			currency: "GBP",
			availableMinor: 12_345,
			pendingMinor: 0,
			model: "equal",
			stakes: [],
			templates: [],
			projectedRelease: null,
			platformFee: null,
			vaultBp: 0,
			rule: { ruleType: "co_op", vaultBp: 0, finderUserId: null, finderBp: null },
			vaultCut: null,
			withdrawApprovers: [],
		},
		allowance: {
			subjectType: "team",
			subjectId: "00000000-0000-4000-8000-000000000001",
			weeklyGranted: 10,
			weeklyConsumed: 3,
			weeklyRemaining: 7,
			weeklyResetsAt: "2026-10-19T00:00:00Z",
			bufferUnits: 3,
			bufferCap: 6,
			bufferDrip: 3,
			bufferWindowHours: 24,
			nextBufferRefillAt: null,
			canApply: false,
			enforced: true,
			planCode: "team_free",
			planLabel: "Team",
			planTier: "free",
			upgrade: null,
			standingLevel: 1,
			standingBonus: 0,
			teamStatus: "draft",
			teamMemberCount: 1,
			canBindSeat: true,
			serverNow: "2026-10-17T00:00:00Z",
		},
		invites: [{
			id: "i-1",
			handle: "sam",
			name: "Sam",
			avatar: "",
			email: null,
			roleId: "r",
			note: null,
			sentAt: "Today",
			expiresAt: null,
		}],
	});
	const metrics = overviewMetrics(detail);
	assertEquals(metrics.map((m) => [m.key, m.label]), [
		["members", "Members"],
		["live", "Live projects"],
		["vault", "Vault available"],
		["allowance", "Proposals left"],
	]);
	const vault = metrics[2];
	assert(vault.type === "money");
	assertEquals(vault.money, { minor: 12_345, currency: "GBP" });
	const allowance = metrics[3];
	assert(allowance.type === "count");
	assertEquals([allowance.value, allowance.caption], [7, "of 10 this week"]);
	assertEquals(metrics[0].caption, "1 invitation out");
});

Deno.test("metrics: a business's pool, one tile per currency, only when answered", () => {
	const tile = (currency: string, minor: number) => ({
		currency,
		available: money(minor, currency),
		pending: money(0, currency),
		committed: money(0, currency),
		awaitingApproval: money(0, currency),
		spent30d: money(0, currency),
	});
	const biz = (tiles: unknown[]) =>
		teamDetail(OWNER, { kind: "business", canPropose: true, moneyTiles: tiles });
	assertEquals(overviewMetrics(biz([])).map((m) => m.key), ["members", "live"]);
	const two = overviewMetrics(biz([tile("GBP", 500), tile("EUR", 900)]));
	assertEquals(two.map((m) => m.label), [
		"Members",
		"Live projects",
		"Available · GBP",
		"Available · EUR",
	]);
	assertEquals(overviewMetrics(biz([tile("GBP", 500)]))[2].label, "Available");
});

Deno.test("metrics: a team's live projects are its distinct engaged projects", () => {
	const engagement = (projectSlug: string, stageSlug: string) => ({
		projectSlug,
		title: projectSlug,
		stageSlug,
		stageTitle: stageSlug,
		assignmentStatus: "accepted",
		projectStatus: "active",
		assignees: [],
		stageWi: 0,
		stageCap: null,
	});
	const detail = teamDetail(OWNER, {
		engagements: [
			engagement("prj-a", "stg-a1"),
			engagement("prj-a", "stg-a2"),
			engagement("prj-b", "stg-b1"),
		],
	});
	assertEquals(liveProjectCount(detail), 2);
});
// #endregion

// #region Previews
Deno.test("projects: the first three live engagements, by slug, with their project's completion", () => {
	const engagement = (n: number, status: "active" | "on_hold" = "active") => ({
		projectSlug: `prj-p${n}`,
		title: `Project ${n}`,
		stageSlug: `stg-s${n}`,
		stageTitle: `Stage ${n}`,
		assignmentStatus: "accepted",
		projectStatus: status,
		assignees: [],
		stageWi: 0,
		stageCap: null,
	});
	const detail = teamDetail(OWNER, {
		engagements: [engagement(1, "on_hold"), engagement(2), engagement(3), engagement(4)],
		projects: [{
			id: "prj-p1",
			title: "Project 1",
			href: "/projects/prj-p1",
			counterparty: "Atlas Labs",
			counterpartyAvatar: "",
			state: "active",
			statusLabel: "On hold",
			progress: 0.5,
			due: null,
		}],
	});
	const rows = projectPreview(detail);
	assertEquals(rows.map((r) => r.href), [
		"/projects/prj-p1",
		"/projects/prj-p2",
		"/projects/prj-p3",
	]);
	assertEquals(rows[0].meta, ["Atlas Labs", "Stage 1", "On hold"]);
	assertEquals(rows[0].progress, 0.5);
	assertEquals([rows[1].meta, rows[1].progress], [["Stage 2"], null]);
	assert(rows.every((r) => /^\/projects\/prj-[a-z0-9]+$/.test(r.href)));
});

Deno.test("projects: a business previews its commissions in delivery", () => {
	const project = (n: number, state: "active" | "proposal" | "completed") => ({
		id: `prj-b${n}`,
		title: `Brief ${n}`,
		href: `/projects/prj-b${n}`,
		counterparty: "Juno Park",
		counterpartyAvatar: "",
		state,
		statusLabel: "Active",
		progress: 0.25,
		due: "20 Oct",
	});
	const detail = teamDetail(OWNER, {
		kind: "business",
		canPropose: true,
		projects: [project(1, "completed"), project(2, "active"), project(3, "proposal")],
	});
	const rows = projectPreview(detail);
	assertEquals(rows.map((r) => [r.href, r.meta, r.progress]), [
		["/projects/prj-b2", ["Juno Park", "Active", "20 Oct"], 0.25],
	]);
});

Deno.test("activity: sentence and [when, module], newest eight", () => {
	const entries = Array.from({ length: 10 }, (_, i) => ({
		id: `a${i}`,
		kind: i % 2 === 0 ? "member" as const : "money" as const,
		text: `Event ${i}`,
		actor: i === 0 ? null : `Person ${i}`,
		actorAvatar: null,
		at: `${i}d ago`,
		href: null,
	}));
	const rows = activityRows(entries);
	assertEquals(rows.length, 8);
	assertEquals(rows[0].meta, ["0d ago", "Members"]);
	assertEquals(rows[1].meta, ["1d ago", "Finance"]);
	assertStrictEquals(rows[0].actor, null);
});
// #endregion

// #region Dismissal
Deno.test("dismissal: per entity and per viewer; storage failures never throw", () => {
	const detail = teamDetail(OWNER);
	assertEquals(heroDismissKey(detail), "pj.wsp.setup-hero.dismissed:team:team-1:m-1");
	assertEquals(
		heroDismissKey({ ...detail, viewerMemberId: "m-2" }) === heroDismissKey(detail),
		false,
	);
	const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		get() {
			throw new Error("blocked");
		},
	});
	try {
		assertEquals(readHeroDismissed("k"), false);
		writeHeroDismissed("k");
	} finally {
		if (original) Object.defineProperty(globalThis, "localStorage", original);
		else delete (globalThis as { localStorage?: unknown }).localStorage;
	}
	const store = new Map<string, string>();
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => store.set(k, v),
		},
	});
	try {
		assertEquals(readHeroDismissed("k"), false);
		writeHeroDismissed("k");
		assertEquals(readHeroDismissed("k"), true);
	} finally {
		if (original) Object.defineProperty(globalThis, "localStorage", original);
		else delete (globalThis as { localStorage?: unknown }).localStorage;
	}
});
// #endregion
