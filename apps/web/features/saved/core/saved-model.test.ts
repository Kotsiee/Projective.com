import { assertEquals } from "@std/assert";
import type { SavedItem } from "@projective/types/org";
import { metaLine, parseCollection, parseTab, savedHref, tabHasCollections } from "./saved-model.ts";

Deno.test("the deep link round-trips and omits defaults", () => {
	assertEquals(savedHref("all"), "/saved");
	assertEquals(savedHref("people", "unfiled"), "/saved?tab=people&collection=unfiled");
	assertEquals(parseTab("people"), "people");
	assertEquals(parseTab("nope"), "all");
	assertEquals(parseCollection("unfiled"), "unfiled");
	assertEquals(parseCollection("1e62d824-5686-4899-a443-8ef26ad85777"), "1e62d824-5686-4899-a443-8ef26ad85777");
	assertEquals(parseCollection("'; drop"), undefined);
});

Deno.test("collections are offered only where a collectable kind is listed", () => {
	assertEquals(tabHasCollections("all"), true);
	assertEquals(tabHasCollections("listings"), true);
	assertEquals(tabHasCollections("messages"), true);
	assertEquals(tabHasCollections("projects"), false);
	assertEquals(tabHasCollections("files"), false);
});

Deno.test("the meta line says saved or followed, and skips a store with no instant", () => {
	const base: SavedItem = {
		type: "profile",
		ref: "juno",
		title: "Juno Park",
		meta: "Freelancer",
		thumbnail: null,
		href: "/@juno",
		savedAt: "2026-10-10T12:00:00Z",
		collectionId: null,
		following: false,
	};
	const now = Date.parse("2026-10-12T12:00:00Z");
	assertEquals(metaLine(base, now), "Freelancer · saved 2 days ago");
	assertEquals(metaLine({ ...base, following: true }, now), "Freelancer · followed 2 days ago");
	assertEquals(metaLine({ ...base, savedAt: null }, now), "Freelancer");
});
