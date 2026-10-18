import { assertEquals, assertStrictEquals } from "@std/assert";
import {
	type BusinessKyb,
	canOpenVerification,
	KybRequirement,
	presetCapabilities,
	type WorkspaceCapability,
} from "@projective/types/workspace";
import {
	KYB_PROCESSOR_OFFLINE,
	KYB_REQUIREMENT_TEXT,
	KYB_START_FAILED,
	KYB_UNLOCKS,
	kybAction,
	kybMeta,
	kybStamp,
	kybTag,
	runKybStart,
	simulateKyb,
} from "./kyb-model.ts";

/**
 * The business Verification module (BU4): who may open it, and the pure picture the screen draws from
 * the server's KYB read. Every lock, lane link and checklist row that points at the module asks the
 * same predicate the module's gate asks, so nobody is linked to a page that turns them away.
 */

// #region Who may open Verification
const OWNER = presetCapabilities("owner", "business");
const ADMIN = presetCapabilities("admin", "business");
const MEMBER = presetCapabilities("member", "business");
/** An admin the owner granted the billing right (Decision #238). */
const BILLING_ADMIN: WorkspaceCapability[] = [...ADMIN, "manage_billing"];

Deno.test("gate: the admin preset holds manage_settings — the old lock predicate — yet cannot open a business's Verification", () => {
	assertEquals(ADMIN.includes("manage_settings"), true);
	assertEquals(canOpenVerification("business", ADMIN), false);
	assertEquals(canOpenVerification("business", MEMBER), false);
	assertEquals(canOpenVerification("business", OWNER), true);
	assertEquals(canOpenVerification("business", BILLING_ADMIN), true);
});

Deno.test("gate: a team's Verification still follows its settings", () => {
	assertEquals(canOpenVerification("team", presetCapabilities("admin", "team")), true);
	assertEquals(canOpenVerification("team", presetCapabilities("member", "team")), false);
});
// #endregion

// #region The picture the screen draws
const BASE: BusinessKyb = {
	status: "unverified",
	verifiedAt: null,
	connectOnboardingUrl: null,
	requirementsDue: ["connect_account"],
	processorConnected: true,
};
const RESUME = "/api/finance/connect/refresh?scope=business&businessId=b1&back=settings";

Deno.test("tag: one word per state, and a refusal reads Action needed even while pending", () => {
	assertEquals(kybTag(BASE), { label: "Unverified", severity: "secondary" });
	assertEquals(kybTag({ ...BASE, status: "pending", requirementsDue: ["finish_onboarding"] }), {
		label: "In review",
		severity: "info",
	});
	assertEquals(kybTag({ ...BASE, status: "verified", requirementsDue: [] }), {
		label: "Verified",
		severity: "success",
	});
	assertEquals(kybTag({ ...BASE, requirementsDue: ["kyb_rejected"] }).label, "Action needed");
	assertEquals(kybTag({ ...BASE, requirementsDue: ["kyb_expired"] }).label, "Action needed");
	assertEquals(
		kybTag({ ...BASE, status: "pending", requirementsDue: ["provider_restricted"] }),
		{ label: "Action needed", severity: "warning" },
	);
});

Deno.test("tag: nothing with Stripe reads Unverified even when the stored status is pending (seeded Atlas Labs)", () => {
	const seeded: BusinessKyb = { ...BASE, status: "pending" };
	assertEquals(kybTag(seeded), { label: "Unverified", severity: "secondary" });
	// The row, the Tag and the action now tell one story: not started, so start it.
	assertEquals(
		KYB_REQUIREMENT_TEXT.connect_account.startsWith("Verification hasn't started"),
		true,
	);
	assertEquals(kybAction("Atlas Labs", seeded, true), {
		kind: "start",
		label: "Verify Atlas Labs",
	});
});

Deno.test("action: none once verified, ask without the billing right, resume an account, else start", () => {
	assertStrictEquals(
		kybAction("Atlas Labs", { ...BASE, status: "verified", requirementsDue: [] }, true),
		null,
	);
	assertEquals(kybAction("Atlas Labs", BASE, false), {
		kind: "ask",
		text: "Ask the owner to verify the business.",
	});
	assertEquals(kybAction("Atlas Labs", { ...BASE, connectOnboardingUrl: RESUME }, true), {
		kind: "resume",
		label: "Continue verification",
		href: RESUME,
	});
	assertEquals(kybAction("Atlas Labs", { ...BASE, status: "pending" }, true), {
		kind: "start",
		label: "Verify Atlas Labs",
	});
});

Deno.test("action: after a refusal or a lapse the resume reads Verify again, and the row says the same", () => {
	for (const code of ["kyb_rejected", "kyb_expired"] as const) {
		const lapsed: BusinessKyb = { ...BASE, connectOnboardingUrl: RESUME, requirementsDue: [code] };
		assertEquals(kybAction("Atlas Labs", lapsed, true), {
			kind: "resume",
			label: "Verify again",
			href: RESUME,
		});
		// Without an account the same row sits beside a fresh start.
		assertEquals(
			kybAction("Atlas Labs", { ...lapsed, connectOnboardingUrl: null }, true)?.kind,
			"start",
		);
	}
	assertEquals(KYB_REQUIREMENT_TEXT.kyb_rejected.includes("Verify again"), true);
	assertEquals(KYB_REQUIREMENT_TEXT.kyb_rejected.includes("Start again"), false);
	assertEquals(KYB_REQUIREMENT_TEXT.kyb_expired.includes("on hold"), true);
	assertEquals(KYB_REQUIREMENT_TEXT.kyb_expired.includes("operating"), false);
});

Deno.test("action: without the processor nothing can start, so a holder reads why and gets no control", () => {
	const offline: BusinessKyb = { ...BASE, processorConnected: false };
	assertEquals(kybAction("Atlas Labs", offline, true), {
		kind: "unavailable",
		text: KYB_PROCESSOR_OFFLINE,
	});
	assertEquals(
		kybAction("Atlas Labs", { ...offline, connectOnboardingUrl: RESUME }, true)?.kind,
		"unavailable",
	);
	// Who acts is still said first to someone without the billing right.
	assertEquals(kybAction("Atlas Labs", offline, false)?.kind, "ask");
	assertStrictEquals(
		kybAction("Atlas Labs", { ...offline, status: "verified", requirementsDue: [] }, true),
		null,
	);
});

Deno.test("meta: the verified date in UTC with its year, or the count still due", () => {
	const verified: BusinessKyb = { ...BASE, status: "verified", requirementsDue: [] };
	assertEquals(kybMeta({ ...verified, verifiedAt: "2026-02-04T14:14:00Z" }), [
		{ text: "Verified on 4 Feb 2026", tabular: true },
	]);
	// 23:30 in New York is already the next day in UTC — the date never depends on the reader's zone.
	assertEquals(
		kybMeta({ ...verified, verifiedAt: "2026-02-04T23:30:00-05:00" })[0].text,
		"Verified on 5 Feb 2026",
	);
	assertEquals(kybMeta(verified), []);
	assertEquals(kybMeta({ ...verified, verifiedAt: "not a date" }), []);
	assertEquals(kybMeta(BASE), [{ text: "1 requirement due", tabular: true }]);
	assertEquals(
		kybMeta({ ...BASE, requirementsDue: ["finish_onboarding", "kyb_expired"] })[0].text,
		"2 requirements due",
	);
	assertEquals(kybMeta({ ...BASE, requirementsDue: [] }), []);
});

Deno.test("stamp: the corporate crest only once verified", () => {
	assertEquals(
		kybStamp({ ...BASE, status: "verified", requirementsDue: [] }),
		"corporate_verified",
	);
	assertEquals(kybStamp({ ...BASE, status: "pending" }), "none");
	assertEquals(kybStamp(BASE), "none");
});

Deno.test("copy: every requirement code is worded, and verification unlocks exactly three things", () => {
	for (const code of KybRequirement.options) {
		assertEquals(KYB_REQUIREMENT_TEXT[code].length > 0, true, code);
	}
	assertEquals(KYB_UNLOCKS.length, 3);
});
// #endregion

// #region Starting
Deno.test("start: the tab goes to the link the door answered, and nothing is shown", async () => {
	const went: string[] = [];
	const refused = await runKybStart({
		start: () => Promise.resolve({ ok: true, data: { url: "https://connect.example/onboard" } }),
		navigate: (url) => went.push(url),
	});
	assertStrictEquals(refused, null);
	assertEquals(went, ["https://connect.example/onboard"]);
});

Deno.test("start: a refusal is said in the server's words, else a plain sentence — and the tab stays", async () => {
	const went: string[] = [];
	const navigate = (url: string) => went.push(url);
	assertEquals(
		await runKybStart({
			start: () => Promise.resolve({ ok: false, message: "Only the billing right may verify." }),
			navigate,
		}),
		"Only the billing right may verify.",
	);
	assertEquals(
		await runKybStart({ start: () => Promise.resolve({ ok: false }), navigate }),
		KYB_START_FAILED,
	);
	assertEquals(
		await runKybStart({ start: () => Promise.resolve({ ok: true, data: null }), navigate }),
		KYB_START_FAILED,
	);
	assertEquals(went, []);
});
// #endregion

// #region Dev Context Switcher
Deno.test("simulate: auto is the server's read, untouched", () => {
	assertStrictEquals(simulateKyb(BASE, "auto"), BASE);
	assertStrictEquals(simulateKyb(BASE, undefined), BASE);
});

Deno.test("simulate: each position, with and without a Connect account", () => {
	const withAccount: BusinessKyb = { ...BASE, connectOnboardingUrl: RESUME };
	assertEquals(simulateKyb(BASE, "unverified").requirementsDue, ["connect_account"]);
	assertEquals(simulateKyb(withAccount, "unverified").requirementsDue, ["finish_onboarding"]);
	assertEquals(simulateKyb(BASE, "in_review").status, "pending");
	assertEquals(kybTag(simulateKyb(withAccount, "in_review")).label, "In review");
	// In review is only ever a check Stripe holds — never the "hasn't started" row beside it.
	assertEquals(simulateKyb(BASE, "in_review").requirementsDue, ["finish_onboarding"]);
	assertEquals(kybTag(simulateKyb(BASE, "in_review")).label, "In review");
	assertEquals(simulateKyb(BASE, "action_needed").requirementsDue, ["kyb_rejected"]);
	assertEquals(simulateKyb(withAccount, "action_needed").requirementsDue, ["provider_restricted"]);
	assertEquals(kybTag(simulateKyb(BASE, "action_needed")).label, "Action needed");
	const verified = simulateKyb({ ...BASE, verifiedAt: "2026-02-04T14:14:00Z" }, "verified");
	assertEquals(verified.status, "verified");
	assertEquals(verified.requirementsDue, []);
	assertStrictEquals(kybAction("Atlas Labs", verified, true), null);
	// The resume link survives every position, so a simulated step still lands on a real door.
	assertEquals(simulateKyb(withAccount, "unverified").connectOnboardingUrl, RESUME);
});
// #endregion
