import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { CreateProjectSchema } from "@projective/types/projects";
import type { CreateProject } from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { createProjectPayload, insertProject } from "./live-writes.ts";

/**
 * live-create_test — the Quick-Init create's live path: ONE `projects.create_project` call, so the
 * project, its root stage and both rooms commit together or not at all.
 *
 * The fake sits at `globalThis.fetch`, so the real supabase-js builder is what `insertProject` talks
 * to. The contract half reads the migration text, so a key renamed on either side fails without a
 * database.
 */

// #region Fake PostgREST
interface FakeRequest {
	method: string;
	schema: string;
	name: string;
	rpc: boolean;
	body: unknown;
}

interface PgFailure {
	fail: true;
	status: number;
	body: { code: string; message: string; details: string | null; hint: string | null };
}

function pgFail(code: string, message: string, status = 400): PgFailure {
	return { fail: true, status, body: { code, message, details: null, hint: null } };
}

function isFailure(value: unknown): value is PgFailure {
	return typeof value === "object" && value !== null && (value as PgFailure).fail === true;
}

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY"] as const;

async function withPostgrest<T>(
	routes: Record<string, unknown>,
	body: (calls: FakeRequest[]) => Promise<T>,
): Promise<T> {
	const calls: FakeRequest[] = [];
	const realFetch = globalThis.fetch;
	const savedEnv = ENV_KEYS.map((key) => [key, Deno.env.get(key)] as const);
	Deno.env.set("SUPABASE_URL", "http://postgrest.fake");
	Deno.env.set("SUPABASE_ANON_KEY", "XXXX-XXXX");

	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const path = new URL(request.url).pathname.replace(/^\/rest\/v1\//, "");
		const rpc = path.startsWith("rpc/");
		const text = await request.text();
		const req: FakeRequest = {
			method: request.method,
			schema: request.headers.get("content-profile") ?? request.headers.get("accept-profile") ??
				"public",
			name: rpc ? path.slice(4) : path,
			rpc,
			body: text ? JSON.parse(text) : null,
		};
		calls.push(req);
		const key = `${req.schema}.${rpc ? "rpc." : ""}${req.name}`;
		const answer = key in routes ? routes[key] : null;
		const status = isFailure(answer) ? answer.status : 200;
		return new Response(JSON.stringify(isFailure(answer) ? answer.body : answer), {
			status,
			headers: { "content-type": "application/json" },
		});
	};

	try {
		return await body(calls);
	} finally {
		globalThis.fetch = realFetch;
		for (const [key, value] of savedEnv) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

async function quietly<T>(run: () => Promise<T>): Promise<T> {
	const real = console.error;
	console.error = () => {};
	try {
		return await run();
	} finally {
		console.error = real;
	}
}
// #endregion

// #region Fixtures
const OWNER: ReadActor & { accessToken: string } = {
	userId: "11111111-1111-4111-8111-111111111111",
	contextId: "",
	contextType: "personal",
	accessToken: "XXXX-XXXX",
};
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SLUG = "prj-crea7e2345";
const RPC = "projects.rpc.create_project";

function payloadOf(overrides: Record<string, unknown> = {}): CreateProject {
	return CreateProjectSchema.parse({
		title: "Northwind Rebrand",
		format: "pipeline",
		currency: "GBP",
		...overrides,
	});
}

function sentPayload(calls: FakeRequest[]): Record<string, unknown> {
	const call = calls.find((c) => c.rpc && c.name === "create_project");
	assert(call, "create_project was never called");
	return (call.body as { payload: Record<string, unknown> }).payload;
}
// #endregion

// #region One transaction
Deno.test("a create is exactly one create_project call — no follow-up stage or room writes", async () => {
	await withPostgrest({ [RPC]: { id: PROJECT_ID, slug: SLUG } }, async (calls) => {
		const outcome = await insertProject(OWNER, payloadOf());
		assertEquals(outcome, { data: { id: PROJECT_ID, slug: SLUG, invitation: null } });
		assertEquals(calls.length, 1);
		assertEquals(calls[0].schema, "projects");
		assertEquals(calls[0].name, "create_project");
	});
});

Deno.test("a refused create returns the refusal and writes nothing else", async () => {
	await withPostgrest({ [RPC]: pgFail("23514", "Name your project.") }, async (calls) => {
		const outcome = await insertProject(OWNER, payloadOf());
		assert(outcome && "refusal" in outcome);
		assertEquals(outcome.refusal.status, 422);
		assertEquals(calls.length, 1);
	});
});

Deno.test("a workspace the caller does not belong to is a 403 in the database's words", async () => {
	await withPostgrest(
		{ [RPC]: pgFail("42501", "You are not an active member of this team") },
		async () => {
			const outcome = await insertProject(OWNER, payloadOf());
			assert(outcome && "refusal" in outcome);
			assertEquals(outcome.refusal.status, 403);
		},
	);
});

Deno.test("an RPC that answers without a project is a refusal, never a success", async () => {
	await withPostgrest({ [RPC]: null }, async () => {
		const outcome = await quietly(() => insertProject(OWNER, payloadOf()));
		assert(outcome && "refusal" in outcome);
		assert(outcome.refusal.status >= 500);
	});
});

Deno.test("a returned slug that is not a prj- address is refused rather than navigated to", async () => {
	await withPostgrest({ [RPC]: { id: PROJECT_ID, slug: PROJECT_ID } }, async () => {
		const outcome = await quietly(() => insertProject(OWNER, payloadOf()));
		assert(outcome && "refusal" in outcome);
	});
});
// #endregion

// #region The payload
Deno.test("a pipeline's baseline prices the root stage only", async () => {
	await withPostgrest({ [RPC]: { id: PROJECT_ID, slug: SLUG } }, async (calls) => {
		await insertProject(OWNER, payloadOf({ baselineAmountCents: 12_000 }));
		const sent = sentPayload(calls);
		assertEquals(sent.format, "pipeline");
		assertEquals(sent.structure_variation, "standard");
		assertEquals(sent.currency, "GBP");
		assertEquals(sent.budget_type, "fixed_price");
		assertEquals(sent.budget_amount_cents, null);
		assertEquals(sent.stages, [{
			name: "Stage 1",
			description: { html: "" },
			description_text: "",
			unit_price_cents: 12_000,
		}]);
	});
});

Deno.test("a one-off's baseline is the project budget AND the root stage's price", () => {
	const sent = createProjectPayload(payloadOf({ format: "one_off", baselineAmountCents: 250_000 }));
	assertEquals(sent.budget_amount_cents, 250_000);
	assertEquals(sent.structure_variation, "one_off");
	assertEquals((sent.stages as Array<Record<string, unknown>>)[0].name, "Delivery");
	assertEquals((sent.stages as Array<Record<string, unknown>>)[0].unit_price_cents, 250_000);
});

Deno.test("a Task maps to the stage-less structure", () => {
	const sent = createProjectPayload(payloadOf({ format: "one_off", hasStages: false }));
	assertEquals(sent.structure_variation, "single_task");
});

Deno.test("an unwritten brief sends no description, and a written one sends both columns", () => {
	assertEquals("description" in createProjectPayload(payloadOf()), false);
	const sent = createProjectPayload(payloadOf({ description: "Rework the wallet <flows>" }));
	assertEquals(typeof (sent.description as { html: string }).html, "string");
	assertStringIncludes(String(sent.description_text), "Rework the wallet");
});

Deno.test("the invitee never reaches the create RPC — it is a follow-up, not part of the row", () => {
	const sent = createProjectPayload(payloadOf({ inviteeHandle: "@juno" }));
	assertEquals(JSON.stringify(sent).includes("juno"), false);
});
// #endregion

// #region Contract with the SQL
const REPO = new URL("../../../../", import.meta.url);
const RPC_SQL = "supabase/migrations/00001100_functions_projects_read_access.sql";

function createProjectBody(): string {
	const sql = Deno.readTextFileSync(new URL(RPC_SQL, REPO));
	const start = sql.indexOf("CREATE FUNCTION projects.create_project (payload jsonb)");
	assert(start >= 0, `projects.create_project is no longer defined in ${RPC_SQL}`);
	const end = sql.indexOf("\n$$;", start);
	assert(end > start, "create_project has no terminating $$;");
	return sql.slice(start, end);
}

Deno.test("every key the payload sends is one create_project reads", () => {
	const body = createProjectBody();
	const sent = createProjectPayload(
		payloadOf({ format: "one_off", baselineAmountCents: 100, description: "Brief" }),
	);
	for (const key of Object.keys(sent)) {
		assert(
			body.includes(`payload->>'${key}'`) || body.includes(`payload->'${key}'`) ||
				body.includes(`payload ? '${key}'`),
			`create_project does not read payload key "${key}"`,
		);
	}
	for (const key of Object.keys((sent.stages as Array<Record<string, unknown>>)[0])) {
		assert(
			body.includes(`v_stage->>'${key}'`) || body.includes(`v_stage->'${key}'`),
			`create_project does not read stage key "${key}"`,
		);
	}
});

Deno.test("create_project opens the stage room and the Discussion room inside the same function", () => {
	const body = createProjectBody();
	assertStringIncludes(
		body,
		"PERFORM comms.get_or_create_project_channel(v_project_id, v_stage_id, v_stage_name);",
	);
	assertStringIncludes(
		body,
		"PERFORM comms.get_or_create_project_channel(v_project_id, NULL, 'Discussion');",
	);
	assertStringIncludes(body, "security.mint_slug('prj')");
	assertStringIncludes(body, "'draft'::project_status");
});

Deno.test("create_project is callable by a signed-in user", () => {
	const sql = Deno.readTextFileSync(new URL(RPC_SQL, REPO));
	assert(/EXECUTE ON FUNCTION projects\.create_project \(jsonb\) TO authenticated;/.test(sql));
});
// #endregion
