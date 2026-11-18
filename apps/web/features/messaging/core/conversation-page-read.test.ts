import { assert, assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import type { ConversationDetail } from "@projective/types/messaging";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import { ok } from "@server/services/ServiceResult.ts";
import { readActor } from "@web/utils/api-session.ts";
import { resolveConversation } from "./conversations-ssr.ts";
import middleware from "../../../routes/(dashboard)/messages/[conversationId]/_middleware.ts";

/**
 * PRD-C11 (SAC3): rendering `/messages/[conversationId]` writes nothing. The read mark is a person's
 * POST (`/api/messaging/conversations/[id]/read`), sent by the chat island once the thread has painted
 * in a visible tab, so a prefetch, a link unfurler, a retry or a cross-site top-level navigation (all
 * of which carry the `SameSite=Lax` session cookie) never marks a thread read.
 *
 * ## Why the route is imported through a data URL
 *
 * The page imports the chat island and the not-found component, whose graphs reach `.css` modules
 * that `deno test` refuses. The page never renders either (it returns a vnode naming them), so the
 * route is loaded from its own source with those two specifiers swapped for inert stubs, and every
 * other import resolved exactly as the app resolves it. The fat service is the same module instance
 * the page reaches, so a spy on it sees every call the page makes.
 */

// #region Harness
const ROUTE = new URL(
	"../../../routes/(dashboard)/messages/[conversationId]/index.tsx",
	import.meta.url,
);

function dataUrl(source: string, type: "tsx" | "javascript"): string {
	const media = type === "tsx" ? "text/tsx" : "application/javascript";
	return `data:${media},${encodeURIComponent(source)}`;
}

const CHAT_STUB = dataUrl(
	"export default function ConversationChat() { return null; }\n",
	"javascript",
);
const NOT_FOUND_STUB = dataUrl(
	"export function ConversationNotFound() { return null; }\n",
	"javascript",
);

const STUBS: Record<string, string> = {
	"@web/features/messaging/islands/ConversationChat.island.tsx": CHAT_STUB,
	"@web/features/messaging/components/ConversationNotFound.tsx": NOT_FOUND_STUB,
};

/** The route's source with its render-only imports stubbed and every other specifier resolved. */
async function routeUrl(): Promise<string> {
	let source = await Deno.readTextFile(ROUTE);
	const specs = new Set([...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]));
	for (const spec of specs) {
		const target = STUBS[spec] ?? import.meta.resolve(spec);
		source = source.replaceAll(`"${spec}"`, `"${target}"`);
	}
	// A data URL is outside the workspace, so it takes no `compilerOptions`: name the JSX runtime here.
	return dataUrl(`/** @jsxImportSource preact */\n${source}`, "tsx");
}

type Page = (ctx: unknown) => Promise<{ type: unknown; props: Record<string, unknown> }>;

const { default: page }: { default: Page } = await import(await routeUrl());
const { default: ChatStub }: { default: unknown } = await import(CHAT_STUB);
const { ConversationNotFound: NotFoundStub }: { ConversationNotFound: unknown } = await import(
	NOT_FOUND_STUB
);

/** Run `fn` with `vars` applied, restoring the previous environment afterwards. */
async function withEnv(
	vars: Record<string, string | undefined>,
	fn: () => Promise<void>,
): Promise<void> {
	const prior = new Map<string, string | undefined>();
	for (const key of Object.keys(vars)) prior.set(key, Deno.env.get(key));
	try {
		for (const [key, value] of Object.entries(vars)) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
		await fn();
	} finally {
		for (const [key, value] of prior) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

/** The fixture backend, which answers a known conversation and its latest page with no database. */
const FIXTURES = {
	SUPABASE_URL: "https://example.supabase.co",
	SUPABASE_ANON_KEY: "anon-key",
	USE_MOCKS: "false",
	VITE_USE_MOCKS: undefined,
	MESSAGING_BACKEND_LIVE: "false",
};

const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;

function ctxFor(conversationId: string): unknown {
	const url = new URL(`https://app.example.test/messages/${conversationId}`);
	return {
		req: new Request(url),
		url,
		params: { conversationId },
		state: { userContext: ALICE },
	};
}

/** Count the calls the page makes to the fat service's read mark while `fn` runs. */
async function countingMarkRead(fn: () => Promise<void>): Promise<number> {
	const original = MessagingBackendService.markRead;
	let calls = 0;
	MessagingBackendService.markRead = (...args) => {
		calls++;
		return original.apply(MessagingBackendService, args);
	};
	try {
		await fn();
	} finally {
		MessagingBackendService.markRead = original;
	}
	return calls;
}
// #endregion

// #region The GET writes nothing
Deno.test("conversation page: rendering the thread never marks it read", async () => {
	await withEnv(FIXTURES, async () => {
		let rendered: { type: unknown; props: Record<string, unknown> } | null = null;
		const calls = await countingMarkRead(async () => {
			rendered = await page(ctxFor("dm-mara"));
		});
		const vnode = rendered as { type: unknown; props: Record<string, unknown> } | null;
		assert(vnode, "the page rendered");
		assertEquals(vnode.type, ChatStub, "the thread rendered, so the page reached its read point");
		assert(vnode.props.initial, "the latest page was served to the island");
		assertEquals(calls, 0);
	});
});

Deno.test("conversation page: a conversation that does not resolve renders the not-found, unmarked", async () => {
	await withEnv(FIXTURES, async () => {
		let rendered: { type: unknown } | null = null;
		const calls = await countingMarkRead(async () => {
			rendered = await page(ctxFor("grp-no-such-group"));
		});
		assertEquals((rendered as { type: unknown } | null)?.type, NotFoundStub);
		assertEquals(calls, 0);
	});
});
// #endregion

// #region One read per request (MS2, RED D-06) · addresses (Decision #339 ruling N1)
type Middleware = (ctx: unknown) => Promise<Response>;
const runMiddleware = middleware as unknown as Middleware;

/** A request through the route's middleware, `next` rendering an empty 200 body. */
function middlewareCtx(conversationId: string, tail = ""): Record<string, unknown> {
	const ctx = ctxFor(conversationId) as Record<string, unknown>;
	const url = new URL(`https://app.example.test/messages/${conversationId}${tail}?m=abc`);
	return { ...ctx, url, req: new Request(url), next: () => Promise.resolve(new Response("body")) };
}

const REF = "cht-23456789ab";

const DETAIL: ConversationDetail = {
	id: REF,
	ref: REF,
	kind: "dm",
	relation: "dm",
	title: "Mara",
	avatar: null,
	sub: "@mara",
	participants: [],
	starred: false,
	muted: false,
	archived: false,
	folder: "primary",
	canAddMembers: false,
	serviceId: null,
	serviceName: null,
};

/** Run `fn` with the fat service's route read answered by `answer`, counting the reads. */
async function countingRoute(
	answer: () => ReturnType<typeof MessagingBackendService.route>,
	fn: () => Promise<void>,
): Promise<number> {
	const original = MessagingBackendService.route;
	let calls = 0;
	MessagingBackendService.route = () => {
		calls++;
		return answer();
	};
	try {
		await fn();
	} finally {
		MessagingBackendService.route = original;
	}
	return calls;
}

Deno.test("one /messages/cht-… request resolves the conversation once across the page and its three slots", async () => {
	await withEnv(FIXTURES, async () => {
		const reads = await countingRoute(
			() => Promise.resolve(ok({ detail: DETAIL, location: null })),
			async () => {
				const ctx = middlewareCtx(REF) as { url: URL };
				const res = await runMiddleware(ctx);
				assertEquals(res.status, 200);
				await page(ctx);
				// The header, footer and panel slots each resolve the conversation from the same URL.
				const actor = readActor(ctx as never);
				const slots = await Promise.all([
					resolveConversation(ctx.url, REF, actor),
					resolveConversation(ctx.url, REF, actor),
					resolveConversation(ctx.url, REF, actor),
				]);
				for (const detail of slots) assertEquals(detail?.id, REF);
			},
		);
		assertEquals(reads, 1);
	});
});

Deno.test("conversation route: a dm- address whose pair has a thread is a 303 to its cht- address", async () => {
	await withEnv(FIXTURES, async () => {
		await countingRoute(
			() => Promise.resolve(ok({ detail: DETAIL, location: `/messages/${REF}` }, { status: 303 })),
			async () => {
				const res = await runMiddleware(middlewareCtx("dm-mara", "/files"));
				assertEquals(res.status, 303);
				assertEquals(res.headers.get("location"), `/messages/${REF}/files?m=abc`);
			},
		);
	});
});

Deno.test("conversation route: an address that resolves to nothing answers a real 404", async () => {
	await withEnv(FIXTURES, async () => {
		const res = await runMiddleware(middlewareCtx("22222222-3333-4444-8555-666666666666"));
		assertEquals(res.status, 404);
		assertEquals(await res.text(), "body", "the calm not-found body still renders");
	});
});
// #endregion
