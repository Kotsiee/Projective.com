/**
 * File sharing against the SQL it mirrors (PROJECTS FL4, Decision #570): the `file.shared` notice is
 * catalogued in SQL and TS and emitted by files.set_item_access for person grants only; Shared with
 * me's RPC answers exactly the columns its Zod row reads and is granted to `authenticated` by name
 * (#477); a tier drop revokes links through a trigger and the resolver reads the tier. A test over FILE
 * CONTENT, so it fails with no database; `supabase/probes/file_sharing.sql` proves the behaviour on one.
 * The pure helpers the confirm and the list share are checked here too.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { KNOWN_NOTIFICATION_TYPES } from "../comms/catalog.ts";
import {
	LINKS_WOULD_STOP,
	linksWouldStop,
	linksWouldStopNote,
	SetItemAccessSchema,
	SharedFileRowSchema,
	sharedViaLabel,
	stopsShareLinks,
	toSharedFile,
} from "./access.ts";
import { SetVisibilitySchema } from "./upload.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");
const normal = (s: string) => s.replace(/\s+/g, " ").replace(/ \(/g, "(");

const FUNCTIONS = read("supabase/migrations/00001160_functions_files.sql");
const TRIGGERS = normal(read("supabase/migrations/00001880_triggers_files.sql"));
const CATALOG = read("supabase/migrations/00005010_seed_notification_catalog.sql");
const FN_GRANTS = normal(read("supabase/migrations/00002510_permissions_function_grants.sql"));

function functionBlock(name: string): string {
	const start = FUNCTIONS.indexOf(`CREATE OR REPLACE FUNCTION ${name} (`);
	assert(start >= 0, `${name} is no longer defined`);
	return FUNCTIONS.slice(start, FUNCTIONS.indexOf("\n$$;", start) + 4);
}

// #region SQL contract
Deno.test("the file.shared notice is catalogued in SQL and in TS, digestible, opening the inspector", () => {
	assert((KNOWN_NOTIFICATION_TYPES as readonly string[]).includes("file.shared"));
	const row = CATALOG.split("\n").find((l) => l.startsWith("('file.shared'"));
	assert(row, "00005010 catalogues file.shared");
	assertStringIncludes(row, "'work'");
	assertStringIncludes(row, "'/inspect/{entity_id}'");
	assertStringIncludes(row, "false, false, true,  false");
});

Deno.test("set_item_access tells a person grant only, and never on a file left Only you", () => {
	const body = functionBlock("files.set_item_access");
	assertStringIncludes(body, "'file.shared'");
	assertStringIncludes(body, "IF v_kind = 'user'::files.grantee_kind");
	assertStringIncludes(
		body,
		"COALESCE (p_visibility, v_item.visibility) <> 'private'::files.file_visibility",
	);
	assertEquals(body.split("comms.fn_notify").length - 1, 1, "one emit, for the new person grant");
});

Deno.test("list_shared_with_me answers the columns its Zod row reads, and is authenticated-only", () => {
	const body = functionBlock("files.list_shared_with_me");
	const returns = body.slice(body.indexOf("RETURNS TABLE ("), body.indexOf(")\nLANGUAGE"));
	const columns = [...returns.matchAll(/^\s+([a-z_]+) [a-z]/gm)].map((m) => m[1]);
	assertEquals(columns.sort(), Object.keys(SharedFileRowSchema.shape).sort());
	assertStringIncludes(body, "SECURITY DEFINER");
	assertStringIncludes(body, "SET search_path = ''");
	assertStringIncludes(body, "files.fn_can_read (i.id)");
	assertStringIncludes(
		FN_GRANTS,
		"REVOKE ALL ON FUNCTION files.list_shared_with_me(integer) FROM public, anon;",
	);
	assertStringIncludes(
		FN_GRANTS,
		"GRANT EXECUTE ON FUNCTION files.list_shared_with_me(integer) TO authenticated, service_role;",
	);
});

Deno.test("a tier drop revokes links in a trigger, and the resolver reads the tier", () => {
	assertStringIncludes(
		functionBlock("files.fn_revoke_links_on_tier_drop"),
		"SET revoked_at = pg_catalog.now ()",
	);
	assertStringIncludes(TRIGGERS, "AFTER UPDATE OF visibility ON files.items");
	assertStringIncludes(
		TRIGGERS,
		"NEW.visibility IN('private'::files.file_visibility, 'restricted'::files.file_visibility)",
	);
	assertStringIncludes(
		functionBlock("files.fn_resolve_share"),
		"i.visibility IN ('link'::files.file_visibility, 'public'::files.file_visibility)",
	);
});
// #endregion

// #region Pure helpers
Deno.test("a tier stops share links only below Anyone with the link", () => {
	assertEquals(
		(["private", "restricted", "link", "public"] as const).map(stopsShareLinks),
		[true, true, false, false],
	);
});

Deno.test("linksWouldStop reads only a links_would_stop 409's count", () => {
	assertEquals(linksWouldStop({ code: LINKS_WOULD_STOP, links: 2 }), 2);
	assertEquals(linksWouldStop({ code: "other", links: 2 }), null);
	assertEquals(linksWouldStop({ code: LINKS_WOULD_STOP, links: "2" }), null);
	assertEquals(linksWouldStop(undefined), null);
	assertStringIncludes(linksWouldStopNote(1), "Its share link stops working");
	assertStringIncludes(linksWouldStopNote(3), "Its 3 share links stop working");
});

Deno.test("both tier writes carry the owner's confirm", () => {
	const id = crypto.randomUUID();
	assertEquals(
		SetItemAccessSchema.parse({ itemId: id, visibility: "private", stopLinks: true }).stopLinks,
		true,
	);
	assertEquals(
		SetVisibilitySchema.parse({ assetIds: [id], visibility: "private", stopLinks: true }).stopLinks,
		true,
	);
});

Deno.test("a Shared with me row maps to the DTO and says where it came from", () => {
	const row = SharedFileRowSchema.parse({
		item_id: crypto.randomUUID(),
		name: "brief.pdf",
		mime_type: "application/pdf",
		size_bytes: "2048",
		role: "viewer",
		via_kind: "team",
		via_name: "Northwind Studio",
		shared_by: crypto.randomUUID(),
		shared_by_name: "Ada Lovelace",
		shared_at: "2026-11-25T10:00:00+00:00",
	});
	const file = toSharedFile(row);
	assertEquals(file.sizeBytes, 2048);
	assertEquals(file.via, "team");
	assertEquals(sharedViaLabel(file), "Shared with Northwind Studio");
	assertEquals(sharedViaLabel({ via: "user", viaName: "Me" }), "Shared with you");
	assertEquals(sharedViaLabel({ via: "project", viaName: null }), "Shared with your project");
});
// #endregion
