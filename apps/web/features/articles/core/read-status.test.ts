import { assertEquals } from "@std/assert";
import { readFailureStatus } from "./read-status.ts";

/** A failed article read becomes one of three error pages, never a raw service status. */

Deno.test("readFailureStatus keeps a 404 and a 503, and makes anything else a 500", () => {
	assertEquals(readFailureStatus(404), 404);
	assertEquals(readFailureStatus(503), 503);
	for (const status of [400, 401, 403, 409, 422, 500, 502]) {
		assertEquals(readFailureStatus(status), 500, `status ${status}`);
	}
});
