import { assertEquals } from "@std/assert";
import { engagementKeysOf } from "./live-basket.ts";

Deno.test("a product line is narrowed by its own slug, as Buy Now's ?service_id= names it", () => {
	assertEquals(engagementKeysOf({ family: "product", slug: "prd-k3v9q2" }, null), {
		serviceId: "prd-k3v9q2",
	});
});

Deno.test("a service line is narrowed by the service's slug", () => {
	assertEquals(engagementKeysOf({ family: "service", slug: "svc-a81mzx" }, null), {
		serviceId: "svc-a81mzx",
	});
});

Deno.test("a project line groups under its project and names no service", () => {
	assertEquals(engagementKeysOf({ family: "project", slug: "prj-tm2bjk9mdq" }, null), {
		projectId: "prj-tm2bjk9mdq",
	});
});

Deno.test("a paid revision is narrowed by its round and still groups under its project", () => {
	assertEquals(
		engagementKeysOf(
			{ family: "project", slug: "prj-tm2bjk9mdq" },
			"8c1f0d3e-5b7a-4c2e-9f10-2a6b4d8e1c37",
		),
		{ projectId: "prj-tm2bjk9mdq", serviceId: "8c1f0d3e-5b7a-4c2e-9f10-2a6b4d8e1c37" },
	);
});

Deno.test("a line whose listing is gone carries no engagement key", () => {
	assertEquals(engagementKeysOf(null, null), {});
});
