import { assertEquals, assertRejects } from "@std/assert";
import { HttpError } from "fresh";
import { handler as workspace } from "@web/routes/(dashboard)/legal/workspace/index.tsx";
import { handler as auditPacks } from "@web/routes/(dashboard)/legal/workspace/audit-packs.tsx";
import { handler as transfers } from "@web/routes/(dashboard)/legal/workspace/transfers.tsx";

/**
 * The IP workspace's three addresses answer 404 until LG4 builds them (LG0). A handler runs only
 * after the `(dashboard)` guard has admitted a signed-in adult, so a guest still meets the login
 * redirect and a 13–17 account is still sent home first.
 */

type Handler = (ctx: unknown) => unknown;

for (
	const [path, handler] of [
		["/legal/workspace", workspace],
		["/legal/workspace/audit-packs", auditPacks],
		["/legal/workspace/transfers", transfers],
	] as const
) {
	Deno.test(`GET ${path} is a 404 for a signed-in adult`, async () => {
		const url = new URL(`https://projective.test${path}`);
		const ctx = { req: new Request(url), url, params: {}, state: {} };
		const err = await assertRejects(
			async () => await (handler as unknown as Record<string, Handler>).GET(ctx),
			HttpError,
		);
		assertEquals(err.status, 404);
	});
}
