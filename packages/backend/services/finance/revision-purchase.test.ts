import { assertEquals } from "@std/assert";
import { revisionPurchase } from "./live-basket.ts";

/*
 * Paid revisions (Decision #167) — the basket's gate for one `paid_revision` line, the same rules
 * `projects.fund_paid_revision` applies at payment. The SQL side is exercised by
 * `supabase/probes/paid_revisions.sql` against a migrated database.
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
