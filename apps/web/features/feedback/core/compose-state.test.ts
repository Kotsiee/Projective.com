import { assertEquals } from "@std/assert";
import {
	checkCompose,
	createComposeState,
	EMPTY_COMPOSE,
	FEEDBACK_PII_MESSAGE,
	piiHintFor,
	resetCompose,
} from "./compose-state.ts";

const GOOD = {
	title: "Pause a stage without cancelling it",
	category: "projects" as const,
	impact: "Our side is sometimes the blocker for a week.",
	body: "",
};

Deno.test("a complete form becomes the create body, trimmed, with no empty details", () => {
	const check = checkCompose({ ...GOOD, title: `  ${GOOD.title}  ` });
	assertEquals(check, {
		ok: true,
		input: { title: GOOD.title, category: "projects", impact: GOOD.impact },
	});
});

Deno.test("the empty form names every required field", () => {
	const check = checkCompose(EMPTY_COMPOSE);
	assertEquals(check.ok, false);
	if (!check.ok) assertEquals(Object.keys(check.errors).sort(), ["category", "impact", "title"]);
	if (!check.ok) assertEquals(check.errors.category, "Choose what your idea is about.");
});

Deno.test("a contact detail in any field is refused on that field, the server's own sentence", () => {
	const check = checkCompose({ ...GOOD, body: "Write to me at ada@example.com." });
	assertEquals(check, { ok: false, errors: { body: FEEDBACK_PII_MESSAGE } });
	assertEquals(piiHintFor("call 07700 900123"), FEEDBACK_PII_MESSAGE);
	assertEquals(piiHintFor("call me maybe"), undefined);
	assertEquals(piiHintFor(""), undefined);
});

Deno.test("reset empties the form and its outcome", () => {
	const state = createComposeState();
	state.values.value = { ...GOOD };
	state.errors.value = { title: "x" };
	state.formError.value = "Nope";
	resetCompose(state);
	assertEquals(state.values.value, EMPTY_COMPOSE);
	assertEquals([state.errors.value, state.formError.value, state.sent.value], [{}, null, null]);
});
