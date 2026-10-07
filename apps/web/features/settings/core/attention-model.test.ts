import { assertEquals } from "@std/assert";
import { UNKNOWN_ATTENTION_FACTS } from "@projective/types/settings";
import type { SettingsAttentionFacts } from "@projective/types/settings";
import { attentionBySection, attentionItems, simulatedAttentionFacts } from "./attention-model.ts";

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
	assertEquals(marks, { verification: "warning", integrations: "warning", account: "info" });
});

Deno.test("simulation — auto passes the real facts through; clear and all are fixed positions", () => {
	assertEquals(simulatedAttentionFacts("auto", UNKNOWN_ATTENTION_FACTS), UNKNOWN_ATTENTION_FACTS);
	assertEquals(attentionItems(simulatedAttentionFacts("clear", UNKNOWN_ATTENTION_FACTS)), []);
	assertEquals(attentionItems(simulatedAttentionFacts("all", UNKNOWN_ATTENTION_FACTS)).length, 5);
});
