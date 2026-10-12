import { assertEquals } from "jsr:@std/assert@^1";
import { basketIds, hydrateBasket } from "./basket-state.ts";

function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

Deno.test("hydrateBasket: a guest never reads /api/basket, a signed-in reader reads it once", async () => {
	const calls: string[] = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = (input: string | URL | Request): Promise<Response> => {
		calls.push(String(input));
		return Promise.resolve(Response.json({ ok: false, message: "unavailable" }, { status: 503 }));
	};
	try {
		basketIds.value = ["sv-left-over"];
		hydrateBasket(false);
		await settle();
		assertEquals(calls, []);
		assertEquals(basketIds.value, []);

		hydrateBasket(true);
		hydrateBasket(true);
		await settle();
		assertEquals(calls.length, 1);
		assertEquals(calls[0].startsWith("/api/basket"), true);
	} finally {
		globalThis.fetch = realFetch;
	}
});
