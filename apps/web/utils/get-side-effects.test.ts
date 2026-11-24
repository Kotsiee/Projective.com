import { assert, assertEquals } from "@std/assert";

/**
 * get-side-effects_test — PRD-C11's regression gate: rendering a page writes nothing.
 *
 * A page is fetched by more than the person reading it: a prefetch, a link unfurler, a retry, and a
 * cross-site top-level navigation, which carries the `SameSite=Lax` session cookie. So a GET must not
 * change what the person will see. A write a person causes is their POST, behind the `/api` origin
 * guard (`utils/csrf.ts`); the read mark is the model (`POST /api/messaging/conversations/[id]/read`,
 * sent by the chat island once the thread has painted in a visible tab).
 *
 * The gate reads the source of every module that runs while a page GET renders: the non-API route
 * files, the `features/*\/routes` screens they re-export, and the server-only loaders those reach on
 * every render (`features/*\/core/*-ssr.ts` and the shell's lane and band resolvers,
 * `features/*\/core/*-slot(s).tsx`). It fails when one of them names a write helper that has been
 * moved behind a POST. View counts and other GET telemetry are listed in ROUTING.md §A GET writes
 * nothing; they are not on this list.
 */

// #region The list
/** A write that once ran during a page GET, and the POST that owns it now. */
interface MovedWrite {
	/** The identifier a page or its loader must not name. */
	name: string;
	/** Where the write lives now. */
	door: string;
}

const MOVED_WRITES: readonly MovedWrite[] = [
	{
		name: "markConversationRead",
		door: "POST /api/messaging/conversations/[id]/read (the SSR helper is gone)",
	},
	{
		name: "markRead",
		door: "POST /api/messaging/conversations/[id]/read · POST /api/notifications/read",
	},
	{ name: "markLiveRead", door: "POST /api/messaging/conversations/[id]/read" },
	{ name: "mark_dm_read", door: "POST /api/messaging/conversations/[id]/read" },
	{ name: "markChatRead", door: "POST /api/projects/messages/read (PROJECTS CH3)" },
	{ name: "markChatSeen", door: "POST /api/projects/messages/read, sent by the chat island" },
	{ name: "markLiveRoomRead", door: "POST /api/projects/messages/read" },
	{ name: "mark_room_read", door: "POST /api/projects/messages/read" },
	{ name: "confirmEmail", door: "POST /api/user/emails/verify (the press of Confirm)" },
	{ name: "confirm_user_email", door: "POST /api/user/emails/verify (the press of Confirm)" },
];
// #endregion

// #region Scanner
const WEB = new URL("../", import.meta.url);

/** Every source file under `dir`, tests excluded. */
async function* sources(dir: URL): AsyncGenerator<URL> {
	for await (const entry of Deno.readDir(dir)) {
		const url = new URL(entry.isDirectory ? `${entry.name}/` : entry.name, dir);
		if (entry.isDirectory) yield* sources(url);
		else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield url;
	}
}

/** The modules that run while a page GET renders, as paths relative to `apps/web/`. */
async function getTimeModules(): Promise<string[]> {
	const out: string[] = [];
	const rel = (url: URL) => url.href.slice(WEB.href.length);
	for await (const file of sources(new URL("routes/", WEB))) {
		if (!rel(file).startsWith("routes/api/")) out.push(rel(file));
	}
	for await (const feature of Deno.readDir(new URL("features/", WEB))) {
		if (!feature.isDirectory) continue;
		const base = new URL(`features/${feature.name}/`, WEB);
		try {
			for await (const file of sources(new URL("routes/", base))) out.push(rel(file));
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) throw error;
		}
		try {
			for await (const entry of Deno.readDir(new URL("core/", base))) {
				if (entry.isFile && /(-ssr\.ts|-slots?\.tsx)$/.test(entry.name)) {
					out.push(`features/${feature.name}/core/${entry.name}`);
				}
			}
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) throw error;
		}
	}
	return out.sort();
}

/** The source with its comments removed, so a JSDoc that names a helper is not a use of it. */
function code(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** The moved writes a module's code names. */
export function namedWrites(source: string): string[] {
	const body = code(source);
	return MOVED_WRITES.filter((w) => new RegExp(`\\b${w.name}\\b`).test(body)).map((w) => w.name);
}
// #endregion

// #region The gate
Deno.test("GET gate: no page, screen or render-time loader names a write that moved to a POST", async () => {
	const findings: string[] = [];
	for (const path of await getTimeModules()) {
		const hits = namedWrites(await Deno.readTextFile(new URL(path, WEB)));
		for (const name of hits) {
			const door = MOVED_WRITES.find((w) => w.name === name)!.door;
			findings.push(`${path} names ${name}; that write is ${door}`);
		}
	}
	assertEquals(findings, []);
});

Deno.test("GET gate: the scan covers the conversation page and the loaders it reaches", async () => {
	const modules = await getTimeModules();
	for (
		const expected of [
			"routes/(dashboard)/messages/[conversationId]/index.tsx",
			"routes/(dashboard)/_layout.tsx",
			"features/messaging/core/conversations-ssr.ts",
			"features/messaging/core/inbox-slots.tsx",
		]
	) {
		assert(modules.includes(expected), `${expected} is scanned`);
	}
	assert(!modules.some((m) => m.startsWith("routes/api/")), "API routes are out of scope");
});

Deno.test("GET gate: an import or a call is caught; a comment or a longer name is not", () => {
	assertEquals(
		namedWrites('import { markConversationRead } from "x";\nawait markConversationRead(id, a);'),
		["markConversationRead"],
	);
	assertEquals(namedWrites("await MessagingBackendService.markRead(id, actor);"), ["markRead"]);
	assertEquals(namedWrites("/** Never calls markRead. */\nconst a = 1; // nor markLiveRead"), []);
	assertEquals(namedWrites("const url = 'https://x.test/a'; markReadAll();"), []);
});
// #endregion
