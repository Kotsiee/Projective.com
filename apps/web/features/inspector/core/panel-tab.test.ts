import { assertEquals } from "@std/assert";
import { parsePanelTab } from "./panel-tab.ts";

Deno.test("a stored panel tab reads back, and anything else opens on View", () => {
	assertEquals(parsePanelTab("details"), "details");
	assertEquals(parsePanelTab("view"), "view");
	for (const raw of [null, "", "Details", "controls"]) assertEquals(parsePanelTab(raw), "view");
});
