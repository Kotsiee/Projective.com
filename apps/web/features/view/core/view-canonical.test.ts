import { assertEquals } from "@std/assert";
import { canonicalViewPath, viewPageMeta } from "./view-canonical.ts";

Deno.test("canonical: a listing's one address is /view/:slug", () => {
	assertEquals(canonicalViewPath("svc-ruxa6p25af"), "/view/svc-ruxa6p25af");
	assertEquals(canonicalViewPath("a b/c"), "/view/a%20b%2Fc");
});

Deno.test("canonical: the page meta names /view/:slug on the origin, whichever route renders it", () => {
	const meta = viewPageMeta(
		{ id: "prd-ab23cd45ef", title: "Logo pack", summary: "Twelve marks." },
		"https://projective.example/",
	);
	assertEquals(meta.canonical, "https://projective.example/view/prd-ab23cd45ef");
	assertEquals(meta.og.url, meta.canonical);
	assertEquals(meta.title, "Logo pack · Projective");
	assertEquals(meta.description, "Twelve marks.");
	assertEquals(meta.robots, "index, follow");
});
