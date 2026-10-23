import { assertEquals } from "jsr:@std/assert@^1";
import {
	DEFAULT_PROJECT_PARAMS,
	parseProjectParams,
	popoverActiveCount,
	toSearchParams,
} from "./projects-state.ts";

Deno.test("projects-state: a bare query reads the default sort in its natural direction", () => {
	const p = parseProjectParams("");
	assertEquals(p.sort, "recent");
	assertEquals(p.dir, "desc");
	assertEquals(toSearchParams(p).toString(), "");
});

Deno.test("projects-state: a sort with no dir opens in that sort's natural direction", () => {
	assertEquals(parseProjectParams("sort=alphabetical").dir, "asc");
	assertEquals(parseProjectParams("sort=priority").dir, "desc");
});

Deno.test("projects-state: dir is serialised only when it departs from the natural direction", () => {
	assertEquals(toSearchParams({ ...DEFAULT_PROJECT_PARAMS, dir: "desc" }).toString(), "");
	assertEquals(toSearchParams({ ...DEFAULT_PROJECT_PARAMS, dir: "asc" }).toString(), "dir=asc");
	assertEquals(
		toSearchParams({ ...DEFAULT_PROJECT_PARAMS, sort: "alphabetical", dir: "asc" }).toString(),
		"sort=alphabetical",
	);
});

Deno.test("projects-state: sort and dir round-trip through the URL", () => {
	for (const qs of ["sort=alphabetical&dir=desc", "dir=asc", "sort=priority&dir=asc"]) {
		const p = parseProjectParams(qs);
		assertEquals(parseProjectParams(toSearchParams(p)), p);
	}
});

Deno.test("projects-state: an unknown dir falls back to the natural direction", () => {
	assertEquals(parseProjectParams("sort=alphabetical&dir=sideways").dir, "asc");
});

Deno.test("projects-state: a reversed sort counts as one active popover filter", () => {
	assertEquals(popoverActiveCount(DEFAULT_PROJECT_PARAMS), 0);
	assertEquals(popoverActiveCount({ ...DEFAULT_PROJECT_PARAMS, dir: "asc" }), 1);
	assertEquals(
		popoverActiveCount({ ...DEFAULT_PROJECT_PARAMS, sort: "alphabetical", dir: "desc" }),
		2,
	);
});
