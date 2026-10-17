import { assert, assertEquals } from "@std/assert";
import {
	CreateWorkspaceInputSchema,
	TEAM_PERSONA_REFUSAL,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { PAYOUT_NOT_READY_REFUSAL, PAYOUT_SETUP_HREF } from "@projective/types/finance";
import { type HandleCheckState, INITIAL_HANDLE_CHECK } from "./handle-check.ts";
import {
	classifyCreateRefusal,
	CREATE_FAILED,
	createCopy,
	createDialogActions,
	createFooterActions,
	type CreateGateInput,
	createGateOpen,
	createKindMode,
	handleFromName,
	isFilled,
	KIND_CHOICES,
	nameProblem,
	normalizeHandleInput,
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
Deno.test("actions: exactly ONE filled control in every state, and it is the tier-2 create", () => {
	const kinds: WorkspaceKind[] = ["team", "business"];
	const states: CreateGateInput[] = [
		gate(),
		gate({ name: "" }),
		gate({ handle: at("checking") }),
		gate({ handle: at("taken") }),
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
				}
			}
		}
	}
});

Deno.test("footer: Cancel is tier 5 and always live; the commit is gated and says when it is working", () => {
	const [cancel, create] = createFooterActions("team", "fixed", gate({ handle: at("checking") }));
	assertEquals([cancel.label, cancel.tier, cancel.disabled], ["Cancel", 5, false]);
	assertEquals([create.label, create.tier, create.disabled], ["Create team", 2, true]);
	const busy = createFooterActions("business", "fixed", gate({ submitting: true }))[1];
	assertEquals([busy.label, busy.disabled], ["Creating…", true]);
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
