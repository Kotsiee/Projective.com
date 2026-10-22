/**
 * members-screen.gate — the Members module's source-level merge gates (Teams work order C2), held as a
 * test because a type-checker cannot see them: no native `<select>` or checkbox, no `wsp-select`, no
 * hand-rolled radio, label or button, no capability or override chip, no inline style; every field a
 * `FormControl`; every dialog and drawer button's tone taken from the tier model (`membersTierProps`);
 * the invite dialog's handle lookup the shared `useHandleCheck`, never a copy.
 *
 * The islands import CSS, so they are read as text, never imported.
 */
import { assert, assertEquals } from "@std/assert";
import {
	capabilitiesForKind,
	CAPABILITY_LABEL,
	kindCopy,
	roleLabel,
	rolesForKind,
	WorkspaceCapability,
} from "@projective/types/workspace";
import {
	drawerTerminal,
	managerCapNotice,
	managersItem,
	reservedGrantWarning,
	sensitiveWarning,
	TITLE_EXAMPLE,
	transferConsequences,
} from "./members-model.ts";
import {
	baseOptions,
	BLANK_START,
	managerCapLine,
	roleEditorIntro,
	rolesScreenCopy,
	seedNote,
	startPoints,
} from "./roles-model.ts";
import { templatesForKind } from "./role-templates.ts";

const FEATURE = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, FEATURE));

const FILES: Record<string, string> = Object.fromEntries(
	[
		"islands/MembersScreen.island.tsx",
		"islands/MemberInspector.island.tsx",
		"components/MemberEditForm.tsx",
		"components/MemberDetailPanel.tsx",
		"components/OrgChartNode.tsx",
		"islands/InviteModal.island.tsx",
		"components/MemberCard.tsx",
		"components/MemberTable.tsx",
		"components/InviteQueue.tsx",
		"components/OwnershipTransfer.tsx",
		"components/OrgChart.tsx",
		"components/ManagerCapNotice.tsx",
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
	assertEquals(
		offenders(/<button\b/),
		[],
		"a raw <button> — use the ui Button (it owns the press)",
	);
	assert(
		!/\.wsp-select\b/.test(read("styles/workspace-people.css")),
		"the Members stylesheet styles a wsp-select — its last user's rules belong to its own sheet",
	);
});

Deno.test("members: facts are MetaLines — no capability or override chips, no inline style", () => {
	assertEquals(offenders(/wsp-capchip|wsp-override\b|wsp-override__/), [], "a chip for metadata");
	assertEquals(offenders(/\bstyle=/), [], "an inline style — the ui component owns its style seam");
	assertEquals(offenders(/styleVars\(/), [], "styleVars in feature code");
});

Deno.test("members: every field of the drawer and the dialogs is a FormControl", () => {
	const count = (rel: string) => (FILES[rel].match(/<FormControl\b/g) ?? []).length;
	// The fourth is BU7's typed CONFIRM for an owner-reserved grant (Decision #238 (b), #249 (k)).
	assertEquals(count("components/MemberEditForm.tsx"), 4, "role, title, reports to, confirm");
	assertEquals(count("components/OwnershipTransfer.tsx"), 2, "successor, leave");
	assert(FILES["components/OwnershipTransfer.tsx"].includes("<Checkbox"));
	assert(FILES["components/MemberEditForm.tsx"].includes("<ToggleSwitch"));
});

Deno.test("members: the dialogs' and inspector's buttons take their tone from the tier model", () => {
	for (
		const rel of [
			"components/OwnershipTransfer.tsx",
			"islands/MemberInspector.island.tsx",
			"components/MemberEditForm.tsx",
			"components/MemberDetailPanel.tsx",
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

Deno.test("members: the inspector docks in the panel, its quick actions tier 4, nothing boxed (#322)", () => {
	const dossier = FILES["components/MemberDetailPanel.tsx"];
	assertEquals((dossier.match(/membersTierProps\(4\)/g) ?? []).length, 2, "Message, Edit member");
	assert(!/<Card\b|ui-card|wsp-[a-z-]*(chip|pill|tag)\b/.test(dossier), "a box or pill in the panel");
	const inspector = FILES["islands/MemberInspector.island.tsx"];
	assert(inspector.includes("CONTEXT_PANEL_INFLOW_QUERY"), "docks from the shell's 1280px query");
	assert(inspector.includes("<Drawer"), "a slide-over below it");
	assert(inspector.includes('position="right"'));
	const node = FILES["components/OrgChartNode.tsx"];
	assert(node.includes("<foreignObject"), "the node's body is HTML over the SVG box");
	assert(node.includes("size={36}"), "a 36px avatar");
	assert(!FILES["islands/MembersScreen.island.tsx"].includes("MemberDrawer"), "the drawer is gone");
});

Deno.test("members: Invite is the Universal Invite modal — one field, no tabs, the model's roles (#318)", () => {
	const invite = FILES["islands/InviteModal.island.tsx"];
	assert(invite.includes("<UniversalInviteModal"), "the shared modal");
	assert(invite.includes("<InviteLinkPanel"), "the ask-to-join link");
	assert(!invite.includes("<SelectButton"), "the By handle / By email tabs are gone");
	assert(invite.includes("grantableRoles("), "the role list mirrors the server");
	assert(invite.includes("inviteManagerOverflow("), "the batch honours the manager cap");
	assert(!/location\.(assign|href)|\?invite=1/.test(invite), "inviting never navigates");
});

Deno.test("members: the native sort select is gone; the table sorts by its own header", () => {
	const screen = FILES["islands/MembersScreen.island.tsx"];
	assert(!screen.includes("MEMBER_SORTS"), "the sort select's options");
	assert(FILES["components/MemberTable.tsx"].includes("<DataTable"), "People is the DataTable");
	assert(screen.includes("<UserAvatarStack"), "the head's avatar stack");
});

// #region No "lead" in a business console (BU7)
const LEAD = /\blead\b/i;

/**
 * Every sentence the Members and Roles models give a BUSINESS console — the role editor's starting
 * points and ranks, the templates, the matrix rows, hints, locks and legend, the drawer's warnings,
 * Title example, terminal acts and envelope words, the transfer's disclosure, the manager headroom and
 * cap. A business has no Lead preset (BUSINESSES_AUDIT BF11), so not one of them may say "lead".
 */
function businessCopy(): string[] {
	const kind = "business" as const;
	const caps = capabilitiesForKind(kind);
	const all = WorkspaceCapability.options;
	const policy = { kind, payout: null, spend: null, canPropose: true } as const;
	const abilities = { edit: true, remove: true, leave: true, transfer: true, message: true };
	const hannah = { name: "Hannah Cole" };
	const coOwner = ["withdraw_funds", "manage_billing", "archive_entity"] as const;
	const out: string[] = [
		...Object.values(kindCopy(kind)).filter((v): v is string => typeof v === "string"),
		...startPoints(kind, []).flatMap((p) => [p.label, p.description, p.name, p.summary]),
		...baseOptions(kind, 4).map(roleLabel),
		...rolesForKind(kind).map(roleLabel),
		...templatesForKind(kind).flatMap((t) => [t.name, t.summary]),
		...rolesScreenCopy(kind, policy),
		managerCapLine("Buyers", 2, { text: "" }),
		roleEditorIntro("create", kind, []),
		roleEditorIntro("create", kind, ["view_analytics"]),
		seedNote(["manage_roles", "withdraw_funds"], kind) ?? "",
		...caps.map((c) => CAPABILITY_LABEL[c]),
		...all.map((c) => sensitiveWarning(c, kind) ?? ""),
		TITLE_EXAMPLE[kind],
		...transferConsequences(kind, "Hannah Cole", false),
		...transferConsequences(kind, null, true),
		...[
			drawerTerminal(abilities, hannah, kind),
			drawerTerminal({ ...abilities, transfer: false }, hannah, kind),
			drawerTerminal({ ...abilities, transfer: false, leave: false }, hannah, kind),
		].flatMap((t) => t ? [t.label, t.note] : []),
		managersItem({ used: 1, limit: 2 })?.text ?? "",
		managersItem({ used: 1, limit: 2 })?.title ?? "",
		...[true, false].flatMap((owner) => {
			const n = managerCapNotice({ business: "Helia Finance", limit: 2, viewerIsOwner: owner });
			return [n.sentence, n.meta];
		}),
		reservedGrantWarning("Hannah Cole", ["manage_billing"], false) ?? "",
		reservedGrantWarning("Hannah Cole", coOwner, true) ?? "",
	];
	return out.filter((s) => s !== "");
}

Deno.test("members and roles: a business console's copy never says lead (BU7)", () => {
	const copy = businessCopy();
	assert(copy.length > 80, `the sweep reads the whole business copy (${copy.length} strings)`);
	assertEquals(copy.filter((s) => LEAD.test(s)), [], "a business has no Lead preset");
	// The sweep would catch it: a team's copy does say lead.
	assert(LEAD.test(TITLE_EXAMPLE.team) && LEAD.test(roleLabel("lead")));
	assert(!startPoints("business", []).some((p) => p.key === BLANK_START && LEAD.test(p.label)));
});

Deno.test("members: the availability dot is a team's alone — a business is buyer-side (BU7)", () => {
	// The card is the project roster's shell (Decision #319): availability is its presence dot, and
	// both the dot and its words are given only on a team's card.
	const card = FILES["components/MemberCard.tsx"];
	assert(card.includes('const team = kind === "team";'), "the card names its team branch");
	assert(
		/presence=\{team \? AVAILABILITY_TONE\[member\.availability\] : undefined\}/.test(card),
		"the availability dot is drawn for a business",
	);
	assert(/presenceLabel=\{team \?/.test(card), "the dot's words are given for a business");
	assertEquals(card.match(/presence=\{/g)?.length, 1, "one availability dot");
});

Deno.test("members: the drawer's Title example is the kind's, never a literal", () => {
	const drawer = FILES["components/MemberEditForm.tsx"];
	assert(drawer.includes("placeholder={TITLE_EXAMPLE[ws.kind]}"), "the Title example by kind");
	assert(!/placeholder="[^"]*\blead\b/i.test(drawer), "a hard-coded lead placeholder");
});
// #endregion
