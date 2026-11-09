import { assertEquals } from "@std/assert";
import { INSPECT_PANEL_TABS, PANEL_TABS, parsePanelTab, tabWithin } from "./panel-tab.ts";

Deno.test("a stored panel tab reads back, and anything else opens on View", () => {
	assertEquals(parsePanelTab("details"), "details");
	assertEquals(parsePanelTab("view"), "view");
	assertEquals(parsePanelTab("access"), "access");
	for (const raw of [null, "", "Details", "controls"]) assertEquals(parsePanelTab(raw), "view");
});

Deno.test("a strip without the remembered tab shows View; the page's strip keeps Access", () => {
	assertEquals(tabWithin("access", PANEL_TABS), "view");
	assertEquals(tabWithin("details", PANEL_TABS), "details");
	assertEquals(tabWithin("access", INSPECT_PANEL_TABS), "access");
});
