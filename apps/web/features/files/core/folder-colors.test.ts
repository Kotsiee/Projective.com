import { assertEquals } from "@std/assert";
import {
	afterPick,
	colorName,
	fieldPalette,
	FOLDER_COLORS,
	paletteFor,
	paletteOf,
	parseRecent,
	SWATCH_CELLS,
	SWATCH_COLUMNS,
} from "./folder-colors.ts";
import { FolderColor } from "../types/file-types.ts";

const BLUE = FOLDER_COLORS[0].hex;
const RED = FOLDER_COLORS[2].hex;
const CUSTOM = "#123456";

Deno.test("two rows of six, the last cell being the plus", () => {
	assertEquals(SWATCH_CELLS, SWATCH_COLUMNS * 2);
	assertEquals(paletteOf([]).length, SWATCH_CELLS - 1);
});

Deno.test("every default colour is one a folder can store", () => {
	for (const { hex } of FOLDER_COLORS) assertEquals(FolderColor.safeParse(hex).success, true);
	assertEquals(new Set(FOLDER_COLORS.map((color) => color.hex)).size, FOLDER_COLORS.length);
});

Deno.test("with nothing picked, the default set shows in its own order", () => {
	assertEquals(paletteOf([]), FOLDER_COLORS.map((color) => color.hex));
});

Deno.test("the last colour picked comes first, and a default does not repeat", () => {
	const palette = paletteOf([RED]);
	assertEquals(palette[0], RED);
	assertEquals(palette.filter((hex) => hex === RED).length, 1);
	assertEquals(palette.length, SWATCH_CELLS - 1);
});

Deno.test("a custom colour leads and pushes the last default off the row", () => {
	const palette = paletteOf([CUSTOM]);
	assertEquals(palette[0], CUSTOM);
	assertEquals(palette.includes(FOLDER_COLORS.at(-1)?.hex ?? ""), false);
});

Deno.test("a folder's own colour stays reachable once it falls out of the recents", () => {
	const palette = paletteOf([]);
	assertEquals(paletteFor(palette, null), palette);
	assertEquals(paletteFor(palette, BLUE), palette);
	const own = paletteFor(palette, CUSTOM);
	assertEquals(own.length, palette.length);
	assertEquals(own.at(-1), CUSTOM);
});

Deno.test("New folder's grid holds No colour, the swatches and the + in a menu's twelve cells", () => {
	const palette = paletteOf([]);
	const field = fieldPalette(palette, null);
	assertEquals(1 + field.length + 1, SWATCH_CELLS);
	const custom = fieldPalette(palette, CUSTOM);
	assertEquals(custom.length, field.length);
	assertEquals(custom.at(-1), CUSTOM);
	assertEquals(fieldPalette(palette, field[0]), field);
});

Deno.test("picking again moves a colour to the front rather than repeating it", () => {
	assertEquals(afterPick([RED, BLUE], BLUE), [BLUE, RED]);
	assertEquals(afterPick([], CUSTOM), [CUSTOM]);
});

Deno.test("the recents never outgrow the row", () => {
	const many = Array.from({ length: 20 }, (_, i) => `#0000${String(i).padStart(2, "0")}`);
	assertEquals(afterPick(many, CUSTOM).length, SWATCH_CELLS - 1);
});

Deno.test("a stale or hand-edited store reads as what is still a colour", () => {
	assertEquals(parseRecent(null), []);
	assertEquals(parseRecent("not json"), []);
	assertEquals(parseRecent('{"a":1}'), []);
	assertEquals(parseRecent(`["${RED}","red",4,"#FFF"]`), [RED]);
});

Deno.test("a swatch speaks its name, or that it is custom", () => {
	assertEquals(colorName(BLUE), "Blue");
	assertEquals(colorName(CUSTOM), "Custom colour #123456");
});
