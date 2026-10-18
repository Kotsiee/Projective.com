/**
 * members-screen.gate — the Members module's source-level merge gates (Teams work order C2), held as a
 * test because a type-checker cannot see them: no native `<select>` or checkbox, no `wsp-select`, no
 * hand-rolled radio or label, no capability or override chip, no inline style; every field a
 * `FormControl`; every dialog and drawer button's tone taken from the tier model (`membersTierProps`);
 * the invite dialog's handle lookup the shared `useHandleCheck`, never a copy.
 *
 * The islands import CSS, so they are read as text, never imported.
 */
import { assert, assertEquals } from "@std/assert";

const FEATURE = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, FEATURE));

const FILES: Record<string, string> = Object.fromEntries(
	[
		"islands/MembersScreen.island.tsx",
		"islands/MemberDrawer.island.tsx",
		"islands/InviteModal.island.tsx",
		"components/MemberCard.tsx",
		"components/MemberTable.tsx",
		"components/InviteQueue.tsx",
		"components/OwnershipTransfer.tsx",
		"components/OrgChart.tsx",
	].map((rel) => [rel, read(rel)]),
);

/** Every C2 file that offends `pattern`, by name. */
function offenders(pattern: RegExp): string[] {
	return Object.entries(FILES).filter(([, src]) => pattern.test(src)).map(([name]) => name);
}

Deno.test("members: no native select, checkbox or radio, no wsp-select, no hand-rolled label", () => {
	assertEquals(offenders(/<select\b/), [], "a native <select> — use the ui Select");
	assertEquals(offenders(/type=["']checkbox/), [], "a native checkbox — use the ui Checkbox");
	assertEquals(offenders(/<input\b/), [], "a raw <input> — use a ui field");
	assertEquals(offenders(/\bwsp-select\b/), [], "the wsp-select class");
	assertEquals(
		offenders(/role=["']radio/),
		[],
		"a hand-rolled radio — use SelectButton / RadioGroup",
	);
	assertEquals(offenders(/<label\b/), [], "a hand-rolled label — FormControl owns the label");
});

Deno.test("members: facts are MetaLines — no capability or override chips, no inline style", () => {
	assertEquals(offenders(/wsp-capchip|wsp-override\b|wsp-override__/), [], "a chip for metadata");
	assertEquals(offenders(/\bstyle=/), [], "an inline style — the ui component owns its style seam");
	assertEquals(offenders(/styleVars\(/), [], "styleVars in feature code");
});

Deno.test("members: every field of the drawer and the dialogs is a FormControl", () => {
	const count = (rel: string) => (FILES[rel].match(/<FormControl\b/g) ?? []).length;
	assertEquals(count("islands/InviteModal.island.tsx"), 5, "mode, handle, email, role, note");
	assertEquals(count("islands/MemberDrawer.island.tsx"), 3, "role, title, reports to");
	assertEquals(count("components/OwnershipTransfer.tsx"), 2, "successor, leave");
	assert(FILES["islands/InviteModal.island.tsx"].includes("<SelectButton"));
	assert(FILES["islands/InviteModal.island.tsx"].includes("<Textarea"));
	assert(FILES["components/OwnershipTransfer.tsx"].includes("<Checkbox"));
	assert(FILES["islands/MemberDrawer.island.tsx"].includes("<ToggleSwitch"));
});

Deno.test("members: the dialogs' and drawer's buttons take their tone from the tier model", () => {
	for (
		const rel of [
			"islands/InviteModal.island.tsx",
			"components/OwnershipTransfer.tsx",
			"islands/MemberDrawer.island.tsx",
		]
	) {
		const buttons = FILES[rel].split(/<Button\b/).slice(1).map((chunk) =>
			chunk.slice(0, chunk.indexOf("/>"))
		);
		assert(buttons.length >= 1, `${rel}: no Button`);
		for (const props of buttons) {
			assert(props.includes("{...membersTierProps("), `${rel}: a hand-spelled tone:${props}`);
			assert(!/\b(variant|severity)=/.test(props), `${rel}: a tone beside the tier model:${props}`);
		}
	}
});

Deno.test("members: the invite lookup is the shared handle check, and the role list the model's", () => {
	const invite = FILES["islands/InviteModal.island.tsx"];
	assert(invite.includes('from "../hooks/useHandleCheck.ts"'), "the R3 hook");
	assert(invite.includes("grantableRoles("), "the role list mirrors the server");
	assert(!/\bsetTimeout\s*\(/.test(invite), "a timer — the hook debounces");
});

Deno.test("members: the native sort select is gone; the table sorts by its own header", () => {
	const screen = FILES["islands/MembersScreen.island.tsx"];
	assert(!screen.includes("MEMBER_SORTS"), "the sort select's options");
	assert(FILES["components/MemberTable.tsx"].includes("<DataTable"), "People is the DataTable");
	assert(screen.includes("<UserAvatarStack"), "the head's avatar stack");
});
