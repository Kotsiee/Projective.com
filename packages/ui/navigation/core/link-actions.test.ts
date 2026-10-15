import { assert, assertEquals } from "@std/assert";
import type { MenuItem } from "../../types/mod.ts";
import { absoluteHref, composeMenu, linkActionItems } from "./link-actions.ts";

const keys = (rows: MenuItem[]) => rows.map((row) => row.separator ? "|" : row.key);

Deno.test("linkActionItems offers Open, new tab, copy, share and save in order", () => {
	const rows = linkActionItems({
		href: "/projects/prj-1",
		title: "Site",
		onShare: () => {},
		save: { saved: false, onToggle: () => {} },
	});
	assertEquals(keys(rows), [
		"link-open",
		"link-open-new-tab",
		"link-copy",
		"link-share",
		"link-save",
	]);
	assertEquals(rows[0].url, "/projects/prj-1");
	assertEquals(rows[1].target, "_blank");
});

Deno.test("linkActionItems drops Share without a share flow or device sheet, and Save without state", () => {
	const nav = globalThis.navigator as { share?: unknown };
	if (typeof nav.share === "function") return;
	const rows = linkActionItems({ href: "/x", title: "X" });
	assertEquals(keys(rows), ["link-open", "link-open-new-tab", "link-copy"]);
});

Deno.test("linkActionItems honours include order and names a saved item's removal", () => {
	const rows = linkActionItems({
		href: "/x",
		title: "X",
		include: ["save", "copy-link"],
		save: { saved: true, onToggle: () => {} },
	});
	assertEquals(keys(rows), ["link-save", "link-copy"]);
	assertEquals(rows[0].label, "Remove from saved");
});

Deno.test("linkActionItems runs the caller's share flow", () => {
	let shared = 0;
	const [row] = linkActionItems({
		href: "/x",
		title: "X",
		include: ["share"],
		onShare: () => shared++,
	});
	row.command?.({ item: row, originalEvent: new Event("click") });
	assertEquals(shared, 1);
});

Deno.test("composeMenu joins non-empty groups with one separator each", () => {
	const a: MenuItem[] = [{ key: "a" }];
	const b: MenuItem[] = [{ key: "b" }];
	assertEquals(keys(composeMenu(a, [], b)), ["a", "|", "b"]);
	assertEquals(composeMenu([], []), []);
});

Deno.test("absoluteHref leaves an href alone outside a document", () => {
	const href = absoluteHref("/x");
	assert(href === "/x" || href.endsWith("/x"));
});
