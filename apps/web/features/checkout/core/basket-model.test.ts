import { assertEquals } from "@std/assert";
import type { BasketItem } from "../types/checkout-types.ts";
import { basketHref, buildCheckoutQuery, fundingNote, withContext } from "./basket-model.ts";

/*
 * The write echo (Decision #70(k)): every basket write names the basket the caller is looking at and
 * whose money it is, so the basket it answers with is that one — not the line's own basket, and not
 * the acting context's default owner.
 */

const CTX = { basketId: "bk-wishlist", owner: "personal", display: "GBP" } as const;

Deno.test("a write carries the viewed basket and the owner, personal included", () => {
	assertEquals(withContext({ basketItemId: "line-1", savedForLater: true }, CTX), {
		basketId: "bk-wishlist",
		basketItemId: "line-1",
		savedForLater: true,
		owner: "personal",
		display: "GBP",
	});
});

Deno.test("a payload's own basketId wins over the context's", () => {
	const body = withContext({ basketId: null, itemType: "digital_product", itemId: "x" }, CTX);
	assertEquals(body.basketId, null);
	assertEquals(body.owner, "personal");
});

Deno.test("reads and links keep a personal owner", () => {
	assertEquals(new URLSearchParams(buildCheckoutQuery(CTX)).get("owner"), "personal");
	assertEquals(basketHref("bk-1", "personal"), "/checkout?basket=bk-1&owner=personal");
	assertEquals(basketHref(null, "team:t1"), "/checkout?owner=team%3At1");
});

function line(patch: Partial<BasketItem>): BasketItem {
	return {
		itemType: "project_ticket",
		title: "Hero section",
		ticketId: null,
		available: true,
		metadata: {},
		...patch,
	} as BasketItem;
}

Deno.test("funding note: a ticket funds its holder and is held in escrow", () => {
	assertEquals(
		fundingNote(line({ ticketId: "tkt-1", metadata: { payeeName: "Juno Park" } })),
		"Funds Juno Park to start Hero section. Held in escrow until you approve the work.",
	);
	assertEquals(fundingNote(line({ ticketId: "tkt-1", available: false })), null);
});

Deno.test("funding note: sessions are held in escrow, products say nothing", () => {
	assertEquals(
		fundingNote(line({ itemType: "service_session" })),
		"Held in escrow until after the session.",
	);
	assertEquals(fundingNote(line({ itemType: "digital_product" })), null);
});
