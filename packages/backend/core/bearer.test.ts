import { assertEquals } from "@std/assert";
import { isBearerAuthorised } from "./bearer.ts";

const SECRET = "s".repeat(40);

Deno.test("isBearerAuthorised — only the exact bearer token passes", () => {
	assertEquals(isBearerAuthorised(`Bearer ${SECRET}`, SECRET), true);
	assertEquals(isBearerAuthorised(`Bearer ${SECRET}x`, SECRET), false);
	assertEquals(isBearerAuthorised(SECRET, SECRET), false);
	assertEquals(isBearerAuthorised(null, SECRET), false);
});

Deno.test("isBearerAuthorised — a short or missing secret authorises nothing", () => {
	assertEquals(isBearerAuthorised("Bearer short", "short"), false);
	assertEquals(isBearerAuthorised("Bearer ", undefined), false);
});
