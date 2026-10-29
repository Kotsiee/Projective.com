import { assert, assertEquals, assertRejects } from "@std/assert";
import { stub } from "@std/testing/mock";
import { HttpError } from "fresh";
import { fail, ok } from "@server/services/ServiceResult.ts";
import { EditorialArticlesBackendService } from "@server/services/editorial/EditorialArticlesBackendService.ts";
import type { PageMeta } from "@features/marketing/core/seo.ts";
import { handler as indexHandler } from "./index-handler.ts";
import { handler as readerHandler } from "./reader-handler.ts";

/**
 * The two article routes' handlers (P6): canonical redirects, the 404s that never confirm a hidden
 * article, the error page's status for a failed read, and the head facts a rendered page carries.
 * Run on the fixture road (no `EDITORIAL_BACKEND_LIVE` in the test environment).
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;
type Answer = { status: number; location: string | null; data?: Record<string, unknown> };
type State = { meta?: PageMeta; isAuthenticated?: boolean };

async function call(
	routeHandler: unknown,
	path: string,
	params: Record<string, string> = {},
	state: State = {},
): Promise<Answer> {
	const url = new URL(`https://projective.test${path}`);
	// Development: the canonical origin is the request's own (production reads `APP_URL`).
	const prior = Deno.env.get("DENO_ENV");
	Deno.env.set("DENO_ENV", "development");
	const res = await Promise.resolve((routeHandler as Record<string, Handler>).GET({
		req: new Request(url),
		url,
		params,
		state,
	})).finally(() => {
		if (prior === undefined) Deno.env.delete("DENO_ENV");
		else Deno.env.set("DENO_ENV", prior);
	});
	if (res instanceof Response) {
		return { status: res.status, location: res.headers.get("location") };
	}
	const answer = res as unknown as { status?: number; data?: Record<string, unknown> };
	return { status: answer.status ?? 200, location: null, data: answer.data };
}
// #endregion

// #region /articles
Deno.test("/articles renders page 1 with its head facts set", async () => {
	const state: State = {};
	const res = await call(indexHandler, "/articles", {}, state);
	assertEquals(res.status, 200);
	assert(res.data?.index && res.data?.jsonLd);
	assertEquals(state.meta?.canonical, "https://projective.test/articles");
});

Deno.test("/articles redirects every non-canonical spelling of its filter (308)", async () => {
	assertEquals(await call(indexHandler, "/articles?page=1"), {
		status: 308,
		location: "/articles",
	});
	assertEquals(
		await call(indexHandler, "/articles?topic=value-pricing&topic=agile-delivery&topic=x"),
		{ status: 308, location: "/articles?topic=agile-delivery&topic=value-pricing" },
	);
});

Deno.test("/articles: a page past the last is a 404; an unreachable store is a 503", async () => {
	const missing = await assertRejects(() => call(indexHandler, "/articles?page=7"), HttpError);
	assertEquals(missing.status, 404);
	const down = stub(
		EditorialArticlesBackendService,
		"index",
		() => Promise.resolve(fail(503, { message: "Unavailable." })),
	);
	try {
		const err = await assertRejects(() => call(indexHandler, "/articles"), HttpError);
		assertEquals(err.status, 503);
	} finally {
		down.restore();
	}
});
// #endregion

// #region /articles/[slug]
Deno.test("/articles/[slug] renders a visible article; the call to action follows the session", async () => {
	const state: State = { isAuthenticated: true };
	const res = await call(
		readerHandler,
		"/articles/no-hold-no-work",
		{ slug: "no-hold-no-work" },
		state,
	);
	assertEquals(res.status, 200);
	assertEquals(res.data?.kind, "article");
	assertEquals(res.data?.signedIn, true);
	assertEquals(state.meta?.canonical, "https://projective.test/articles/no-hold-no-work");
	assertEquals(state.meta?.og.type, "article");
});

Deno.test("/articles/[slug]: the wrong case 308s to the stored spelling, query kept", async () => {
	assertEquals(
		await call(readerHandler, "/articles/No-Hold-No-Work?ref=x", { slug: "No-Hold-No-Work" }),
		{ status: 308, location: "/articles/no-hold-no-work?ref=x" },
	);
});

Deno.test("/articles/[slug]: a malformed or unknown slug is an in-frame 404 notice, read or not", async () => {
	for (const slug of ["new", "not_a_slug", "nothing-here"]) {
		const state: State = {};
		const res = await call(readerHandler, `/articles/${slug}`, { slug }, state);
		assertEquals(res.status, 404, slug);
		assertEquals(res.data, { kind: "missing" }, slug);
		assertEquals(state.meta?.robots, "noindex, follow", slug);
		assertEquals(state.meta?.canonical, "https://projective.test/articles");
	}
	const read = stub(EditorialArticlesBackendService, "article");
	try {
		const res = await call(readerHandler, "/articles/not_a_slug", { slug: "not_a_slug" });
		assertEquals(res.status, 404);
		assertEquals(read.calls.length, 0, "a malformed slug is never read");
	} finally {
		read.restore();
	}
});

Deno.test("/articles/[slug]: an unreachable store is still the error page's 503", async () => {
	const down = stub(
		EditorialArticlesBackendService,
		"article",
		() => Promise.resolve(fail(503, { message: "Unavailable." })),
	);
	try {
		const err = await assertRejects(
			() => call(readerHandler, "/articles/no-hold-no-work", { slug: "no-hold-no-work" }),
			HttpError,
		);
		assertEquals(err.status, 503);
	} finally {
		down.restore();
	}
});

Deno.test("/articles/[slug]: a renamed article's former slug 308s to it, query kept", async () => {
	const moved = stub(
		EditorialArticlesBackendService,
		"movedTo",
		(slug: string) => Promise.resolve(ok(slug === "old-name" ? "new-name" : null)),
	);
	try {
		assertEquals(
			await call(readerHandler, "/articles/old-name?ref=mail", { slug: "old-name" }),
			{ status: 308, location: "/articles/new-name?ref=mail" },
		);
		const missing = await call(readerHandler, "/articles/nothing-here", { slug: "nothing-here" });
		assertEquals(missing.status, 404);
		assertEquals(missing.data, { kind: "missing" });
		// A visible article is served as itself; its slug is never looked up as a former one.
		const before = moved.calls.length;
		assertEquals(
			(await call(readerHandler, "/articles/no-hold-no-work", { slug: "no-hold-no-work" })).status,
			200,
		);
		assertEquals(moved.calls.length, before);
	} finally {
		moved.restore();
	}
});
// #endregion
