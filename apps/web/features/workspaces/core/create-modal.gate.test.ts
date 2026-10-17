/**
 * create-modal.gate — the create dialog's source-level merge gates (Teams work order R3), held as a
 * test because a type-checker cannot see them: no hand-rolled radio group, no native select or
 * button, no inline style, no timer in the island (the handle check debounces through
 * `@web/utils/debounce.ts`), every Button's tone taken from the tier model (`tierProps`), and the
 * claim rule imported from the SSOT rather than copied.
 *
 * The island imports CSS, so it is read as text, never imported.
 */
import { assert, assertEquals } from "@std/assert";

const FEATURE = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, FEATURE));

const ISLAND = read("islands/CreateWorkspaceModal.island.tsx");
const DRIVERS = [
	ISLAND,
	read("hooks/useHandleCheck.ts"),
	read("core/handle-check.ts"),
	read("core/create-model.ts"),
].join("\n");

Deno.test("create dialog: no raw role=radio, native select, raw button or inline style", () => {
	assert(!/role=["']radio/.test(ISLAND), "a hand-rolled radio — use SelectButton / RadioGroup");
	assert(!/<select\b/.test(ISLAND), "a native select");
	assert(!/<button\b/.test(ISLAND), "a raw <button> — use the ui Button on the matrix");
	assert(!/\bstyle=/.test(ISLAND), "an inline style");
});

Deno.test("create dialog: no timer anywhere in the island, its hook or its models", () => {
	assert(
		!/\bsetTimeout\s*\(/.test(DRIVERS),
		"setTimeout — debounce through @web/utils/debounce.ts",
	);
	assert(!/\bsetInterval\s*\(/.test(DRIVERS), "setInterval");
	assert(!/\buseEffect\s*\(/.test(ISLAND), "useEffect — focus is the Dialog's initialFocusRef");
	assert(ISLAND.includes("initialFocusRef={nameScope}"), "initial focus must land on the name");
});

Deno.test("create dialog: every Button takes its tone from the tier model; the fields are FormControls", () => {
	// The tier a create-model rule assigns is the tier on screen only if the island spells none itself
	// — create-model.test.ts then holds the one-filled-control rule over what is rendered.
	const buttons = ISLAND.split(/<Button\b/).slice(1).map((chunk) =>
		chunk.slice(0, chunk.indexOf("/>"))
	);
	assert(buttons.length >= 4, "cancel, create, the retry and the alternatives");
	for (const props of buttons) {
		assert(props.includes("{...tierProps("), `a Button with a hand-spelled tone:${props}`);
		assert(
			!/\b(variant|severity)=|^\s*structural\b/m.test(props),
			`a tone beside tierProps:${props}`,
		);
	}
	assertEquals(
		(ISLAND.match(/<FormControl\b/g) ?? []).length,
		3,
		"kind (choice only), name, handle",
	);
	assert(!/<label\b/.test(ISLAND), "a hand-rolled label — FormControl owns the label");
});

Deno.test("create dialog: the handle rule is the SSOT's, never a copied pattern or list", () => {
	assert(!/\[a-z0-9\]\[a-z0-9-\]\*/.test(DRIVERS), "a copy of the handle pattern");
	assert(!/"settings",\s*"services"|new Set\(\[/.test(DRIVERS), "a copy of the reserved list");
	assert(read("core/handle-check.ts").includes("localHandleRefusal"));
});
