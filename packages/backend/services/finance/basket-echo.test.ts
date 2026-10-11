import { assertEquals } from "@std/assert";
import { echoBasketId } from "./live-basket.ts";
import { basketQueryFromBody } from "./basket-query.ts";
import type { UserContext } from "@projective/types/auth";

/*
 * A basket write answers with the basket the caller is LOOKING AT, read from the body the client's
 * `withContext` builds — not with the basket the changed line lives in, and not with the acting
 * context's default owner.
 */

const TEAM_CONTEXT = { contextType: "team", contextId: "t1" } as UserContext;

Deno.test("a write echoes the viewed list, not the line's basket", () => {
	const query = basketQueryFromBody({ basketId: "bk-wishlist", owner: "personal" }, TEAM_CONTEXT);
	assertEquals(echoBasketId(query, "bk-main"), "bk-wishlist");
	assertEquals(query.owner, "personal");
});

Deno.test("a move out of the viewed basket keeps the viewed basket", () => {
	const query = basketQueryFromBody({ basketId: "bk-main", toBasketId: "bk-gifts" }, TEAM_CONTEXT);
	assertEquals(echoBasketId(query, "bk-gifts"), "bk-main");
});

Deno.test("without a viewed basket the changed one is echoed, under the context's owner", () => {
	const query = basketQueryFromBody({}, TEAM_CONTEXT);
	assertEquals(echoBasketId(query, "bk-main"), "bk-main");
	assertEquals(query.owner, "team:t1");
});
