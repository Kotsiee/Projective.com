import { assertEquals } from "@std/assert";
import type { DataColumn } from "../types/data-table.ts";
import {
	clampWidth,
	gridTemplate,
	moveColumn,
	orderedColumns,
	pinnedOffsets,
	priorityHidden,
	resizeColumn,
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

Deno.test("resizing after a fill column moves only the handle's edge", () => {
	const layout = resolveLayout(columns, null);
	const grow = resizeColumn(layout, columns[1], 240, { columns, slack: 100 });
	assertEquals(grow.widths, { name: 200, owner: 240, date: 100, size: 100 });
	const shrink = resizeColumn(layout, columns[1], 150, { columns, slack: 100 });
	assertEquals(shrink.widths, { name: 200, owner: 150, date: 190, size: 100 });
});

Deno.test("compensation cascades within bounds and leaves the rest to the fill", () => {
	const layout = resolveLayout(columns, null);
	const ctx = { columns, slack: 100 };
	assertEquals(resizeColumn(layout, columns[1], 380, ctx).widths, {
		name: 200,
		owner: 380,
		date: 72,
		size: 80,
	});
	assertEquals(resizeColumn(layout, columns[2], 40, ctx).widths.size, 160);
	const fixed = columns.map((c) => c.id === "date" ? { ...c, resizable: false } : c);
	assertEquals(resizeColumn(layout, fixed[1], 200, { columns: fixed, slack: 100 }).widths, {
		name: 200,
		owner: 200,
		date: 160,
		size: 80,
	});
});

Deno.test("an overflowing table grows freely and only compensates past its overflow", () => {
	const layout = resolveLayout(columns, null);
	const grow = resizeColumn(layout, columns[1], 260, { columns, slack: -40 });
	assertEquals(grow.widths, { name: 200, owner: 260, date: 160, size: 100 });
	const shrink = resizeColumn(layout, columns[1], 120, { columns, slack: -40 });
	assertEquals(shrink.widths, { name: 200, owner: 120, date: 180, size: 100 });
});

Deno.test("without a fill before the handle the later columns just shift", () => {
	const layout = resolveLayout(columns, null);
	const ctx = { columns, slack: 100 };
	assertEquals(resizeColumn(layout, columns[1], 240).widths.date, 160);
	const trailing = [columns[1], columns[2], columns[0]];
	assertEquals(
		resizeColumn(layout, columns[1], 240, { ...ctx, columns: trailing }).widths.date,
		160,
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
