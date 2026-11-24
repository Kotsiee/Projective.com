/**
 * The message-edit mirrors against the migrations they mirror (PROJECTS CH1).
 *
 * Reads the consolidated migrations, never a live database: `comms.message_revisions` is compared
 * column for key with {@link MessageRevisionRowSchema}; the edit window the client offers is the
 * seeded dial and the doors' own fallback; and every refusal {@link messageEditOffer} names is a
 * SQLSTATE the doors raise, so the stub and the live door refuse for the same reasons.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { columnDrift, readRepoFile, tableColumns } from "../core/table-contract.ts";
import { MESSAGE_EDIT_WINDOW_MINUTES, MessageRevisionRowSchema } from "./message-edits.ts";

const TABLES = readRepoFile("supabase/migrations/00000016_tables_comms.sql").replace(/\r\n/g, "\n");
const DOORS = readRepoFile("supabase/migrations/00001300_functions_comms_channels.sql").replace(
	/\r\n/g,
	"\n",
);
const PARAMS = readRepoFile("supabase/migrations/00005001_seed_platform_params.sql").replace(
	/\r\n/g,
	"\n",
);

/** The body of one CREATE FUNCTION in 00001300, up to its closing `$$;`. */
function functionBody(name: string): string {
	const start = DOORS.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
	assert(start >= 0, `${name} is gone`);
	return DOORS.slice(start, DOORS.indexOf("\n$$;", start));
}

Deno.test("comms.message_revisions: every column has a key and every key a column", () => {
	const drift = columnDrift(
		tableColumns(TABLES, "comms.message_revisions"),
		Object.keys(MessageRevisionRowSchema.shape),
	);
	assertEquals(drift, { missingKeys: [], extraKeys: [], staleAllowlist: [] });
});

Deno.test("comms.message_revisions: its two enums are the table's CHECKs", () => {
	const start = TABLES.indexOf("CREATE TABLE comms.message_revisions");
	const body = TABLES.slice(start, TABLES.indexOf("\n);", start));
	assertStringIncludes(body, "action IN ('edit', 'delete')");
	assertStringIncludes(body, "'comms.project_messages',\n            'comms.dm_messages'");
	assertEquals(MessageRevisionRowSchema.shape.action.options, ["edit", "delete"]);
});

Deno.test("comms.dm_messages carries edited_at beside deleted_at", () => {
	const columns = tableColumns(TABLES, "comms.dm_messages");
	assert(columns.includes("edited_at"), "comms.dm_messages has no edited_at");
	assert(columns.includes("deleted_at"), "comms.dm_messages has no deleted_at");
});

Deno.test("the edit window is the seeded dial and the doors' fallback", () => {
	const seeded = PARAMS.match(/\('message_edit_window_minutes', '(\d+)'::jsonb/);
	assert(seeded, "message_edit_window_minutes is not seeded");
	assertEquals(Number(seeded[1]), MESSAGE_EDIT_WINDOW_MINUTES);
	assertStringIncludes(
		functionBody("comms.fn_message_edit_window_minutes"),
		`WHERE p.key = 'message_edit_window_minutes'),\n        ${MESSAGE_EDIT_WINDOW_MINUTES});`,
	);
});

Deno.test("every refusal the client names is one the doors raise", () => {
	const shared = functionBody("comms.fn_message_for_change");
	for (const code of ["P0002", "42501", "PM409", "PM423"]) {
		assertStringIncludes(shared, `ERRCODE = '${code}'`);
	}
	const edit = functionBody("comms.edit_message");
	assertStringIncludes(edit, "ERRCODE = 'PM410'");
	assertStringIncludes(edit, "ERRCODE = '22023'");
	assertStringIncludes(edit, "pg_catalog.char_length(p_body) > 8000");
	assert(
		!functionBody("comms.delete_message").includes("PM410"),
		"a delete is never refused by the window",
	);
	const freeze = functionBody("comms.fn_message_room_freeze");
	assertStringIncludes(freeze, "THEN 'archived'");
	assertStringIncludes(freeze, "THEN 'dispute'");
});
