/**
 * roster.gate — the `/teams` roster canvas's source-level merge gates (Teams work order R1), held as a
 * test because a type-checker cannot see them: no raw `<button>`, no `wsp-chip` on any roster
 * metadata, no inline style, no effect or timer in the island, the canvas's Buttons taking their tone
 * from the tier model, the head holding no Button, and the canvas built on the ui primitives the work
 * order names (TabMenu, MetaLine, ProgressBar, DataTable, EmptyState, InlineNotice).
 *
 * The island and its components import CSS, so they are read as text, never imported.
 */
import { assert, assertEquals } from "@std/assert";

const FEATURE = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, FEATURE));

const ISLAND = read("islands/WorkspaceRoster.island.tsx");
const CARD = read("components/WorkspaceCard.tsx");
const TABLE = read("components/WorkspaceTable.tsx");
const EMPTY = read("components/RosterEmpty.tsx");
const FILES: Record<string, string> = {
	"islands/WorkspaceRoster.island.tsx": ISLAND,
	"components/WorkspaceCard.tsx": CARD,
	"components/WorkspaceTable.tsx": TABLE,
	"components/RosterEmpty.tsx": EMPTY,
};
const SHEET = read("styles/workspace-roster.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `<Button … />` element's props in a source. */
function buttons(source: string): string[] {
	return source.split(/<Button\b/).slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("/>")));
}

Deno.test("roster gate: no raw <button>, no inline style, no wsp-chip in the canvas or its parts", () => {
	for (const [name, source] of Object.entries(FILES)) {
		assert(!/<button\b/.test(source), `${name}: a raw <button> — use the ui Button on the matrix`);
		assert(!/\bstyle=/.test(source), `${name}: an inline style`);
		assert(!/\bstyleVars\b/.test(source), `${name}: a feature-written style seam`);
		assert(!/wsp-chip/.test(source), `${name}: a chip on roster metadata — use MetaLine (§B.11)`);
	}
	assert(!/\.wsp-chip\b/.test(SHEET), "the roster sheet styles a chip");
});

Deno.test("roster gate: the island binds signals — no useEffect, no timer", () => {
	assert(!/\buseEffect\s*\(/.test(ISLAND), "useEffect — the island's effects are useSignalEffect");
	assert(!/\bsetTimeout\s*\(|\bsetInterval\s*\(/.test(ISLAND), "a timer in the island");
	assert(!/\buseState\s*\(/.test(ISLAND), "useState — signal-first");
	// The address follows the shared partition from a signal effect, through replaceState.
	assert(/useSignalEffect\(\(\) => \{\s*const location/.test(ISLAND), "the URL effect moved");
	assert(ISLAND.includes("history.replaceState("), "the address is replaced, never pushed");
	assert(!ISLAND.includes("pushState("), "a partition change is not a navigation");
});

Deno.test("roster gate: the head holds no Button; the canvas's Buttons take their tone from the model", () => {
	const head = ISLAND.slice(
		ISLAND.indexOf("{/* #region Head */}"),
		ISLAND.indexOf("{/* #endregion */}", ISLAND.indexOf("{/* #region Head */}")),
	);
	assert(head.length > 200, "the head region was not found");
	assertEquals(buttons(head).length, 0, "a Button in the page head — the create is the lane's");
	const canvasButtons = [...buttons(ISLAND), ...buttons(EMPTY)];
	assertEquals(canvasButtons.length, 3, "Try again, Create, Clear filters");
	for (const props of canvasButtons) {
		assert(props.includes("{...tierProps("), `a Button with a hand-spelled tone:${props}`);
		assert(
			!/\b(variant|severity)=|^\s*structural\b/m.test(props),
			`a tone beside tierProps:${props}`,
		);
	}
});

Deno.test("roster gate: the card's kebab is an icon-only tier-5 Button that stops its own press", () => {
	const [kebab, ...rest] = buttons(CARD);
	assertEquals(rest.length, 0, "the card draws one Button — its kebab");
	assert(
		/\biconOnly\b/.test(kebab) && /variant="text"/.test(kebab),
		"the kebab is tier 5, icon-only",
	);
	assert(/aria-label=\{label\}/.test(kebab), "the kebab is named");
	assert(/stopPropagation\(\)/.test(kebab), "the kebab's press stops at itself");
	// The whole card is ONE link.
	assertEquals((CARD.match(/<a\b/g) ?? []).length, 1, "one anchor per card");
});

Deno.test("roster gate: the canvas is built on the ui primitives R1 names", () => {
	assert(/<TabMenu\b/.test(ISLAND), "the partitions are a TabMenu");
	assert(/<MetaLine\b/.test(ISLAND) && /<MetaLine\b/.test(CARD), "facts are MetaLines");
	assert(/<InlineNotice\b/.test(ISLAND), "notices and failures are InlineNotices");
	assert(/<ProgressBar\b/.test(CARD), "the setup meter is the ui ProgressBar");
	assert(
		/<UserAvatarStack\b/.test(CARD) && /total=\{people\.total\}/.test(CARD),
		"the member faces are the ui AvatarStack, its +N counting the whole membership",
	);
	assert(/<Tag\b/.test(CARD) && /<Tag\b/.test(TABLE), "lifecycle is a Tag");
	assert(/lifecycleTag\(/.test(CARD) && /lifecycleTag\(/.test(TABLE), "…and only when not active");
	assert(
		/<DataTable\b/.test(TABLE) && /selectionMode="none"/.test(TABLE),
		"the table is DataTable",
	);
	assertEquals((EMPTY.match(/<EmptyState\b/g) ?? []).length, 2, "both empty states are EmptyState");
});

Deno.test("roster gate: a business's first-run points are a body list inside EmptyState (BU1)", () => {
	const firstRun = EMPTY.slice(
		EMPTY.indexOf("export function RosterFirstRun"),
		EMPTY.indexOf("// #endregion", EMPTY.indexOf("export function RosterFirstRun")),
	);
	assert(firstRun.length > 200, "RosterFirstRun was not found");
	// The list is EmptyState's body slot (its children), drawn only when the copy carries points.
	const open = firstRun.indexOf("<EmptyState");
	const list = firstRun.indexOf('<ul class="wsp-roster__points">');
	const close = firstRun.indexOf("</EmptyState>");
	assert(open >= 0 && list > open && close > list, "the points are not inside EmptyState");
	assert(/points\.length > 0 &&/.test(firstRun), "the list renders without points");
	assert(/copy\.points \?\? \[\]/.test(firstRun), "the points are not read from the copy");
	// Body text: no MetaLine, no chip, no Tag, no second Button.
	assert(!/<MetaLine\b|<Tag\b|<Badge\b/.test(firstRun), "the points borrow a container");
	assertEquals(buttons(firstRun).length, 1, "the first run draws one Button — its create");
	assert(
		/\.wsp-roster__point-mark\s*\{[^}]*color:\s*var\(--wsp-kind-ink\)/.test(SHEET),
		"the point's tick is not the kind's ink",
	);
});

Deno.test("roster gate: the table draws the kind's columns and Spent as MoneyView, no delta (BU1)", () => {
	assert(
		/<WorkspaceTable\s+kind=\{props\.kind\}/.test(ISLAND),
		"the island does not pass the kind",
	);
	assert(/rosterColumns\(kind\)\.map\(columnFor\)/.test(TABLE), "the table ignores the kind");
	assert(!/ROSTER_COLUMNS\b/.test(TABLE), "the table hard-codes the team's columns");
	const spent = TABLE.slice(
		TABLE.indexOf("function SpentCell"),
		TABLE.indexOf("\n}", TABLE.indexOf("function SpentCell")),
	);
	assert(spent.length > 100, "SpentCell was not found");
	assert(/<MoneyView\b/.test(spent), "Spent is not MoneyView");
	// Each figure pinned to its own currency: no conversion into the viewer's.
	const views = spent.split(/<MoneyView\b/).slice(1);
	assert(views.length >= 2, "one figure and several are not both drawn");
	for (const view of views) {
		assert(/displayCurrency=\{figure\.currency\}/.test(view), `a figure converts:${view}`);
	}
	assert(/ui-meta-line__sep/.test(spent), "several currencies are not one meta line");
	assert(!/delta|sign=|tone=/.test(spent), "Spent carries a delta or a direction");
});

Deno.test("roster gate: the setup meter fills with the kind token, never a fixed severity", () => {
	const meter = CARD.slice(
		CARD.indexOf("<ProgressBar"),
		CARD.indexOf("/>", CARD.indexOf("<ProgressBar")),
	);
	assert(meter.length > 0, "the setup meter was not found");
	// A fixed severity paints a business card's meter in a hue the colour-vision overlays never move.
	assert(!/\bseverity=/.test(meter), `the meter picks a severity:${meter}`);
	assert(
		/\.ui-progressbar\.wsp-card__setup-bar\s*\{[^}]*--pb-accent:\s*var\(--wsp-kind\)/.test(SHEET),
		"the meter's accent is not the kind token",
	);
});
