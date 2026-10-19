/**
 * The Overview's rules (`overview-model.ts`, Teams work order C1; the business branches, BU6):
 * exactly one filled control in every setup state, no control a viewer cannot use, no money a viewer
 * was not answered, the zones that stand in for a dismissed hero, and the previews built from the B7
 * payload.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
	canActOnSetupStep,
	presetCapabilities,
	type SetupStep,
	type SetupStepId,
	type WorkspaceCapability,
	type WorkspaceDetail,
	WorkspaceDetailSchema,
	type WorkspaceKind,
} from "@projective/types/workspace";
import {
	activityRows,
	addMoneyHrefFor,
	businessMoney,
	filledControls,
	HERO_ACTION_LABEL,
	heroDismissGuard,
	heroDismissKey,
	heroSteps,
	liveProjectCount,
	overviewMetrics,
	overviewModel,
	projectPreview,
	readHeroDismissed,
	setupHero,
	walletBalanceFacts,
	writeHeroDismissed,
} from "./overview-model.ts";

// #region Fixtures
const TEAM_STEPS: SetupStepId[] = ["invite", "money", "profile", "verification", "publish"];
/** A business on a plan that lets it set spending rules (Business Pro): five steps. */
const BUSINESS_STEPS: SetupStepId[] = ["invite", "verification", "fund", "money", "publish"];

/** Each step's page, as `setupSteps` addresses it (a team's, but for a business's Add money). */
const HREF: Record<SetupStepId, string> = {
	invite: "/teams/northloop/invitations",
	money: "/teams/northloop/payouts",
	profile: "/@northloop/edit",
	fund: "/wallet?w=business:team-1",
	verification: "/settings/verification#identity-check",
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
			const hero = setupHero({ kind, name: "Northloop", steps, dismissed: false });
			const allDone = mask === (1 << ids.length) - 1;
			if (allDone) {
				assertStrictEquals(hero, null, `${kind} ${mask}: a finished setup draws no hero`);
				continue;
			}
			assert(hero, `${kind} ${mask}: an open step draws the hero`);
			const filled = hero.steps.filter((s) => s.action?.filled);
			assertEquals(filled.length, 1, `${kind} mask ${mask}: ${controls(hero.steps)}`);
			// The fill sits on the first open step, and takes its tier: the structural Invite member,
			// a business's amber Add money, else the primary.
			const first = steps.find((s) => !s.done)!;
			assertEquals(filled[0].id, first.id);
			assertEquals(
				filled[0].action!.tier,
				first.id === "invite" ? 2 : first.id === "fund" ? 1 : 3,
			);
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
	const fresh = setupHero({
		kind: "team",
		name: "Northloop",
		steps: stepsOf(TEAM_STEPS, 0),
		dismissed: false,
	})!;
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
		kind: "team",
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
	const split = setupHero({
		kind: "team",
		name: "N",
		steps: stepsOf(TEAM_STEPS, 0b00001),
		dismissed: false,
	})!;
	assertEquals(split.steps[1].action, {
		kind: "link",
		tier: 3,
		filled: true,
		label: "Step money",
		href: "/teams/northloop/payouts",
	});
});

Deno.test("hero: a done step reads Done; an open one its note", () => {
	const hero = setupHero({
		kind: "team",
		name: "N",
		steps: stepsOf(TEAM_STEPS, 0b00011),
		dismissed: false,
	})!;
	assertEquals(hero.steps.map((s) => s.note), [
		"Done",
		"Done",
		"Why profile",
		"Why verification",
		"Why publish",
	]);
});

Deno.test("hero: a control names the act in a word or two, never the step's long label", () => {
	// The labels `setupSteps` sends (packages/backend/services/workspace/mappers.ts).
	const sent: Record<WorkspaceKind, Partial<Record<SetupStepId, string>>> = {
		team: {
			invite: "Invite a second member",
			money: "Set the split",
			profile: "Complete the public profile",
			verification: "Verify the owner",
			publish: "Publish",
		},
		business: {
			invite: "Invite a colleague",
			verification: "Verify the business",
			fund: "Add money",
			money: "Set spending rules",
			publish: "Publish",
		},
	};
	const expected: Record<WorkspaceKind, string[]> = {
		team: ["Invite member", "Set the split", "Edit profile", "Verify identity", "Publish"],
		business: ["Invite member", "Verify business", "Add money", "Set rules", "Publish"],
	};
	for (const [kind, ids] of [["team", TEAM_STEPS], ["business", BUSINESS_STEPS]] as const) {
		// Each step in turn as the step at hand (every step before it done), so each one's control —
		// Publish included — is drawn.
		const labels = ids.map((_, i) => {
			const steps = stepsOf(ids, (1 << i) - 1).map((s) => ({ ...s, label: sent[kind][s.id]! }));
			return setupHero({ kind, name: "N", steps, dismissed: false })!.steps[i].action!.label;
		});
		assertEquals(labels, expected[kind]);
		// Short enough for one line of a small Button in a fifth of the band.
		for (const label of labels) assert(label.length <= 15, `${kind}: "${label}" is too long`);
	}
	// The table only ever shortens: no entry is longer than the label it replaces.
	for (const kind of ["team", "business"] as const) {
		for (const [id, label] of Object.entries(HERO_ACTION_LABEL[kind])) {
			const own = sent[kind][id as SetupStepId];
			if (own) assert(label.length <= own.length, `${kind}:${id} grew to "${label}"`);
		}
	}
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
		kind: "team",
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
		kind: "team",
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

Deno.test("partial rights: Publish is never the fill while the steps before it are open", () => {
	// A custom role holding manage_settings alone (Decision #250 lets one be built): the owner is
	// verified, but the invite, the split and the profile are still open. The DB would accept the
	// publish; the band must not hand them the one-way commit ahead of the steps that come first.
	const settingsOnly: WorkspaceCapability[] = ["manage_settings"];
	const steps = stepsOf(
		TEAM_STEPS,
		0b01000,
		(id) => canActOnSetupStep("team", id, settingsOnly),
	);
	const hero = setupHero({ kind: "team", name: "N", steps, dismissed: false })!;
	assertEquals(controls(hero.steps), [
		"invite:-",
		"money:-",
		"profile:-",
		"verification:-",
		"publish:-",
	]);
	assertEquals(hero.steps.find((s) => s.current)?.id, "invite");
	const detail = teamDetail(settingsOnly, { setup: steps });
	assertEquals(filledControls(overviewModel(detail, { dismissed: false })), 0);
	// Once Publish IS the step at hand, the same viewer gets it as the band's fill.
	const last = stepsOf(TEAM_STEPS, 0b01111, (id) => canActOnSetupStep("team", id, settingsOnly));
	assertEquals(
		controls(setupHero({ kind: "team", name: "N", steps: last, dismissed: false })!.steps),
		[
			"invite:-",
			"money:-",
			"profile:-",
			"verification:-",
			"publish:3*",
		],
	);
});

Deno.test("partial rights: an admin is never offered the owner's identity check", () => {
	const admin = presetCapabilities("admin", "team");
	// Invite, split and profile done: the owner's check is the step at hand.
	const steps = stepsOf(TEAM_STEPS, 0b00111, (id) => canActOnSetupStep("team", id, admin));
	const hero = setupHero({ kind: "team", name: "N", steps, dismissed: false })!;
	assertEquals(controls(hero.steps), [
		"invite:-",
		"money:-",
		"profile:-",
		"verification:-",
		"publish:-",
	]);
	// The owner is, as the band's fill — a link to their own settings.
	const own = stepsOf(TEAM_STEPS, 0b00111, (id) => canActOnSetupStep("team", id, OWNER, true));
	const ownHero = setupHero({ kind: "team", name: "N", steps: own, dismissed: false })!;
	assertEquals(ownHero.steps[3].action, {
		kind: "link",
		tier: 3,
		filled: true,
		label: "Verify identity",
		href: "/settings/verification#identity-check",
	});
});

Deno.test("hero: a link step with no page offers no control", () => {
	const steps = stepsOf(TEAM_STEPS, 0b00001).map((s) => s.id === "money" ? { ...s, href: "" } : s);
	const hero = setupHero({ kind: "team", name: "N", steps, dismissed: false })!;
	assertEquals(controls(hero.steps), [
		"invite:-",
		"money:-",
		"profile:3*",
		"verification:4",
		"publish:-",
	]);
});

Deno.test("hero: Publish is a draft's — an archived, never-published team is offered no Publish", () => {
	// Every other step done and Publish open, as a read that keeps the step open while archived would
	// send it: the status door would refuse `active` (`restore_target` — it restores as a draft), so
	// the hero offers nothing there and Settings' Restore is the way back.
	const steps = stepsOf(TEAM_STEPS, 0b01111, (id) => canActOnSetupStep("team", id, OWNER, true));
	for (const status of ["archived", "active"] as const) {
		const model = overviewModel(teamDetail(OWNER, { status, setup: steps }), { dismissed: false });
		assert(model.hero, status);
		assertEquals(controls(model.hero.steps), [
			"invite:-",
			"money:-",
			"profile:-",
			"verification:-",
			"publish:-",
		], status);
		assertEquals(filledControls(model), 0, status);
		assertEquals(
			heroSteps({ status, setup: steps }).find((s) => s.id === "publish")?.actionable,
			false,
		);
	}
	// The same steps on a draft: Publish is the band's one fill.
	const draft = overviewModel(teamDetail(OWNER, { setup: steps }), { dismissed: false });
	assertEquals(draft.hero?.steps[4].action?.kind, "publish");
	assertEquals(filledControls(draft), 1);
	// Only the Publish step is withheld — the server's other answers pass through unchanged.
	assertEquals(
		heroSteps({ status: "archived", setup: stepsOf(TEAM_STEPS, 0) }).map((s) => s.actionable),
		[true, true, true, true, false],
	);
});
// #endregion

// #region The business hero (BU6)
const BIZ_OWNER = presetCapabilities("owner", "business");
const BIZ_ADMIN = presetCapabilities("admin", "business");
/** The plain member preset: `contribute_funds` and `view_analytics`. */
const BIZ_MEMBER = presetCapabilities("member", "business");

/** A business's five steps, actionable as `setupSteps` stamps them (KYB in review: for nobody). */
const bizSteps = (mask: number, caps: readonly WorkspaceCapability[], inReview = false) =>
	stepsOf(
		BUSINESS_STEPS,
		mask,
		(id) => !(id === "verification" && inReview) && canActOnSetupStep("business", id, caps),
	);

/** A one-person draft business for `caps`. */
const bizDetail = (caps: readonly WorkspaceCapability[], over: Record<string, unknown> = {}) =>
	teamDetail(caps, { kind: "business", canPropose: true, ...over });

Deno.test("business hero: a fresh owner — Invite member is the fill; Publish an unfilled tier 3 beside it", () => {
	const hero = setupHero({
		kind: "business",
		name: "Probe Co",
		steps: bizSteps(0, BIZ_OWNER),
		dismissed: false,
	})!;
	assertEquals(controls(hero.steps), [
		"invite:2*",
		"verification:4",
		"fund:4",
		"money:4",
		"publish:3",
	]);
	// Publish is a one-way commit, never a utility: the primary tier, outlined (Decision #248).
	assertEquals(hero.steps[4].action, {
		kind: "publish",
		tier: 3,
		filled: false,
		label: "Step publish",
		href: "",
	});
	// Once the invitation is out, verifying is the step at hand.
	const invited = setupHero({
		kind: "business",
		name: "Probe Co",
		steps: bizSteps(0b00001, BIZ_OWNER),
		dismissed: false,
	})!;
	assertEquals(controls(invited.steps), [
		"invite:-",
		"verification:3*",
		"fund:4",
		"money:4",
		"publish:3",
	]);
});

Deno.test("business hero: KYB with the reviewers → Add money is the one fill, amber, into the top-up", () => {
	const detail = bizDetail(BIZ_OWNER, {
		verification: "pending",
		setup: bizSteps(0b00001, BIZ_OWNER, true),
	});
	const model = overviewModel(detail, { dismissed: false });
	assert(model.hero);
	assertEquals(controls(model.hero.steps), [
		"invite:-",
		"verification:-",
		"fund:1*",
		"money:4",
		"publish:3",
	]);
	assertEquals(filledControls(model), 1);
	const fund = model.hero.steps[2].action!;
	// Add money keeps the step's own label (the fixture's "Step fund"); no shorter one is needed.
	assertEquals([fund.kind, fund.label], ["link", "Step fund"]);
	// The business wallet with its top-up open, and the way back to this Overview.
	const url = new URL(fund.href, "https://projective.test");
	assertEquals(url.pathname, "/wallet");
	assertEquals(url.searchParams.get("w"), "business:team-1");
	assertEquals(url.searchParams.get("do"), "top_up");
	assertEquals(url.searchParams.get("back"), "/businesses/northloop");
	assertEquals(fund.href, addMoneyHrefFor("team-1", "northloop"));
	assertEquals(fund.href.startsWith("/wallet?w=business"), true);
	assertEquals(fund.href.endsWith("&do=top_up&back=%2Fbusinesses%2Fnorthloop"), true);
});

Deno.test("business hero: a plain member (contribute only) is offered Add money and nothing else", () => {
	const model = overviewModel(bizDetail(BIZ_MEMBER, { setup: bizSteps(0, BIZ_MEMBER) }), {
		dismissed: false,
	});
	assert(model.hero);
	assertEquals(controls(model.hero.steps), [
		"invite:-",
		"verification:-",
		"fund:1*",
		"money:-",
		"publish:-",
	]);
	// The business is still at its invite step, whoever is looking.
	assertEquals(model.hero.steps.find((s) => s.current)?.id, "invite");
});

Deno.test("business hero: a settings-only role may publish whenever — the fill when it is theirs first", () => {
	const settingsOnly: WorkspaceCapability[] = ["manage_settings"];
	const hero = setupHero({
		kind: "business",
		name: "Probe Co",
		steps: bizSteps(0, settingsOnly),
		dismissed: false,
	})!;
	assertEquals(controls(hero.steps), [
		"invite:-",
		"verification:-",
		"fund:-",
		"money:-",
		"publish:3*",
	]);
	// The team rule is unchanged: a team's Publish waits for the steps before it (see above).
});

Deno.test("business hero: never two fills and never two ambers, for any viewer in any state", () => {
	const viewers: readonly WorkspaceCapability[][] = [
		BIZ_OWNER,
		BIZ_ADMIN,
		BIZ_MEMBER,
		["manage_settings"],
		["contribute_funds", "manage_settings"],
		["view_analytics"],
	];
	for (const caps of viewers) {
		for (const inReview of [false, true]) {
			for (let mask = 0; mask < 1 << BUSINESS_STEPS.length; mask++) {
				const hero = setupHero({
					kind: "business",
					name: "N",
					steps: bizSteps(mask, caps, inReview),
					dismissed: false,
				});
				if (!hero) continue;
				const where = `[${caps.join(", ")}] mask ${mask} review ${inReview}`;
				const filled = hero.steps.filter((s) => s.action?.filled);
				assert(filled.length <= 1, `${where}: ${controls(hero.steps)}`);
				assert(
					hero.steps.filter((s) => s.action?.tier === 1).length <= 1,
					`${where}: two ambers`,
				);
				// The amber is only ever Add money, and only as the fill.
				for (const s of hero.steps) {
					if (s.action?.tier === 1) assertEquals([s.id, s.action.filled], ["fund", true], where);
				}
				// Every unfinished step the viewer may act on offers a control — Publish included.
				for (const s of hero.steps) {
					if (
						!s.done && canActOnSetupStep("business", s.id, caps) &&
						!(s.id === "verification" && inReview)
					) {
						assert(s.action, `${where}: ${s.id} offers nothing`);
					}
				}
			}
		}
	}
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

Deno.test("zones: a business's lock is the hero's to say while it shows the step (BU6)", () => {
	const detail = bizDetail(BIZ_OWNER, {
		verification: "pending",
		setup: bizSteps(0, BIZ_OWNER, true),
	});
	const model = overviewModel(detail, { dismissed: false });
	assert(model.hero);
	assertEquals(model.lock, false);
	assertEquals(model.standIn.lock, true);
	// Dismissed, it is simply shown.
	const hidden = overviewModel(detail, { dismissed: true });
	assertEquals([hidden.lock, hidden.standIn.lock], [true, false]);
});

Deno.test("zones: a draft business's not-active notice stands in for the hero's Publish (BU6)", () => {
	const detail = bizDetail(BIZ_OWNER, { setup: bizSteps(0b00001, BIZ_OWNER) });
	const shown = overviewModel(detail, { dismissed: false });
	assert(shown.hero);
	assertStrictEquals(shown.draft, null);
	assertEquals(shown.standIn.draft, { canPublish: true });
	const hidden = overviewModel(detail, { dismissed: true });
	assertEquals(hidden.draft, { canPublish: true });
	assertStrictEquals(hidden.standIn.draft, null);
	// Its Publish is a tier-3 fill — the Overview's one, since no hero is showing it.
	assertEquals(filledControls(hidden), 1);
	assertEquals(filledControls(shown), 1);
	// Someone who may not publish is told the fact (and, in the island, who to ask) — no fill.
	const member = overviewModel(bizDetail(BIZ_MEMBER, { setup: bizSteps(0, BIZ_MEMBER) }), {
		dismissed: true,
	});
	assertEquals(member.draft, { canPublish: false });
	assertEquals(filledControls(member), 0);
	// The notice's Publish is never on screen beside a hero fill: for every viewer and setup state of
	// a draft business, the hero (showing Publish) or the notice carries the one fill, never both.
	const viewers: readonly WorkspaceCapability[][] = [
		BIZ_OWNER,
		BIZ_ADMIN,
		BIZ_MEMBER,
		["manage_settings"],
		PLAIN,
	];
	for (const caps of viewers) {
		// Bit 4 is Publish, never done on a draft.
		for (let mask = 0; mask < 0b10000; mask++) {
			for (const dismissed of [false, true]) {
				const model = overviewModel(bizDetail(caps, { setup: bizSteps(mask, caps) }), {
					dismissed,
				});
				const where = `[${caps.join(", ")}] mask ${mask} dismissed ${dismissed}`;
				assert(filledControls(model) <= 1, where);
				assert(!(model.hero && model.draft), where);
			}
		}
	}
	// An active business has none; nor does a draft team (its Publish is its own hero rule).
	const active = bizDetail(BIZ_OWNER, { status: "active", setup: bizSteps(0b10000, BIZ_OWNER) });
	assertStrictEquals(overviewModel(active, { dismissed: true }).draft, null);
	assertStrictEquals(overviewModel(active, { dismissed: false }).standIn.draft, null);
	assertStrictEquals(overviewModel(teamDetail(OWNER), { dismissed: true }).draft, null);
});

Deno.test("zones: an archived business draws no hero — no Add money into a wallet that cannot pay out (BU6)", () => {
	// Never funded, its Publish done (it is not a draft): the steps alone would hand a contribute-only
	// member the amber Add money.
	for (const caps of [BIZ_OWNER, BIZ_MEMBER]) {
		const detail = bizDetail(caps, {
			status: "archived",
			verification: "verified",
			verificationPrompt: null,
			setup: bizSteps(0b10011, caps),
		});
		assert(setupHero({ kind: "business", name: "N", steps: detail.setup, dismissed: false }));
		const model = overviewModel(detail, { dismissed: false });
		assertStrictEquals(model.hero, null);
		assertStrictEquals(model.draft, null);
		assertEquals(model.standIn, { lock: false, propose: null, draft: null });
		assertEquals(filledControls(model), 0);
		// Its money is still read for whoever may open Finance — the figures, not a way to add to them.
		assert(model.money);
	}
	// A team keeps C1's rule.
	assert(
		overviewModel(teamDetail(OWNER, { status: "archived" }), { dismissed: false }).hero,
	);
});

Deno.test("zones: what the hero carries stands in behind the guard, and only that", () => {
	// A one-person, unverified team with the hero up: the lock and the two-member rule are the
	// hero's to say, so they wait as stand-ins for a viewer whose dismissal the guard finds.
	const shown = overviewModel(teamDetail(OWNER), { dismissed: false });
	assertEquals([shown.lock, shown.propose], [false, null]);
	assertEquals(shown.standIn, { lock: true, propose: { canInvite: true }, draft: null });
	// Dismissed, they are simply shown — nothing stands in.
	const hidden = overviewModel(teamDetail(OWNER), { dismissed: true });
	assertEquals(hidden.standIn, { lock: false, propose: null, draft: null });
	// With the invite and the owner's check done, the hero carries neither, so nothing stands in.
	const settled = overviewModel(
		teamDetail(OWNER, {
			verification: "verified",
			canPropose: true,
			members: [member("m-1"), member("m-2")],
			setup: stepsOf(TEAM_STEPS, 0b01001),
		}),
		{ dismissed: false },
	);
	assert(settled.hero);
	assertEquals(settled.standIn, { lock: false, propose: null, draft: null });
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

Deno.test("metrics: a business's money stays in its own band; its proposals out are a tile", () => {
	const tile = (currency: string, minor: number) => ({
		currency,
		available: money(minor, currency),
		pending: money(0, currency),
		committed: money(0, currency),
		awaitingApproval: money(0, currency),
		spent30d: money(0, currency),
	});
	const project = (n: number, state: "active" | "proposal") => ({
		id: `prj-b${n}`,
		title: `Brief ${n}`,
		href: `/projects/prj-b${n}`,
		counterparty: "Juno Park",
		counterpartyAvatar: "",
		state,
		statusLabel: state === "proposal" ? "Proposal" : "Active",
		progress: 0,
		due: null,
	});
	const biz = (caps: readonly WorkspaceCapability[], over: Record<string, unknown> = {}) =>
		teamDetail(caps, { kind: "business", canPropose: true, ...over });
	// The money tiles never become metric tiles — the band below carries the business's money.
	const answered = biz(OWNER, { moneyTiles: [tile("GBP", 500), tile("EUR", 900)] });
	assertEquals(overviewMetrics(answered).map((m) => m.key), ["members", "live"]);
	// Proposals awaiting a reply are counted, and only when there are some.
	const out = biz(OWNER, {
		projects: [project(1, "proposal"), project(2, "proposal"), project(3, "active")],
	});
	const metrics = overviewMetrics(out);
	assertEquals(metrics.map((m) => [m.key, m.label]), [
		["members", "Members"],
		["live", "Live projects"],
		["proposals", "Proposals out"],
	]);
	const proposals = metrics[2];
	assert(proposals.type === "count");
	assertEquals([proposals.value, proposals.caption], [2, "Awaiting a reply"]);
	// A team's proposals are its allowance, never this count.
	assertEquals(
		overviewMetrics(teamDetail(OWNER, { projects: [project(1, "proposal")] })).some((m) =>
			m.key === "proposals"
		),
		false,
	);
});

Deno.test("money band: BB9's tiles for whoever may open Finance — and only them (BD18, BD19)", () => {
	const tile = (currency: string, minor: number) => ({
		currency,
		available: money(minor, currency),
		pending: money(0, currency),
		committed: money(0, currency),
		awaitingApproval: money(0, currency),
		spent30d: money(0, currency),
	});
	const tiles = [tile("USD", 250_000), tile("EUR", 900)];
	const biz = (caps: readonly WorkspaceCapability[]) => bizDetail(caps, { moneyTiles: tiles });
	for (const right of ["contribute_funds", "spend_funds", "manage_finances"] as const) {
		const band = businessMoney(biz([right]));
		assert(band, right);
		assertEquals(band.tiles.map((x) => [x.currency, x.available.minor]), [
			["USD", 250_000],
			["EUR", 900],
		]);
		// Every viewer the band renders for may open the business wallet (membership is `view`), so
		// the band always carries the hand-off; there is no second gate on it (BD19).
		assertEquals(band.walletHref, "/wallet?w=business:team-1");
		assertEquals(Object.keys(band).sort(), ["tiles", "walletHref"]);
		assertEquals(overviewModel(biz([right]), { dismissed: false }).money, band);
	}
	// The plain member preset pays into the pool, so it sees the band.
	assert(businessMoney(biz(BIZ_MEMBER)));
	// A withdraw-only role cannot open Finance (BD18): no band; nor can analytics alone.
	assertStrictEquals(businessMoney(biz(["withdraw_funds"])), null);
	assertStrictEquals(businessMoney(biz(PLAIN)), null);
	// A team's money is the vault tile — never this band, whatever the viewer holds.
	assertStrictEquals(businessMoney(teamDetail(OWNER)), null);
});

Deno.test("walletBalanceFacts: one figure per currency in its own currency, or that the wallet is empty", () => {
	const tile = (currency: string, minor: number) => ({
		currency,
		available: money(minor, currency),
		pending: money(0, currency),
		committed: money(0, currency),
		awaitingApproval: money(0, currency),
		spent30d: money(0, currency),
	});
	// Each figure is the tile's own `display` — a EUR wallet reads in euros whoever is looking.
	assertEquals(walletBalanceFacts([tile("USD", 250_000), tile("EUR", 900)]), [
		{ key: "USD", figure: "USD 250000", text: "available" },
		{ key: "EUR", figure: "EUR 900", text: "available" },
	]);
	assertEquals(walletBalanceFacts([]), [
		{ key: "empty", figure: null, text: "Nothing in the wallet yet" },
	]);
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
Deno.test("dismissal guard: reads the viewer's key and marks the stack before the hero paints", () => {
	const key = heroDismissKey(teamDetail(OWNER));
	const guard = heroDismissGuard(key);
	assertEquals(guard.includes(JSON.stringify(key)), true);
	assertEquals(guard.includes('setAttribute("data-hero-dismissed","")'), true);
	// No key can close the script element it is written into.
	const hostile = heroDismissGuard("</script><script>alert(1)</script>");
	assertEquals(hostile.includes("<"), false);
	// It is a self-contained expression that swallows every storage failure.
	assertEquals(guard.startsWith("(()=>{try{"), true);
	assertEquals(guard.endsWith("catch(_){}})();"), true);
	// And it runs: a stored dismissal marks the script's parent, anything else leaves it alone.
	const run = (stored: string | null) => {
		const marks: string[] = [];
		const scope = {
			localStorage: { getItem: (k: string) => (k === key ? stored : null) },
			document: {
				currentScript: { parentElement: { setAttribute: (name: string) => marks.push(name) } },
			},
		};
		new Function("localStorage", "document", guard)(scope.localStorage, scope.document);
		return marks;
	};
	assertEquals(run("1"), ["data-hero-dismissed"]);
	assertEquals(run(null), []);
});

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
