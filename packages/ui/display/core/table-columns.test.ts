import { assertEquals } from "@std/assert";
import type { DataColumn } from "../types/data-table.ts";
import {
	clampWidth,
	gridTemplate,
	moveColumn,
	orderedColumns,
	pinnedOffsets,
	priorityHidden,
	resolveLayout,
	toggleHidden,
} from "./table-columns.ts";

interface Row {
	id: string;
}

const text = (id: string, extra: Partial<DataColumn<Row>> = {}): DataColumn<Row> =>
	({ id, header: id, type: "text", value: (r: Row) => r.id, ...extra }) as DataColumn<Row>;

const columns: DataColumn<Row>[] = [
	text("name", { fill: true, minWidth: 200, pinned: true }),
	text("owner", { width: 180, priority: 3 }),
	text("date", { width: 160, priority: 2 }),
	text("size", { width: 100, priority: 1, minWidth: 80, maxWidth: 160 }),
];

Deno.test("with nothing saved the declared order and widths apply", () => {
	const layout = resolveLayout(columns, null);
	assertEquals(layout.order, ["name", "owner", "date", "size"]);
	assertEquals(layout.widths.owner, 180);
	assertEquals(layout.hidden, []);
});

Deno.test("a saved layout drops unknown ids, clamps widths and places new columns", () => {
	const layout = resolveLayout(columns, {
		order: ["size", "gone", "name", "owner"],
		widths: { size: 999, owner: 210 },
		hidden: ["owner", "gone", "name"],
	});
	assertEquals(layout.order, ["size", "name", "owner", "date"]);
	assertEquals(layout.widths.size, 160);
	assertEquals(layout.widths.owner, 210);
	assertEquals(layout.hidden, ["owner"]);
});

Deno.test("defaultHidden columns start hidden only when nothing is saved", () => {
	const withHidden = [...columns, text("notes", { defaultHidden: true })];
	assertEquals(resolveLayout(withHidden, null).hidden, ["notes"]);
	assertEquals(resolveLayout(withHidden, { hidden: [] }).hidden, []);
});

Deno.test("moving, hiding and ordering keep pinned columns first", () => {
	const layout = resolveLayout(columns, null);
	const moved = { ...layout, order: moveColumn(layout.order, "name", 3) };
	assertEquals(moved.order, ["owner", "date", "size", "name"]);
	const shown = orderedColumns(columns, toggleHidden(moved, "date")).map((c) => c.id);
	assertEquals(shown, ["name", "owner", "size"]);
});

Deno.test("widths clamp to a column's bounds", () => {
	assertEquals(clampWidth(columns[3], 10), 80);
	assertEquals(clampWidth(columns[3], 120.4), 120);
});

Deno.test("priority hiding drops the least important columns first and stops when they fit", () => {
	const widths = resolveLayout(columns, null).widths;
	assertEquals(priorityHidden(columns, widths, 1000, 40), []);
	assertEquals(priorityHidden(columns, widths, 580, 40), ["size"]);
	assertEquals(priorityHidden(columns, widths, 560, 40), ["size", "date"]);
	assertEquals(priorityHidden(columns, widths, 300, 40), ["size", "date", "owner"]);
	assertEquals(priorityHidden(columns, widths, 0, 40), []);
});

Deno.test("the grid template fills, reserves lead/tail tracks and pads a fill-less table", () => {
	const widths = resolveLayout(columns, null).widths;
	assertEquals(
		gridTemplate(columns, widths, { lead: true, tail: true }),
		"var(--dt-lead-w) minmax(200px, 1fr) 180px 160px 100px var(--dt-tail-w)",
	);
	assertEquals(
		gridTemplate(columns.slice(1, 2), widths, { lead: false, tail: false }),
		"180px minmax(0, 1fr)",
	);
});

Deno.test("pinned columns stack their sticky offsets", () => {
	const widths = { a: 120, b: 90, c: 50 };
	const pinned: DataColumn<Row>[] = [
		text("a", { pinned: true }),
		text("b", { pinned: true }),
		text("c"),
	];
	assertEquals(pinnedOffsets(pinned, widths), { a: 0, b: 120 });
});
