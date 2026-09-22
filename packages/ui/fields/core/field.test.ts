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
import { fieldModifiers, resolveFieldVerdict, statusMark } from "./field.ts";
import type { FieldStatus } from "../types/mod.ts";

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

// #region The validation state policy (§A.7.5)
/**
 * `resolveFieldVerdict` is the whole policy, deliberately extracted from the hook so it can be
 * exercised without a DOM. The rules it encodes are about WHEN a field is given a status, not about
 * what a status paints — the §A.7.3 state matrix is untouched — and each exists because the obvious
 * alternative fails in a way nobody notices: an empty field painted at rest announces itself as an
 * error before anybody has typed into it, and a field that stays red while it is being corrected has
 * stopped reporting anything.
 */
const PROBLEM = "A title is required.";

Deno.test("resolveFieldVerdict — an untouched field never paints, however wrong its value", () => {
	const v = resolveFieldVerdict({ problem: PROBLEM, touched: false, focused: false });
	assertEquals(v.status, "default");
	assertEquals(v.hintStatus, "default");
	assertEquals(v.message, null);
	assertEquals(v.revealed, false);
});

Deno.test("resolveFieldVerdict — the off-click is what earns the verdict", () => {
	const v = resolveFieldVerdict({ problem: PROBLEM, touched: true, focused: false });
	assertEquals(v.status, "invalid");
	assertEquals(v.hintStatus, "invalid");
	assertEquals(v.message, PROBLEM);
	assertEquals(v.revealed, true);
});

Deno.test("resolveFieldVerdict — focus clears the CONTROL's paint and keeps the explanation", () => {
	const v = resolveFieldVerdict({ problem: PROBLEM, touched: true, focused: true });
	assertEquals(
		v.status,
		"default",
		"the control's status channel drives the outline AND `aria-invalid`",
	);
	assertEquals(v.hintStatus, "invalid", "the message row keeps its status so the sentence stays");
	assertEquals(v.message, PROBLEM);
	assertEquals(v.revealed, true);
});

Deno.test("resolveFieldVerdict — a submit reveals a field nobody has touched", () => {
	const v = resolveFieldVerdict({ problem: PROBLEM, touched: false, focused: false, reveal: true });
	assertEquals(v.status, "invalid");
	assertEquals(v.message, PROBLEM);
	assertEquals(v.revealed, true);
});

Deno.test("resolveFieldVerdict — no status is ever an error while the field holds focus", () => {
	const statuses: FieldStatus[] = ["invalid", "required", "gate", "warning"];
	for (const problemStatus of statuses) {
		for (const touched of [false, true]) {
			for (const reveal of [false, true]) {
				const v = resolveFieldVerdict({
					problem: PROBLEM,
					touched,
					focused: true,
					reveal,
					problemStatus,
				});
				assertEquals(
					v.status,
					"default",
					`${problemStatus} painted the control while it was focused (touched=${touched}, ` +
						`reveal=${reveal}). A reveal defeats "untouched", never "focused".`,
				);
			}
		}
	}
});

Deno.test("resolveFieldVerdict — a clean field is silent unless a resolved status was asked for", () => {
	const quiet = resolveFieldVerdict({ problem: null, touched: true, focused: false });
	assertEquals(quiet.status, "default");
	assertEquals(quiet.message, null);

	const confirmed = resolveFieldVerdict({
		problem: null,
		touched: true,
		focused: false,
		resolvedStatus: "success",
	});
	assertEquals(confirmed.status, "success");
	assertEquals(confirmed.message, null);
});

Deno.test("resolveFieldVerdict — the painted status is the caller's, not a hard-coded `invalid`", () => {
	const gated = resolveFieldVerdict({
		problem: PROBLEM,
		touched: true,
		focused: false,
		problemStatus: "gate",
	});
	assertEquals(gated.status, "gate");
	assertEquals(gated.hintStatus, "gate");
});
// #endregion

// #region The stylesheet half of the same policy
/**
 * The hook can only govern a caller that uses it. A control handed `status="invalid"` directly — by
 * a server-side verdict, or by a form that pre-dates the hook — still has to stand its paint down on
 * focus, and that half lives in `field.css`. These read the sheet for the same reason the open-state
 * tests above do: both sides of a contract have to be checked, and neither side's own source can
 * prove the other one agrees.
 */
const VALIDATION_STATUSES = ["invalid", "success", "warning", "required", "gate"] as const;

/** The rest gate every colour channel is scoped by. Both halves, because focus arrives two ways. */
const REST_GATE = ":not(.ui-field--focused):not(:focus-within)";

/** Flat `selector { body }` pairs. Nested at-rules do not match, which is fine — none is a target. */
function rulesIn(css: string): { selector: string; body: string }[] {
	const out: { selector: string; body: string }[] = [];
	for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		out.push({ selector: match[1].trim(), body: match[2] });
	}
	return out;
}

const fieldRules = rulesIn(rulesOf(await Deno.readTextFile(new URL("field.css", stylesDir))));

for (const status of VALIDATION_STATUSES) {
	const mentions = (rule: { selector: string }) => rule.selector.includes(`.ui-field--${status}`);

	Deno.test(`field.css — \`${status}\` paints its colour channels only at REST`, () => {
		const painting = fieldRules.filter((r) => mentions(r) && r.body.includes("--field-border"));
		assert(painting.length > 0, `no rule gives \`.ui-field--${status}\` a border colour at all.`);
		for (const rule of painting) {
			assert(
				rule.selector.includes(REST_GATE),
				`\`${rule.selector}\` paints a border colour without \`${REST_GATE}\`, so a focused field ` +
					`would carry a coloured outline competing with its own focus indicator.`,
			);
		}
	});

	Deno.test(`field.css — \`${status}\` keeps its MARK through focus`, () => {
		const marking = fieldRules.filter((r) => mentions(r) && r.body.includes("--field-mark"));
		assert(
			marking.length > 0,
			`\`.ui-field--${status}\` sets no \`--field-mark\`, so the state would ride on hue alone (§A.5).`,
		);
		for (const rule of marking) {
			assertEquals(
				rule.selector.includes(REST_GATE),
				false,
				`\`${rule.selector}\` gates the mark on rest. The mark is the icon channel AND the only ` +
					`part of the state that survives focus — gating it removes both.`,
			);
		}
		assertEquals(
			statusMark(status) === null,
			false,
			`\`statusMark("${status}")\` returns null, so the slot the CSS just painted stays empty.`,
		);
	});

	Deno.test(`field.css — \`${status}\` opens the mark slot unconditionally`, () => {
		const opener = fieldRules.find((r) =>
			r.selector.includes(`.ui-field--${status} > .ui-field__mark`) &&
			r.body.includes("inline-size")
		);
		assert(
			opener !== undefined && !opener.selector.includes(REST_GATE),
			`the \`.ui-field--${status} > .ui-field__mark\` width rule must stay ungated, or the mark is ` +
				`painted while the slot holding it is still zero-width.`,
		);
	});
}

Deno.test("field.css — no validation status declares `box-shadow`, so the focus ring composes", () => {
	for (const rule of fieldRules) {
		const isStatusRule = VALIDATION_STATUSES.some((s) => rule.selector.includes(`.ui-field--${s}`));
		if (!isStatusRule) continue;
		assertEquals(
			rule.body.includes("box-shadow"),
			false,
			`\`${rule.selector}\` declares a \`box-shadow\`. The focus ring IS a \`box-shadow\`, so a ` +
				`status declaring one REPLACES the ring rather than composing with it — the exact shape ` +
				`that once left a focused invalid field in \`auth.css\` with no focus indicator at all.`,
		);
	}
});

Deno.test("field.css — the focus state still declares a ring of its own", () => {
	const focus = fieldRules.filter((r) =>
		r.selector.includes(".ui-field--focused") && r.body.includes("box-shadow")
	);
	assert(
		focus.length > 0,
		"nothing gives a focused field a `box-shadow`. Standing the status paint down on focus is only " +
			"safe while the focus treatment is there to take the outline over.",
	);
});
// #endregion

// #region The keyboard focus indicator
/**
 * Every form control spends the SAME focus token, and it is not `none`.
 *
 * The product draws no `--focus-ring-shadow` anywhere any more, so for a while these seven rules all
 * read `box-shadow: none` and a keyboard user had nothing but the hover tint to tell them where the
 * caret was. `--fld-focus-glow` is what replaced it, and the failure mode if one sheet drifts back is
 * exactly the one that is hardest to notice: six controls mark themselves and the seventh does not,
 * on a form where the seventh is the only one somebody tabs into blind.
 *
 * Each entry is (sheet, selector fragment). A rule renamed out from under this list fails loudly
 * rather than silently opting its control out.
 */
const FOCUS_INDICATOR_RULES: readonly [string, string][] = [
	["field.css", ".ui-field:has(:focus-visible)"],
	["switch.css", ".ui-switch__track:focus-visible"],
	["select.css", ".ui-select__filter-input:focus-visible"],
	["select-button.css", ".ui-select-button__option:focus-visible"],
	["checkbox.css", ".ui-checkbox__input:focus-visible"],
	["radio.css", ".ui-radio__input:focus-visible"],
];

for (const [sheet, fragment] of FOCUS_INDICATOR_RULES) {
	Deno.test(`${sheet} — \`${fragment}\` spends the focus glow`, async () => {
		const rules = rulesIn(rulesOf(await Deno.readTextFile(new URL(sheet, stylesDir))));
		const matching = rules.filter((r) => r.selector.includes(fragment));
		assert(matching.length > 0, `no rule in ${sheet} selects \`${fragment}\` any more.`);
		for (const rule of matching) {
			assert(
				rule.body.includes("var(--fld-focus-glow)"),
				`\`${rule.selector}\` in ${sheet} does not spend \`--fld-focus-glow\`. A control that ` +
					`draws no indicator is invisible to a keyboard user, and the type checker cannot see it.`,
			);
		}
	});
}

Deno.test("index.css — the focus glow is declared, and paints outside the control", () => {
	const tokens = Deno.readTextFileSync(new URL("../../styles/index.css", import.meta.url));
	const declared = tokens.match(/--fld-focus-glow:([^;]*);/);
	assert(declared, "\`--fld-focus-glow\` is not declared; every rule above resolves to nothing.");
	const value = declared[1];
	assert(
		value.includes("--primary"),
		"the glow no longer carries the accent, so there is nothing to distinguish it from a shadow.",
	);
	// An OUTER box-shadow is clipped to the outside of its border box, which is the whole reason a
	// glow is safe on a control with a solid fill — but an INSET one is not, and would wash the
	// label of a checked switch or a selected segment.
	assertEquals(
		value.includes("inset"),
		false,
		"an inset glow paints ON the control's own fill, over the label it is meant to be marking.",
	);
	// \`--focus-ring-halo\` is forced to \`transparent !important\` by the app's focus neutralisation,
	// so a layer composed from it paints nothing at all. This pins that the glow never depends on it.
	assertEquals(
		value.includes("--focus-ring-halo"),
		false,
		"the glow composes \`--focus-ring-halo\`, which the app forces to \`transparent !important\` — " +
			"that layer would silently paint nothing.",
	);
});

/**
 * The app's focus neutralisation must keep letting a FORM control draw its indicator.
 *
 * \`apps/web/styles/global.css\` removes every focus ring in the product with \`box-shadow: none
 * !important\` on a list of element types, and that list includes \`button\` and \`input\`. Four of the
 * controls above ARE their own focus target, so the rules in their own sheets were written, shipped
 * and completely inert — the glow rendered nowhere the blanket could reach, and no sheet-reading
 * test could see it, because each half was individually correct.
 *
 * This is the half that reads the OTHER file. It is deliberately in the package's test rather than
 * the app's: the package is what promises the indicator, so the package is what should fail when
 * something downstream quietly withdraws it.
 */
Deno.test("global.css — the focus neutralisation exempts the form controls", () => {
	const url = new URL("../../../../apps/web/styles/global.css", import.meta.url);
	const css = rulesOf(Deno.readTextFileSync(url));
	const restoring = rulesIn(css).filter((r) => r.body.includes("var(--fld-focus-glow)"));
	assert(
		restoring.length > 0,
		"nothing in global.css restores \`--fld-focus-glow\`, so every control whose focus target is a " +
			"<button> or an <input> draws no indicator at all.",
	);
	const selectors = restoring.map((r) => r.selector).join(" ");
	for (
		const control of [
			".ui-switch__track",
			".ui-select__filter-input",
			".ui-select-button__option",
		]
	) {
		assert(
			selectors.includes(control),
			`\`${control}\` is not exempted from the focus neutralisation, so its focus rule is inert.`,
		);
	}
	assert(
		restoring.every((r) => r.body.includes("!important")),
		"the restore does not carry \`!important\`, so it loses to the neutralisation it is answering.",
	);
});
// #endregion
