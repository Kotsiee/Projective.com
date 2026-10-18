import { assertEquals, assertStrictEquals } from "@std/assert";
import { latestRequest } from "./live-buyer.ts";

/**
 * The checkout's view of the member's own requests for a basket (`latestRequest`, Decisions #243 and
 * #246): the approval the redeemer would spend first, else the newest — and nothing at all when the
 * newest was withdrawn, so an older refusal is never read back as the answer.
 */

// #region Fixtures
const NOW = Date.parse("2026-10-17T12:00:00Z");

type Status = "pending" | "approved" | "rejected" | "expired" | "withdrawn";

function row(id: string, status: Status, amount = 50_000) {
	return {
		id,
		amount_cents: amount,
		currency: "usd",
		status,
		approver_user_id: status === "approved" || status === "rejected" ? "u-priya" : null,
		expires_at: "2026-10-24T12:00:00Z",
		created_at: "2026-10-17T10:00:00Z",
	};
}

const covers = (r: { amount_cents: number | string }) => Number(r.amount_cents) >= 50_000;
// #endregion

Deno.test("latestRequest: a withdrawn newest request leaves no history — not the older refusal", () => {
	// R1 declined, R2 filed and then withdrawn: newest first, as readRequests orders them.
	assertStrictEquals(
		latestRequest([row("r2", "withdrawn"), row("r1", "rejected")], NOW, covers),
		null,
	);
	assertStrictEquals(latestRequest([row("r1", "withdrawn")], NOW, covers), null);
});

Deno.test("latestRequest: an approval that covers the charge still wins over a newer withdrawal", () => {
	const latest = latestRequest([row("r2", "withdrawn"), row("r1", "approved")], NOW, covers);
	assertEquals([latest?.row.id, latest?.state, latest?.covers], ["r1", "approved", true]);
});

Deno.test("latestRequest: a withdrawal older than the newest request changes nothing", () => {
	const latest = latestRequest([row("r2", "pending"), row("r1", "withdrawn")], NOW, covers);
	assertEquals([latest?.row.id, latest?.state], ["r2", "pending"]);
	assertEquals(latestRequest([row("r1", "rejected")], NOW, covers)?.state, "declined");
	assertEquals(
		latestRequest([{ ...row("r1", "pending"), expires_at: "2026-10-17T11:00:00Z" }], NOW, covers)
			?.state,
		"expired",
	);
});
