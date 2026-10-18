import { assert, assertEquals } from "@std/assert";
import {
	CreateWorkspaceInputSchema,
	HANDLE_REFUSALS,
	TEAM_PERSONA_REFUSAL,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { PAYOUT_NOT_READY_REFUSAL, PAYOUT_SETUP_HREF } from "@projective/types/finance";
import {
	HANDLE_CHECK_FAILED,
	type HandleCheckState,
	INITIAL_HANDLE_CHECK,
} from "./handle-check.ts";
import {
	classifyCreateRefusal,
	CREATE_FAILED,
	createCopy,
	createDialogActions,
	createFooterActions,
	type CreateGateInput,
	createGateOpen,
	createKindMode,
	HANDLE_CHECKING,
	type HandleFieldPhase,
	handleFromName,
	handleLiveLine,
	isFilled,
	isPlainEnter,
	KIND_CHOICES,
	liveLineExplains,
	nameProblem,
	normalizeHandleInput,
	recheckAction,
	tierProps,
	visibleSuggestions,
} from "./create-model.ts";

// #region Fixtures
const at = (status: HandleCheckState["status"], handle = "northern-grid"): HandleCheckState => ({
	...INITIAL_HANDLE_CHECK,
	status,
	handle,
	seq: 1,
});

const gate = (over: Partial<CreateGateInput> = {}): CreateGateInput => ({
	name: "Northern Grid",
	handle: at("available"),
	submitting: false,
	...over,
});

/** A probe the namespace could not answer. */
const failedProbe: HandleCheckState = {
	...at("idle"),
	reason: HANDLE_CHECK_FAILED,
	failed: true,
};

/** A taken handle, with the free alternatives the namespace offered. */
const takenWithAlternatives: HandleCheckState = {
	...at("taken"),
	reason: HANDLE_REFUSALS.taken,
	suggestions: ["northern-grid-hq", "northern-grid-co", "northern-grid-2"],
};

const phase = (over: Partial<HandleFieldPhase> = {}): HandleFieldPhase => ({
	nameLeft: false,
	handleEdited: false,
	handleRevealed: false,
	...over,
});
// #endregion

// #region Kind
Deno.test("kind: a committed route fixes it; only a neutral surface (or a forced prop) asks", () => {
	assertEquals(createKindMode("team"), "fixed");
	assertEquals(createKindMode("business"), "fixed");
	assertEquals(createKindMode(undefined), "choice");
	assertEquals(createKindMode("team", true), "choice");
	assertEquals(createKindMode(undefined, false), "fixed");
	assertEquals(KIND_CHOICES.map((c) => c.value), ["team", "business"]);
});

Deno.test("copy: the title and the commit name the kind; a neutral title names both", () => {
	assertEquals(createCopy("team", "fixed").header, "Create a team");
	assertEquals(createCopy("team", "fixed").submit, "Create team");
	assertEquals(createCopy("business", "fixed").submit, "Create business");
	assertEquals(createCopy("business", "choice").header, "Create a team or business");
	assert(createCopy("team", "fixed").intro.includes("draft"));
});
// #endregion

// #region Fields
Deno.test("name: required, 2–80 characters after trimming — the database's bounds", () => {
	assertEquals(nameProblem(""), "Give it a name.");
	assertEquals(nameProblem("   "), "Give it a name.");
	assertEquals(nameProblem(" a "), "Names are at least 2 characters.");
	assertEquals(nameProblem("ab"), null);
	assertEquals(nameProblem("a".repeat(80)), null);
	assertEquals(nameProblem("a".repeat(81)), "Names are 80 characters or fewer.");
	for (const name of ["ab", "a".repeat(80)]) {
		assert(
			CreateWorkspaceInputSchema.safeParse({ kind: "team", name, handle: "grid" }).success,
			"what the field accepts, the schema accepts",
		);
	}
});

Deno.test("handle input: lower-cased, a typed @ dropped, spaces hyphenated — nothing silently eaten", () => {
	assertEquals(normalizeHandleInput("Northern"), "northern");
	assertEquals(normalizeHandleInput("@@Grid"), "grid");
	assertEquals(normalizeHandleInput("north grid"), "north-grid");
	assertEquals(normalizeHandleInput("grid_co"), "grid_co", "the claim rule explains it instead");
});

Deno.test("handle from name: accents folded, runs hyphenated, ends trimmed, capped at 40", () => {
	assertEquals(handleFromName("Northern Grid Collective"), "northern-grid-collective");
	assertEquals(handleFromName("  Café Ünïon & Co. "), "cafe-union-co");
	assertEquals(handleFromName("—"), "");
	const long = handleFromName(`${"word ".repeat(12)}end`);
	assert(long.length <= 40 && !long.endsWith("-"), long);
});
// #endregion

// #region The gate
Deno.test("gate: open only for a valid name + an AVAILABLE handle + nothing in flight", () => {
	assert(createGateOpen(gate()));
	assert(!createGateOpen(gate({ name: "a" })), "short name");
	assert(!createGateOpen(gate({ submitting: true })), "in flight");
	for (const status of ["idle", "checking", "taken", "reserved", "invalid"] as const) {
		assert(!createGateOpen(gate({ handle: at(status) })), status);
	}
});
// #endregion

// #region One filled control
Deno.test("tiers: each renders the ui's tone for it — 2 structural, 4 neutral outlined, 5 text", () => {
	assertEquals(tierProps(2), { structural: true });
	assertEquals(tierProps(4), { severity: "neutral", variant: "outlined" });
	assertEquals(tierProps(5), { variant: "text" });
	assertEquals([isFilled(2), isFilled(4), isFilled(5)], [true, false, false]);
});

Deno.test("actions: exactly ONE filled control in every state, and it is the tier-2 create", () => {
	const kinds: WorkspaceKind[] = ["team", "business"];
	const states: CreateGateInput[] = [
		gate(),
		gate({ name: "" }),
		gate({ handle: at("checking") }),
		gate({ handle: at("taken") }),
		gate({ handle: failedProbe }),
		gate({ submitting: true }),
	];
	for (const kind of kinds) {
		for (const mode of ["fixed", "choice"] as const) {
			for (const state of states) {
				for (const suggestions of [[], ["grid-hq", "grid-co", "grid-2"]]) {
					const actions = createDialogActions(kind, mode, state, suggestions);
					const filled = actions.filter((a) => isFilled(a.tier));
					assertEquals(filled.length, 1, `${kind}/${mode}`);
					assertEquals([filled[0].key, filled[0].tier], ["create", 2]);
					assert(
						actions.filter((a) => a.key.startsWith("suggest:")).every((a) => a.tier === 5),
						"suggestions are text buttons",
					);
					assertEquals(
						actions.filter((a) => a.key === "recheck").map((a) => a.tier),
						state.handle.failed ? [4] : [],
						"the retry is a tier-4 utility, present only after an unanswered probe",
					);
				}
			}
		}
	}
});

Deno.test("retry: 'Check again' only after an unanswered probe, as a tier-4 utility", () => {
	assertEquals(recheckAction(at("taken")), null);
	assertEquals(recheckAction(INITIAL_HANDLE_CHECK), null);
	assertEquals(recheckAction(failedProbe), {
		key: "recheck",
		label: "Check again",
		tier: 4,
		disabled: false,
	});
});

Deno.test("footer: Cancel is tier 5 and always live; the commit is gated and says when it is working", () => {
	const [cancel, create] = createFooterActions("team", "fixed", gate({ handle: at("checking") }));
	assertEquals([cancel.label, cancel.tier, cancel.disabled], ["Cancel", 5, false]);
	assertEquals([create.label, create.tier, create.disabled], ["Create team", 2, true]);
	const busy = createFooterActions("business", "fixed", gate({ submitting: true }))[1];
	assertEquals([busy.label, busy.disabled], ["Creating…", true]);
});
// #endregion

// #region The handle's live line
Deno.test("live line: one fixed sentence while checking, whatever the handle — typing is not news", () => {
	const lines = ["n", "no", "northern", "northern-grid"].map((h) =>
		handleLiveLine(at("checking", h), phase())
	);
	for (const line of lines) assertEquals(line, { tone: "checking", text: HANDLE_CHECKING });
	assert(!HANDLE_CHECKING.includes("@"), "the pending line never echoes the handle");
});

Deno.test("live line: a verdict names the handle; an unanswered probe says so", () => {
	assertEquals(handleLiveLine(at("available"), phase()), {
		tone: "available",
		text: "@northern-grid is available",
	});
	assertEquals(handleLiveLine(failedProbe, phase()), { tone: "failed", text: HANDLE_CHECK_FAILED });
	assertEquals(handleLiveLine(INITIAL_HANDLE_CHECK, phase()), null);
});

Deno.test("live line: a refused MIRRORED handle is explained there once the name is left — never earlier", () => {
	const refused: HandleCheckState[] = [
		takenWithAlternatives,
		{ ...at("reserved", "settings"), reason: HANDLE_REFUSALS.reserved },
		{ ...at("invalid", "ab"), reason: HANDLE_REFUSALS.short },
	];
	for (const state of refused) {
		assertEquals(handleLiveLine(state, phase()), null, `${state.status}: still typing the name`);
		assertEquals(
			handleLiveLine(state, phase({ nameLeft: true })),
			{ tone: "refused", text: state.reason },
			`${state.status}: the name was left`,
		);
		assertEquals(
			handleLiveLine(state, phase({ nameLeft: true, handleRevealed: true })),
			null,
			`${state.status}: the field's own error row has taken over`,
		);
		assertEquals(
			handleLiveLine(state, phase({ nameLeft: true, handleEdited: true })),
			null,
			`${state.status}: the reader is typing their own handle`,
		);
	}
	assert(liveLineExplains(phase({ nameLeft: true })));
	assert(!liveLineExplains(phase({ nameLeft: true, handleRevealed: true })));
});

Deno.test("suggestions: shown once the live line or the field explains the taken handle", () => {
	assertEquals(visibleSuggestions(takenWithAlternatives, phase()), []);
	assertEquals(
		visibleSuggestions(takenWithAlternatives, phase({ nameLeft: true })),
		takenWithAlternatives.suggestions,
	);
	assertEquals(
		visibleSuggestions(takenWithAlternatives, phase({ handleEdited: true, handleRevealed: true })),
		takenWithAlternatives.suggestions,
	);
	assertEquals(
		visibleSuggestions(takenWithAlternatives, phase({ nameLeft: true, handleEdited: true })),
		[],
		"a handle being typed waits for its own field's blur",
	);
	assertEquals(visibleSuggestions(at("available"), phase({ handleRevealed: true })), []);
});
// #endregion

// #region Keys
Deno.test("Enter: only a plain, settled Enter walks the name forward", () => {
	const key = (over: Partial<Parameters<typeof isPlainEnter>[0]> = {}) => ({
		key: "Enter",
		isComposing: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		...over,
	});
	assert(isPlainEnter(key()));
	assert(!isPlainEnter(key({ key: "Tab" })));
	assert(!isPlainEnter(key({ isComposing: true })), "an IME confirming a composition");
	for (const mod of ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const) {
		assert(!isPlainEnter(key({ [mod]: true })), mod);
	}
});
// #endregion

// #region Refusals
Deno.test("refusals: routed by their typed details, never by their sentence", () => {
	assertEquals(
		classifyCreateRefusal({
			message: TEAM_PERSONA_REFUSAL,
			details: { reason: "persona", actor: "self", persona: "client" },
		}),
		{ reason: "persona", message: TEAM_PERSONA_REFUSAL },
	);
	const payout = classifyCreateRefusal({
		message: PAYOUT_NOT_READY_REFUSAL,
		details: { reason: "payout_not_ready", actor: "self", href: PAYOUT_SETUP_HREF, members: null },
	});
	assertEquals(payout.reason, "payout");
	assertEquals(payout.reason === "payout" && payout.details.href, PAYOUT_SETUP_HREF);
	assertEquals(
		classifyCreateRefusal({
			message: "Your plan includes 3 teams — archive one or upgrade to create another.",
			details: { reason: "entitlement", entitlement: "teams_owned" },
		}),
		{
			reason: "entitlement",
			message: "Your plan includes 3 teams — archive one or upgrade to create another.",
			entitlement: "teams_owned",
		},
	);
	assertEquals(
		classifyCreateRefusal({
			message: "That handle was claimed a moment ago — pick another.",
			errors: { handle: "That handle was claimed a moment ago — pick another." },
		}).reason,
		"handle",
	);
	assertEquals(
		classifyCreateRefusal({
			message: "Check the highlighted fields.",
			errors: { name: "Too long." },
		}),
		{ reason: "other", message: "Too long." },
	);
	assertEquals(classifyCreateRefusal({}), { reason: "other", message: CREATE_FAILED });
});
// #endregion
