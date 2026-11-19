import { assertEquals } from "@std/assert";
import { mirrorMenuRows } from "./cta-mirror.ts";

Deno.test("mirrorMenuRows offers the rig's controls in its own order, links as url rows", () => {
	const ran: string[] = [];
	const rows = mirrorMenuRows({
		primary: { label: "Buy now", icon: "basket", run: () => ran.push("primary") },
		secondary: { label: "Add to basket", icon: "basket", run: () => ran.push("secondary") },
		contact: { label: "Message client", icon: "message", href: "/messages/dm-1" },
	});
	assertEquals(rows.map((r) => r.key), ["cta-primary", "cta-secondary", "cta-contact"]);
	assertEquals(rows[2].url, "/messages/dm-1");
	assertEquals(rows[2].command, undefined);
	rows[0].command?.({ item: rows[0], originalEvent: new Event("click") });
	assertEquals(ran, ["primary"]);
});

Deno.test("mirrorMenuRows keeps a refused control, disabled, and skips absent ones", () => {
	const rows = mirrorMenuRows({
		primary: { label: "Cohort full", icon: "bell", run: () => {}, disabled: true },
		secondary: null,
		contact: null,
	});
	assertEquals(rows.length, 1);
	assertEquals(rows[0].disabled, true);
	assertEquals(mirrorMenuRows(null), []);
});
