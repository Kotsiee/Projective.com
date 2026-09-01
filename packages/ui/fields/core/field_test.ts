/**
 * The field vocabulary's class-name contract, and the one thing about it that fails silently.
 *
 * `fieldModifiers` is called with the SHARED block name (`"ui-field"`) by every select-shaped control,
 * so the open state lands on the root as `ui-field--open` — never as `ui-select--open` or
 * `ui-multiselect--open`, even though both roots also carry their own component block. Two stylesheets
 * had written the rotation rule against the component block. Both files parse, both class names read as
 * plausible, the type-checker sees neither, and the only symptom is a chevron that never turns.
 *
 * So the assertion below is deliberately a cross-check between the two SIDES of that contract: what the
 * helper emits, and what the sheets select on. A test that only exercised `fieldModifiers` would have
 * passed throughout the entire period the bug was live.
 */
import { assert, assertEquals } from "@std/assert";
import { fieldModifiers } from "./field.ts";

// #region The emitted modifier
Deno.test("fieldModifiers — `open` emits the modifier under the block it was GIVEN", () => {
	assert(fieldModifiers("ui-field", { open: true }).includes("ui-field--open"));
	assert(!fieldModifiers("ui-field", { open: true }).includes("ui-select--open"));
	assert(!fieldModifiers("ui-field", { open: false }).includes("ui-field--open"));
});
// #endregion

// #region The stylesheets that select on it
/** Every field stylesheet that rotates (or otherwise flips) an affordance when the panel opens. */
const OPEN_STATE_SHEETS = [
	{ sheet: "select.css", part: "ui-select__chevron" },
	{ sheet: "multiselect.css", part: "ui-multiselect__chevron" },
	{ sheet: "autocomplete.css", part: "ui-autocomplete__chevron" },
	{ sheet: "cascadeselect.css", part: "ui-cascadeselect__arrow" },
	{ sheet: "treeselect.css", part: "ui-treeselect__arrow" },
] as const;

const stylesDir = new URL("../styles/", import.meta.url);

/**
 * The sheet's RULES, with `/* … *\/` blocks removed.
 *
 * Necessary rather than fussy: the fix's own explanatory comment names the dead selector in order to
 * warn the next reader off it, and a naive substring search over the raw file therefore fails on the
 * very file that is now correct — a test that can only pass while the reasoning is undocumented.
 */
function rulesOf(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

for (const { sheet, part } of OPEN_STATE_SHEETS) {
	Deno.test(`${sheet} — the open-state rule keys off \`.ui-field--open\`, not the component block`, async () => {
		const css = rulesOf(await Deno.readTextFile(new URL(sheet, stylesDir)));

		assert(
			css.includes(`.ui-field--open .${part}`),
			`${sheet} must select the open state as \`.ui-field--open .${part}\` — that is the class the ` +
				`root actually carries, because \`fieldModifiers\` is called with the shared "ui-field" block.`,
		);

		// The component-block form is the exact mistake this guards: it reads correctly and matches
		// nothing. Assert its ABSENCE rather than merely the presence of the right rule, because a sheet
		// carrying both would still ship one dead selector for the next reader to trust.
		const componentBlock = part.split("__")[0];
		assertEquals(
			css.includes(`.${componentBlock}--open`),
			false,
			`${sheet} still contains \`.${componentBlock}--open\`, which no element is ever given.`,
		);
	});
}
// #endregion

// #region The click surface
/**
 * The chevron and the clear control are SIBLINGS of the trigger button, not its children — a nested
 * `<button>` is invalid HTML — so the trigger covers only the label track. Two things follow, and
 * BOTH are needed: the root has to delegate the click, and dismissal containment has to be measured
 * against the root too. With only the first, a press on the chevron while the panel was open counted
 * as an OUTSIDE click, closed it, and was then reopened by the delegated click — so the chevron could
 * open the menu and never close it, which is a worse control than the dead one it replaced.
 *
 * ⚠️ WHAT THESE TESTS CAN AND CANNOT PROVE. They read the SOURCE, because the behaviour needs a DOM
 * and `deno test` has none. So they pin that the two mechanisms are WIRED — they would still pass
 * against a handler whose body was empty. The dead zone itself, and the open/close cycle, were
 * verified by measurement in a browser and cannot be regression-tested here. Treat a green run as
 * "nobody removed the wiring", never as "the control works".
 */
const DELEGATING_ISLANDS = [
	{ island: "Select.tsx", guard: ".ui-select__trigger, .ui-select__clear" },
	{ island: "MultiSelect.tsx", guard: ".ui-multiselect__trigger, .ui-multiselect__clear" },
] as const;

/** The exact shape that makes the whole field, rather than its trigger, count as "inside". */
const CONTAINMENT = "triggerRef: rootRef,";

const islandsDir = new URL("../islands/", import.meta.url);

for (const { island, guard } of DELEGATING_ISLANDS) {
	Deno.test(`${island} — the field root delegates clicks that miss the trigger`, async () => {
		const src = await Deno.readTextFile(new URL(island, islandsDir));
		assert(
			src.includes("onClick={onSurfaceClick}"),
			`${island} must hand its ROOT an \`onSurfaceClick\` handler, or a click on the chevron reaches ` +
				`no handler at all: the chevron sits beside the trigger, not over it, so it cannot fall through.`,
		);
		assert(
			src.includes(CONTAINMENT),
			`${island} must give \`useDismiss\` the ROOT ref, not the trigger ref. With the trigger, a ` +
				`press on the chevron while the panel is open is read as an outside click — it closes, and ` +
				`the delegated click immediately reopens it, so the chevron can never close the menu.`,
		);
		assert(
			src.includes(`target?.closest("${guard}")`),
			`${island}'s delegation must skip \`${guard}\` so a control that already handled the click is ` +
				`not toggled a second time by the bubble.`,
		);
	});
}
// #endregion
