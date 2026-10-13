import { assertEquals } from "@std/assert";
import {
	type RevisionFundingFacts,
	revisionFundingCheck,
	revisionPurchase,
	walletFundingRefusal,
} from "./revision-purchase.ts";

/*
 * Paid revisions (Decision #167) — the gates for one round, through the basket's `paid_revision` line
 * and straight from the review (Decision #199), the same rules `projects.fund_paid_revision` applies at
 * payment. The SQL side is exercised by `supabase/probes/paid_revisions.sql` against a migrated database.
 */

const ROUND = { status: "awaiting_payment", price_cents: 5_000 };
const PROJECT = { client_business_id: null, owner_user_id: "owner", currency: "USD" };
const OWNER = { ownerType: "user" as const, ownerId: "owner", isEntity: false };

Deno.test("a raised round is bought by the project's client at its snapshot price", () => {
	assertEquals(revisionPurchase(ROUND, PROJECT, OWNER), {
		price: { minor: 5_000, currency: "USD" },
		closed: null,
	});
});

Deno.test("only the account that owns the project can pay for its round", () => {
	const stranger = { ...OWNER, ownerId: "someone-else" };
	assertEquals(
		revisionPurchase(ROUND, PROJECT, stranger).closed,
		"Pay for this revision from the account that owns its project.",
	);
	const business = { ownerType: "business" as const, ownerId: "biz", isEntity: true };
	const businessProject = { ...PROJECT, client_business_id: "biz" };
	assertEquals(revisionPurchase(ROUND, businessProject, business).closed, null);
	assertEquals(revisionPurchase(ROUND, businessProject, OWNER).closed !== null, true);
});

Deno.test("a round already open, resolved or cancelled is not for sale", () => {
	for (const status of ["open", "resolved", "cancelled"]) {
		assertEquals(
			revisionPurchase({ ...ROUND, status }, PROJECT, OWNER).closed,
			"This revision is no longer waiting for payment.",
		);
	}
});

const SUBMISSION = "6f1c2c4e-8a43-4c1e-9d55-0b7a3c2e9f10";
const FACTS: RevisionFundingFacts = {
	revision: {
		id: "0d7b4a8e-1f2c-4b6a-9e3d-5c8f7a6b4e21",
		status: "awaiting_payment",
		price_cents: "5000",
		project_stage_id: "stage-uuid",
		submission_id: SUBMISSION,
		request_type: "paid_revision",
	},
	stage: { id: "stage-uuid", slug: "stg-abc123", extra_revision_price_cents: 5_000 },
	project: { id: "project-uuid", slug: "prj-xyz789", currency: "usd", client_business_id: null, owner_user_id: "owner" },
};
const PAY = {
	projectId: "prj-xyz789",
	stageId: "stg-abc123",
	submissionId: SUBMISSION,
	expectedAmountMinor: 5_000,
	currency: "USD",
};

Deno.test("a direct payment goes ahead at the round's price, addressed by slug or id", () => {
	assertEquals(revisionFundingCheck(FACTS, PAY), null);
	assertEquals(revisionFundingCheck(FACTS, { ...PAY, projectId: "project-uuid", stageId: "stage-uuid" }), null);
});

Deno.test("a round outside the route's project, stage or submission reads as missing", () => {
	for (const wrong of [{ projectId: "prj-other" }, { stageId: "stg-other" }, { submissionId: "another" }]) {
		assertEquals(revisionFundingCheck(FACTS, { ...PAY, ...wrong })?.status, 404);
	}
	const elsewhere = { ...FACTS, revision: { ...FACTS.revision, project_stage_id: "other-stage" } };
	assertEquals(revisionFundingCheck(elsewhere, PAY)?.status, 404);
});

Deno.test("a round no longer awaiting payment, or not a paid round, is refused", () => {
	for (const status of ["open", "resolved", "cancelled"]) {
		const settled = { ...FACTS, revision: { ...FACTS.revision, status } };
		assertEquals(revisionFundingCheck(settled, PAY), {
			status: 409,
			message: "This revision is no longer waiting for payment.",
		});
	}
	const free = { ...FACTS, revision: { ...FACTS.revision, request_type: "revision" } };
	assertEquals(revisionFundingCheck(free, PAY)?.status, 409);
});

Deno.test("an unpriced round, or one whose stage was repriced since, is refused", () => {
	const unpriced = { ...FACTS, revision: { ...FACTS.revision, price_cents: null } };
	assertEquals(revisionFundingCheck(unpriced, PAY)?.message, "This revision isn't priced.");
	const repriced = { ...FACTS, stage: { ...FACTS.stage, extra_revision_price_cents: 6_000 } };
	assertEquals(revisionFundingCheck(repriced, PAY)?.status, 409);
});

Deno.test("a price or currency other than the one shown refuses rather than charging", () => {
	assertEquals(revisionFundingCheck(FACTS, { ...PAY, expectedAmountMinor: 4_000 })?.status, 409);
	assertEquals(revisionFundingCheck(FACTS, { ...PAY, currency: "GBP" })?.status, 409);
	assertEquals(revisionFundingCheck(FACTS, { ...PAY, currency: "usd" }), null);
});

Deno.test("the wallet door's refusals are worded for the buyer", () => {
	assertEquals(
		walletFundingRefusal({ code: "PF402", message: "Needs funding — the client's wallet doesn't hold enough." }),
		{ status: 402, message: "Your wallet's available balance doesn't cover this revision — pay by card instead." },
	);
	assertEquals(
		walletFundingRefusal({ code: "PF402", message: "Needs funding — this would exceed the spending limit." }).message,
		"This would exceed your spending limit on the business wallet.",
	);
	assertEquals(walletFundingRefusal({ code: "42501", message: "Only the project's owner can pay." }), {
		status: 403,
		message: "Only the project's owner can pay.",
	});
	assertEquals(walletFundingRefusal({ code: "PC409", message: "Already paid." }).status, 409);
	assertEquals(walletFundingRefusal({ code: "23514", message: "no payee" }).status, 409);
	assertEquals(walletFundingRefusal({ code: "XX000", message: "boom" }).status, 500);
});
