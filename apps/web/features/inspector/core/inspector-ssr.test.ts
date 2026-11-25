import { assertEquals } from "@std/assert";
import { ANONYMOUS_READER } from "@server/services/read-actor.ts";
import { resolveInspect } from "./inspector-ssr.ts";

Deno.test("the inspector page answers a uuid, its old address, with the one 404 (Decision #563)", async () => {
	for (
		const key of ["6d43f88f-84c7-4454-a2e1-c3bd6a2839e2", "prj-abcdefghjk", "", "fil-0000000000"]
	) {
		assertEquals(
			await resolveInspect(key, null, ANONYMOUS_READER),
			{ asset: null, status: 404 },
			key,
		);
	}
});
