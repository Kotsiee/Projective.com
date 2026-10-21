import { assertEquals } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { fail } from "@server/services/ServiceResult.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";
import { cspHeaderFor } from "@web/utils/csp.ts";
import { mintSlug } from "@projective/types/slugs";
import { handler } from "./simulate-handler.ts";
import { catalogueChromeFor, simulatedSlugOf, simulateHref } from "../core/simulate-path.ts";

/**
 * simulate-handler — `/catalogue/[id]/simulate` (Decision #217 (j)) answers a listing that is not the
 * caller's exactly as a missing one (404), never reads a non-slug id, and frames only for its own
 * origin: every answer carries `frame-ancestors 'self'`.
 */

// #region Harness
const SERVICE = mintSlug("service");
const PRODUCT = mintSlug("product");

type Handler = (ctx: unknown) => Response | Promise<Response>;

async function get(id: string): Promise<{ status: number; headers: Headers }> {
	const url = new URL(`https://app.example.test/catalogue/${id}/simulate`);
	const res = await (handler as unknown as Record<string, Handler>).GET({
		req: new Request(url),
		url,
		params: { id },
		state: {},
	});
	if (res instanceof Response) return { status: res.status, headers: res.headers };
	// A Fresh `page()` answer: the status and headers the page will be sent with.
	const answer = res as unknown as { status?: number; headers?: HeadersInit };
	return { status: answer.status ?? 200, headers: new Headers(answer.headers) };
}

function frameAncestors(headers: Headers): string | null {
	const policy = headers.get("content-security-policy") ?? "";
	const found = policy.split("; ").find((d) => d.startsWith("frame-ancestors "));
	return found ? found.slice("frame-ancestors ".length) : null;
}
// #endregion

Deno.test("simulate: a listing that is not the caller's is a 404 that frames only for 'self'", async () => {
	const preview = stub(
		CatalogueBackendService,
		"previewView",
		() => Promise.resolve(fail(404, { message: "No such listing." })),
	);
	try {
		const res = await get(SERVICE);
		assertEquals(res.status, 404);
		assertEquals(frameAncestors(res.headers), "'self'");
		assertEquals(res.headers.get("content-security-policy"), cspHeaderFor("framed"));
		assertSpyCalls(preview, 1);
	} finally {
		preview.restore();
	}
});

Deno.test("simulate: a non-slug id is a 404 and is never read", async () => {
	const preview = stub(
		CatalogueBackendService,
		"previewView",
		() => Promise.resolve(fail(404, { message: "No such listing." })),
	);
	try {
		for (const id of ["new", "3f2c1e9a-0000-4000-8000-000000000000", "prj-abc"]) {
			const res = await get(id);
			assertEquals(res.status, 404, id);
			assertEquals(frameAncestors(res.headers), "'self'", id);
		}
		assertSpyCalls(preview, 0);
	} finally {
		preview.restore();
	}
});

Deno.test("simulate: an unreachable marketplace is a 503, not a not-found", async () => {
	const preview = stub(
		CatalogueBackendService,
		"previewView",
		() => Promise.resolve(fail(503, { message: "We couldn't reach your catalogue just now." })),
	);
	try {
		const res = await get(SERVICE);
		assertEquals(res.status, 503);
		assertEquals(frameAncestors(res.headers), "'self'");
	} finally {
		preview.restore();
	}
});

Deno.test("simulate path: bare chrome on the simulation only, and the href round-trips", () => {
	const at = (path: string) => catalogueChromeFor(new URL(`https://app.example.test${path}`));
	assertEquals(at(`/catalogue/${SERVICE}/simulate`), "bare");
	assertEquals(at(`/catalogue/${SERVICE}/simulate/`), "bare");
	assertEquals(at(`/catalogue/${SERVICE}`), null);
	assertEquals(at("/catalogue"), null);
	assertEquals(at("/checkout/payment"), null);
	assertEquals(simulateHref(SERVICE), `/catalogue/${SERVICE}/simulate`);
	assertEquals(simulatedSlugOf(simulateHref(PRODUCT)), PRODUCT);
	assertEquals(simulatedSlugOf("/catalogue/new/simulate"), null);
});

Deno.test("simulate path: a team's simulation is bare too, and keeps its team", () => {
	const at = (path: string) => catalogueChromeFor(new URL(`https://app.example.test${path}`));
	assertEquals(at(`/teams/north-loop/catalogue/${SERVICE}/simulate`), "bare");
	assertEquals(at(`/teams/north-loop/catalogue/${SERVICE}`), null);
	assertEquals(at("/teams/north-loop/simulate"), null);
	assertEquals(simulateHref(SERVICE, "north-loop"), `/teams/north-loop/catalogue/${SERVICE}/simulate`);
	assertEquals(simulatedSlugOf(simulateHref(PRODUCT, "north-loop")), PRODUCT);
});
