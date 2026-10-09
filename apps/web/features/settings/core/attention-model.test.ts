import { assertEquals } from "@std/assert";
import { UNKNOWN_ATTENTION_FACTS } from "@projective/types/settings";
import type { SettingsAttentionFacts } from "@projective/types/settings";
import {
	attentionBySection,
	attentionItems,
	cardExpiryCounts,
	simulatedAttentionFacts,
} from "./attention-model.ts";

const verified: NonNullable<SettingsAttentionFacts["verification"]> = {
	isFreelancer: true,
	kycStatus: "verified",
	payoutReady: true,
	payoutStatus: "active",
	processorConnected: true,
	businessesNeedingKyb: [],
};

Deno.test("attention — unreadable facts are neither a problem nor an all-clear", () => {
	assertEquals(attentionItems(UNKNOWN_ATTENTION_FACTS), []);
});

Deno.test("attention — a set-up freelancer with healthy connections has nothing to do", () => {
	assertEquals(
		attentionItems({
			...UNKNOWN_ATTENTION_FACTS,
			verification: verified,
			connections: [{ id: "c", label: "Drive", status: "active" }],
			unverifiedEmails: 0,
		}),
		[],
	);
});

Deno.test("attention — a buyer is never asked for identity or a payout account", () => {
	const items = attentionItems({
		...UNKNOWN_ATTENTION_FACTS,
		verification: { ...verified, isFreelancer: false, kycStatus: "unverified", payoutReady: false },
	});
	assertEquals(items, []);
});

Deno.test("attention — nothing is asked while the processor is not connected here", () => {
	const items = attentionItems({
		...UNKNOWN_ATTENTION_FACTS,
		verification: {
			...verified,
			kycStatus: "unverified",
			payoutReady: false,
			processorConnected: false,
		},
	});
	assertEquals(items, []);
});

Deno.test("attention — a rejected check outranks a missing payout, which outranks an email nudge", () => {
	const items = attentionItems({
		...UNKNOWN_ATTENTION_FACTS,
		verification: {
			...verified,
			kycStatus: "rejected",
			payoutReady: false,
			payoutStatus: "not_started",
		},
		connections: null,
		unverifiedEmails: 2,
	});
	assertEquals(items.map((i) => [i.key, i.tone]), [["kyc", "danger"], ["payout", "warning"], [
		"emails",
		"info",
	]]);
	assertEquals(items[1].title, "Add a payout bank account");
	assertEquals(items[2].title, "Confirm 2 email addresses");
});

Deno.test("attention — a pending check is a calm note; a started payout account asks to finish", () => {
	const items = attentionItems({
		...UNKNOWN_ATTENTION_FACTS,
		verification: {
			...verified,
			kycStatus: "pending",
			payoutReady: false,
			payoutStatus: "restricted",
		},
	});
	assertEquals(items.map((i) => [i.key, i.tone, i.action]), [[
		"payout",
		"warning",
		"Continue setup",
	], ["kyc", "info", "View status"]]);
});

Deno.test("attention — broken connections ask for a reconnect; a revoked one is the person's choice", () => {
	const items = attentionItems({
		...UNKNOWN_ATTENTION_FACTS,
		connections: [
			{ id: "a", label: "Google Drive", status: "expired" },
			{ id: "b", label: "Dropbox", status: "revoked" },
			{ id: "c", label: "Outlook", status: "error" },
		],
	});
	assertEquals(items.map((i) => i.title), ["Reconnect Google Drive", "Reconnect Outlook"]);
});

Deno.test("attention — only businesses the person can manage are listed", () => {
	const items = attentionItems({
		...UNKNOWN_ATTENTION_FACTS,
		verification: {
			...verified,
			businessesNeedingKyb: [{ id: "x", name: "Helia", canManage: true }, {
				id: "y",
				name: "Other",
				canManage: false,
			}],
		},
	});
	assertEquals(items.map((i) => i.key), ["kyb:x"]);
});

Deno.test("attentionBySection — the most urgent tone wins per section", () => {
	const marks = attentionBySection(
		attentionItems(simulatedAttentionFacts("all", UNKNOWN_ATTENTION_FACTS)),
	);
	assertEquals(marks, {
		verification: "warning",
		integrations: "warning",
		account: "danger",
		billing: "danger",
		profile: "info",
	});
});

Deno.test("attention — a scheduled erasure leads, dated in the reader's locale", () => {
	const items = attentionItems({
		...UNKNOWN_ATTENTION_FACTS,
		security: {
			signInMethods: 2,
			canAddSignIn: false,
			accountDeletionAt: "2026-11-07T00:00:00.000Z",
			freelancerRemovalAt: "2027-01-06T00:00:00.000Z",
		},
	}, { locale: "en-GB" });
	assertEquals(items.map((i) => [i.key, i.tone]), [
		["account-deletion", "danger"],
		["freelancer-removal", "warning"],
	]);
	assertEquals(items[0].title, "Your account will be deleted on 7 November 2026");
});

Deno.test("attention — a lone sign-in method is nudged only when another can be connected", () => {
	const lone = { signInMethods: 1, accountDeletionAt: null, freelancerRemovalAt: null };
	assertEquals(
		attentionItems({ ...UNKNOWN_ATTENTION_FACTS, security: { ...lone, canAddSignIn: true } })
			.map((i) => i.key),
		["sign-in-backup"],
	);
	assertEquals(
		attentionItems({ ...UNKNOWN_ATTENTION_FACTS, security: { ...lone, canAddSignIn: false } }),
		[],
	);
});

Deno.test("attention — the profile item only nudges profile steps, with the step's own link", () => {
	const at = (nextAction: "add_photo" | "verify_email" | "become_partner") =>
		attentionItems({
			...UNKNOWN_ATTENTION_FACTS,
			profile: { handle: "juno", score: 60, pendingSteps: 2, nextAction },
		});
	const photo = at("add_photo");
	assertEquals(photo.map((i) => [i.key, i.href, i.action]), [[
		"profile",
		"/juno/edit",
		"Add a profile photo",
	]]);
	assertEquals(at("verify_email"), []);
	assertEquals(at("become_partner"), []);
});

Deno.test("attention — expired cards warn, expiring ones nudge, a failed plan payment is urgent", () => {
	const billing = (expiredCards: number, expiringCards: number, past: boolean) =>
		attentionItems({
			...UNKNOWN_ATTENTION_FACTS,
			billing: { expiredCards, expiringCards, subscriptionState: past ? "past_due" : "active" },
		}).map((i) => [i.key, i.tone]);
	assertEquals(billing(1, 1, false), [["cards-expired", "warning"]]);
	assertEquals(billing(0, 2, false), [["cards-expiring", "info"]]);
	assertEquals(billing(0, 0, true), [["plan-past-due", "danger"]]);
});

Deno.test("cardExpiryCounts — this month and next are expiring, earlier months expired", () => {
	const now = new Date(Date.UTC(2026, 9, 8));
	assertEquals(
		cardExpiryCounts([
			{ expMonth: 9, expYear: 2026 },
			{ expMonth: 10, expYear: 2026 },
			{ expMonth: 11, expYear: 2026 },
			{ expMonth: 12, expYear: 2026 },
			{ expMonth: null, expYear: null },
		], now),
		{ expiredCards: 1, expiringCards: 2 },
	);
});

Deno.test("simulation — auto passes the real facts through; clear and all are fixed positions", () => {
	assertEquals(simulatedAttentionFacts("auto", UNKNOWN_ATTENTION_FACTS), UNKNOWN_ATTENTION_FACTS);
	assertEquals(attentionItems(simulatedAttentionFacts("clear", UNKNOWN_ATTENTION_FACTS)), []);
	assertEquals(attentionItems(simulatedAttentionFacts("all", UNKNOWN_ATTENTION_FACTS)).length, 10);
});
