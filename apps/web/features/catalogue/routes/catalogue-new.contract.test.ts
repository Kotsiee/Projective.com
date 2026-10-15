import { assertEquals } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { fail, ok } from "@server/services/ServiceResult.ts";
import { CatalogueBackendService } from "@server/services/catalogue/CatalogueBackendService.ts";
import { type CataloguePage, EMPTY_FACET_COUNTS } from "@projective/types/catalogue";
import { handler as workspace } from "./workspace-handler.ts";
import { handler as consoleRoute } from "./console-handler.ts";

/**
 * catalogue-new.contract_test — creation is the console's Quick-Init modal and never a page
 * (plan §6.1): no route file answers `catalogue/new`, and `/catalogue/new` reaches the `[id]`
 * handler only to be sent to `/catalogue?create=1` before anything is read. Alongside it, a console
 * URL scoped to one listing is sent to that listing's workspace (Decision #217(l)), also unread.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const ROUTES = new URL("../../../routes/", import.meta.url);

async function routeFiles(dir: URL, prefix = ""): Promise<string[]> {
	const out: string[] = [];
	for await (const entry of Deno.readDir(dir)) {
		const rel = `${prefix}${entry.name}`;
		if (entry.isDirectory) out.push(...await routeFiles(new URL(`${entry.name}/`, dir), `${rel}/`));
		else out.push(rel);
	}
	return out;
}

function get(handlers: unknown, path: string, params: Record<string, string> = {}) {
	const url = new URL(`https://app.example.test${path}`);
	return (handlers as Record<string, Handler>).GET({
		req: new Request(url),
		url,
		params,
		state: {},
	});
}

function location(res: unknown): [number, string | null] {
	return res instanceof Response ? [res.status, res.headers.get("location")] : [200, null];
}

const EMPTY_PAGE: CataloguePage = {
	items: [],
	hasMore: false,
	nextCursor: null,
	total: 0,
	statusCounts: { draft: 0, published: 0, paused: 0, archived: 0 },
	facetCounts: EMPTY_FACET_COUNTS,
	stats: {
		activeListings: 0,
		totalListings: 0,
		views: 0,
		period: "30d",
		asOf: null,
		orders: 0,
		revenue: 0,
		revenueLabel: "",
		revenueChange: null,
		conversion: null,
		avgRating: 0,
	},
	viewerId: "",
};
// #endregion

Deno.test("no route file answers catalogue/new", async () => {
	const files = await routeFiles(ROUTES);
	assertEquals(files.some((f) => f.endsWith("catalogue/[id].tsx")), true);
	assertEquals(files.filter((f) => /(^|\/)catalogue\/new(\.|\/|$)/.test(f)), []);
});

Deno.test("/catalogue/new is a 303 to the create modal, and nothing is read", async () => {
	const detail = stub(
		CatalogueBackendService,
		"detail",
		() => Promise.resolve(fail(404, { message: "No such listing." })),
	);
	try {
		for (const id of ["new", "create", "3f2a8c1e-0d4b-4c5e-9f7a-1b2c3d4e5f60"]) {
			const res = await get(workspace, `/catalogue/${id}`, { id });
			assertEquals(location(res), [303, "/catalogue?create=1"], id);
		}
		assertSpyCalls(detail, 0);

		const res = await get(workspace, "/catalogue/svc-23456789ab", { id: "svc-23456789ab" });
		assertEquals(location(res), [303, "/catalogue"]);
		assertSpyCalls(detail, 1);
	} finally {
		detail.restore();
	}
});

Deno.test("a console scoped to one listing is a 303 to its workspace, unread", async () => {
	const list = stub(
		CatalogueBackendService,
		"list",
		() => Promise.resolve(ok({ page: EMPTY_PAGE })),
	);
	try {
		const scoped = await get(
			consoleRoute,
			"/catalogue?scope=svc-23456789ab&view=analytics&period=90d",
		);
		assertEquals(location(scoped), [303, "/catalogue/svc-23456789ab?tab=analytics&period=90d"]);
		const clients = await get(
			consoleRoute,
			"/catalogue?scope=prd-23456789ab&view=clients&client=@ada_lin",
		);
		assertEquals(location(clients), [303, "/catalogue/prd-23456789ab?tab=clients&client=@ada_lin"]);
		assertSpyCalls(list, 0);

		const all = await get(consoleRoute, "/catalogue?scope=all");
		assertEquals(location(all)[1], null);
		assertSpyCalls(list, 1);
	} finally {
		list.restore();
	}
});
