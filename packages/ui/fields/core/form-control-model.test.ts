import { assertEquals } from "@std/assert";
import { formControlRows } from "./form-control-model.ts";

Deno.test("a labelled hint goes behind the ? and still describes the control", () => {
	const rows = formControlRows({ rootId: "f", label: "Email", hint: "We reply here." });
	assertEquals(rows.behindHint, true);
	assertEquals(rows.row, null);
	assertEquals(rows.describedBy, "f-about");
});

Deno.test("inline, and without a label, the hint is the visible row", () => {
	const inline = formControlRows({
		rootId: "f",
		label: "Email",
		hint: "Locked.",
		hintMode: "inline",
	});
	assertEquals([inline.behindHint, inline.row?.text, inline.describedBy], [
		false,
		"Locked.",
		"f-hint",
	]);
	const bare = formControlRows({ rootId: "f", hint: "Locked." });
	assertEquals([bare.behindHint, bare.row?.id], [false, "f-hint"]);
});

Deno.test("a note always shows beside a hidden hint, and both describe the control", () => {
	const rows = formControlRows({
		rootId: "f",
		label: "Message",
		hint: "What happened.",
		note: "0 / 500",
	});
	assertEquals(rows.row, { id: "f-hint", text: "0 / 500", error: false });
	assertEquals(rows.describedBy, "f-hint f-about");
});

Deno.test("an error replaces the hint and the note, and is the only description", () => {
	const rows = formControlRows({
		rootId: "f",
		label: "Message",
		hint: "What happened.",
		note: "0 / 500",
		error: "Say a little more.",
		status: "invalid",
	});
	assertEquals(rows.row, { id: "f-error", text: "Say a little more.", error: true });
	assertEquals(rows.describedBy, "f-error");
	const quiet = formControlRows({ rootId: "f", label: "M", error: "x", status: "default" });
	assertEquals(quiet.row, null);
});
