import { assertEquals } from "@std/assert";
import { AssetListQuerySchema } from "./assets.ts";

Deno.test("AssetListQuerySchema: drops unknown filter members and treats empty values as absent", () => {
	const parsed = AssetListQuerySchema.parse({
		scope: "hub",
		subjectId: "",
		sort: "nope",
		dir: "desc",
		kinds: "image, nope ,pdf",
		sources: "x",
		limit: "abc",
		cursor: "",
	});
	assertEquals(parsed.subjectId, undefined);
	assertEquals(parsed.sort, undefined);
	assertEquals(parsed.dir, "desc");
	assertEquals(parsed.kinds, ["image", "pdf"]);
	assertEquals(parsed.sources, undefined);
	assertEquals(parsed.limit, undefined);
	assertEquals(parsed.cursor, null);
});

Deno.test("AssetListQuerySchema: keeps known categories and visibility scopes, dropping the rest", () => {
	const parsed = AssetListQuerySchema.parse({
		scope: "hub",
		categories: "Image,3D, Folder ,Document",
		visibility: "public,secret",
	});
	assertEquals(parsed.categories, ["Image", "3D", "Document"]);
	assertEquals(parsed.visibility, ["public"]);
	assertEquals(
		AssetListQuerySchema.parse({ scope: "hub", categories: "nope" }).categories,
		undefined,
	);
});

Deno.test("AssetListQuerySchema: decodes each path segment on its own, keeping a malformed one", () => {
	const parsed = AssetListQuerySchema.parse({ scope: "hub", path: "/a%2Fb//%E0%A4%A/c" });
	assertEquals(parsed.path, ["a/b", "%E0%A4%A", "c"]);
});

Deno.test("AssetListQuerySchema: refuses a missing scope and an out-of-range limit", () => {
	assertEquals(AssetListQuerySchema.safeParse({}).error?.issues[0].path, ["scope"]);
	assertEquals(AssetListQuerySchema.safeParse({ scope: "hub", limit: "500" }).success, false);
	assertEquals(AssetListQuerySchema.parse({ scope: "hub", limit: "50" }).limit, 50);
});
