import { assert, assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

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
