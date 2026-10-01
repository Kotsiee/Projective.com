/**
 * The PII filter has two implementations, and the SQL one is the authority. These tests read the
 * migrations (the `hire.contract.test.ts` technique) so an edit to either side fails here, on a laptop
 * with no database, rather than as two layers quietly masking different things.
 */
import { assert, assertStringIncludes } from "@std/assert";
import { SQL_PII_PATTERNS } from "./pii.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");

const FUNCTIONS_SQL = "supabase/migrations/00001300_functions_comms_channels.sql";
const TRIGGERS_SQL = "supabase/migrations/00001840_triggers_comms.sql";

Deno.test("every pattern the mirror documents is the one comms.mask_pii runs", () => {
	const sql = read(FUNCTIONS_SQL);
	const start = sql.indexOf("CREATE OR REPLACE FUNCTION comms.mask_pii(");
	assert(start >= 0, "comms.mask_pii is gone");
	const body = sql.slice(start, sql.indexOf("\n$$;", start));
	for (const [category, pattern] of Object.entries(SQL_PII_PATTERNS)) {
		assertStringIncludes(body, `'${pattern}'`, `the ${category} pattern drifted from the SQL`);
	}
});

Deno.test("direct messages are masked by a BEFORE INSERT trigger, like stage messages", () => {
	const triggers = read(TRIGGERS_SQL);
	assert(
		/BEFORE INSERT ON comms\.dm_messages\s+FOR EACH ROW\s+EXECUTE FUNCTION comms\.tg_mask_dm_message_pii\(\)/
			.test(triggers),
		"the DM masking trigger is not wired",
	);
	assert(
		/BEFORE INSERT ON comms\.project_messages\s+FOR EACH ROW\s+EXECUTE FUNCTION comms\.tg_mask_message_pii\(\)/
			.test(triggers),
		"the stage-room masking trigger is not wired",
	);
});
