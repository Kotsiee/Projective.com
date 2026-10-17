import { assertEquals } from "@std/assert";
import {
	canActOnSetupStep,
	isCoOwner,
	OWNER_RESERVED,
	presetCapabilities,
	SetupStepId,
	spendAccess,
	type WorkspaceCapability,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { importWithoutGlyphs, type RegistryApi } from "./registry-import.testing.ts";

/**
 * The money and admin module gates (BUSINESSES_AUDIT BF29, BF30; Decision #230 (d)), per preset and
 * per the custom roles the gates exist for. The registry's glyphs import CSS, so it loads through
 * {@link importWithoutGlyphs}.
 */
const { mayViewModule } = await importWithoutGlyphs<RegistryApi>("./module-registry.tsx");

// #region Fixtures
const OWNER = presetCapabilities("owner", "business");
const ADMIN = presetCapabilities("admin", "business");
const MEMBER = presetCapabilities("member", "business");
/** An admin the owner granted the billing right. */
const BILLING_ADMIN: WorkspaceCapability[] = [...ADMIN, "manage_billing"];
/** A custom role that may only approve spend. */
const APPROVER: WorkspaceCapability[] = ["approve_spend"];
/** A custom role that may only spend. */
const SPENDER: WorkspaceCapability[] = ["spend_funds"];

const MONEY = ["finance", "spend", "billing", "verification"] as const;

/** Which of the four money/admin modules a viewer may open. */
const opens = (kind: WorkspaceKind, caps: readonly WorkspaceCapability[]): string[] =>
	MONEY.filter((m) => mayViewModule(m, kind, caps));
// #endregion

Deno.test("gates: the business owner opens all four", () => {
	assertEquals(opens("business", OWNER), ["finance", "spend", "billing", "verification"]);
});

Deno.test("gates: the admin preset runs the money but holds no billing right", () => {
	assertEquals(opens("business", ADMIN), ["finance", "spend"]);
});

Deno.test("gates: the owner's billing grant opens Billing and Verification for that admin", () => {
	assertEquals(opens("business", BILLING_ADMIN), ["finance", "spend", "billing", "verification"]);
});

Deno.test("gates: a plain member sees the pool they pay into, nothing else", () => {
	assertEquals(opens("business", MEMBER), ["finance"]);
});

Deno.test("gates: an approve-only role opens Spend and sees the queue, not the editor", () => {
	assertEquals(opens("business", APPROVER), ["spend"]);
	assertEquals(spendAccess(APPROVER), {
		envelope: false,
		queue: true,
		decide: true,
		editor: false,
	});
});

Deno.test("gates: a spender gets their envelope and the pool, not the queue", () => {
	assertEquals(opens("business", SPENDER), ["finance", "spend"]);
	assertEquals(spendAccess(SPENDER), {
		envelope: true,
		queue: false,
		decide: false,
		editor: false,
	});
});

Deno.test("gates: the policy editor sees the queue and the editor", () => {
	assertEquals(spendAccess(ADMIN), { envelope: true, queue: true, decide: true, editor: true });
});

Deno.test("gates: a team keeps Verification on settings and renders no billing right", () => {
	const owner = presetCapabilities("owner", "team");
	assertEquals(owner.includes("manage_billing"), false);
	assertEquals(opens("team", owner), ["finance", "verification"]);
	assertEquals(opens("team", presetCapabilities("member", "team")), []);
});

Deno.test("co-owner: an admin seat holding every reserved right, and nothing less", () => {
	assertEquals(isCoOwner("business", "admin", [...ADMIN, ...OWNER_RESERVED]), true);
	assertEquals(isCoOwner("business", "admin", BILLING_ADMIN), false);
	assertEquals(isCoOwner("business", "owner", OWNER), false);
	assertEquals(isCoOwner("team", "admin", [...ADMIN, ...OWNER_RESERVED]), false);
});

Deno.test("co-owner: the admin preset is unchanged — it lacks exactly the reserved rights", () => {
	assertEquals(
		OWNER.filter((c) => !ADMIN.includes(c)),
		[...OWNER_RESERVED].sort((a, b) => OWNER.indexOf(a) - OWNER.indexOf(b)),
	);
});

// #region Setup steps (Teams C1)
/** The module each setup step's action lands on (`mappers.ts` `setupSteps` hrefs). */
const STEP_MODULE: Record<SetupStepId, (kind: WorkspaceKind) => string> = {
	invite: () => "invitations",
	money: (kind) => kind === "team" ? "payouts" : "spend",
	profile: () => "profile",
	logo: () => "profile",
	bio: () => "profile",
	verification: () => "verification",
	publish: () => "settings",
};

/** Every preset of both kinds plus single-right custom roles. */
const VIEWERS: readonly WorkspaceCapability[][] = [
	...(["owner", "admin", "lead", "member"] as const).flatMap((preset) => [
		presetCapabilities(preset, "team"),
		presetCapabilities(preset, "business"),
	]),
	BILLING_ADMIN,
	APPROVER,
	SPENDER,
	["view_analytics"],
	["invite_members"],
	["manage_finances"],
	["edit_profile"],
	["manage_settings"],
	["manage_billing"],
	[],
];

Deno.test("setup steps: a step a viewer may act on always lands on a module they may open", () => {
	for (const kind of ["team", "business"] as const) {
		for (const caps of VIEWERS) {
			for (const step of SetupStepId.options) {
				if (!canActOnSetupStep(kind, step, caps)) continue;
				assertEquals(
					mayViewModule(STEP_MODULE[step](kind), kind, caps),
					true,
					`${kind} ${step} for [${caps.join(", ")}]`,
				);
			}
		}
	}
});

Deno.test("setup steps: a team's steps are actionable exactly when their module opens", () => {
	for (const caps of VIEWERS) {
		for (const step of ["invite", "money", "profile", "verification", "publish"] as const) {
			assertEquals(
				canActOnSetupStep("team", step, caps),
				mayViewModule(STEP_MODULE[step]("team"), "team", caps),
				`team ${step} for [${caps.join(", ")}]`,
			);
		}
	}
});
// #endregion
