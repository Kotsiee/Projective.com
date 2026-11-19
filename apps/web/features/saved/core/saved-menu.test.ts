import { assertEquals } from "@std/assert";
import { saveListRows } from "./saved-menu.ts";

const LIST = { id: "00000000-0000-4000-8000-000000000001", name: "Inspiration" };

Deno.test("saveListRows offers no rows until the lists are read", () => {
	assertEquals(saveListRows({ lists: null, onPick: () => {}, onNewList: () => {} }), []);
});

Deno.test("saveListRows lists each list, then a separator and New list…", () => {
	const picked: string[] = [];
	const rows = saveListRows({
		lists: [LIST],
		onPick: (list) => picked.push(list.id),
		onNewList: () => picked.push("new"),
	});
	assertEquals(rows.map((r) => r.separator ? "|" : r.label), ["Inspiration", "|", "New list…"]);
	rows[0].command?.({ item: rows[0], originalEvent: new Event("click") });
	rows[2].command?.({ item: rows[2], originalEvent: new Event("click") });
	assertEquals(picked, [LIST.id, "new"]);
});

Deno.test("saveListRows offers only New list… when there are none", () => {
	const rows = saveListRows({ lists: [], onPick: () => {}, onNewList: () => {} });
	assertEquals(rows.map((r) => r.key), ["save-list-new"]);
});
