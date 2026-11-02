import { assertEquals } from "@std/assert";
import { previewHref, previewRows } from "./nav-preview-menu.ts";

const NOW = Date.parse("2026-11-03T12:00:00Z");

Deno.test("preview rows say loading, failed and empty with one inert row", () => {
	for (const state of [undefined, { status: "loading" } as const]) {
		const [row] = previewRows("messages", state, NOW, "en");
		assertEquals([row.label, row.disabled], ["Loading…", true]);
	}
	assertEquals(previewRows("projects", { status: "error" }, NOW, "en")[0].disabled, true);
	assertEquals(
		previewRows("teams", { status: "ready", items: [] }, NOW, "en")[0].label,
		"No teams yet",
	);
});

Deno.test("a preview item is an Open row with its picture, pin, time and detail", () => {
	const [row] = previewRows(
		"messages",
		{
			status: "ready",
			items: [{
				ref: "t 1",
				title: "Mara",
				image: null,
				detail: "See you then",
				at: "2026-11-03T11:55:00Z",
				pinned: true,
			}],
		},
		NOW,
		"en",
	);
	assertEquals(row.url, "/messages/t%201");
	assertEquals(row.image, null);
	assertEquals(row.hint, "Starred · 5 min. ago · See you then");
	assertEquals(row.items?.length, 5, "Open · new tab · new window · separator · Copy link");
});

Deno.test("each destination opens at its own route", () => {
	assertEquals(previewHref("projects", "prj-ab"), "/projects/prj-ab");
	assertEquals(previewHref("teams", "studio"), "/teams/studio");
	assertEquals(previewHref("businesses", "acme"), "/businesses/acme");
});
