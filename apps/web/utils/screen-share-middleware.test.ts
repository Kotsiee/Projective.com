import { assert, assertEquals } from "@std/assert";
import standaloneGuard from "../routes/(standalone)/_middleware.ts";
import { resolveScreenShare } from "./screen-share-context.ts";
import type { State } from "./state.ts";

const ROUTES = new URL("../routes/", import.meta.url);
const ROOT_MIDDLEWARE = "_middleware.ts";

async function routeFiles(
	match: (path: string) => boolean,
	dir: URL = ROUTES,
	rel = "",
): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	for await (const entry of Deno.readDir(dir)) {
		const path = `${rel}${entry.name}`;
		if (entry.isDirectory) {
			const nested = await routeFiles(
				match,
				new URL(`${encodeURIComponent(entry.name)}/`, dir),
				`${path}/`,
			);
			for (const [key, source] of nested) files.set(key, source);
		} else if (/\.tsx?$/.test(entry.name) && match(path)) {
			files.set(path, await Deno.readTextFile(new URL(encodeURIComponent(entry.name), dir)));
		}
	}
	return files;
}

type Middleware = (ctx: {
	req: Request;
	url: URL;
	params: Record<string, string>;
	state: State;
	next: () => Promise<Response>;
}) => Promise<Response>;

function asMiddleware(guard: unknown): Middleware {
	return guard as Middleware;
}

Deno.test("screen share — the root middleware stamps ctx.state.screenShare from the resolver", async () => {
	const source = await Deno.readTextFile(new URL(ROOT_MIDDLEWARE, ROUTES));
	assert(source.includes("ctx.state.screenShare = resolveScreenShare(ctx.req);"));
	assert(source.includes("runWithScreenShare("));
});

Deno.test("screen share — no group middleware writes or replaces ctx.state.screenShare", async () => {
	const groups = await routeFiles((path) =>
		path !== ROOT_MIDDLEWARE && path.endsWith("/_middleware.ts")
	);
	assert(groups.size >= 5, `expected the group middlewares, found ${groups.size}`);
	const writes = [
		/\bscreenShare\s*(?:=(?!=)|\+=|\|\|=|&&=|\?\?=)/,
		/\bdelete\s+ctx\.state\b/,
		/\bctx\.state\s*=(?!=)/,
		/Object\.assign\(\s*ctx\.state\b/,
	];
	for (const [path, source] of groups) {
		for (const pattern of writes) assert(!pattern.test(source), `${path} matches ${pattern}`);
	}
});

Deno.test("screen share — no route opts out of the app wrapper", async () => {
	const routes = await routeFiles(() => true);
	for (const [path, source] of routes) {
		assert(!/skipAppWrapper|skipInheritedLayouts/.test(source), `${path} opts out of _app.tsx`);
	}
});

Deno.test("screen share — the standalone guard keeps the root middleware's answer", async () => {
	for (const cookie of ["pj.screen_share=1", "pj.screen_share=0"]) {
		const req = new Request("http://localhost/inspect/fil-x", { headers: { cookie } });
		const state: State = { screenShare: resolveScreenShare(req) };
		let reached = false;
		await asMiddleware(standaloneGuard)({
			req,
			url: new URL(req.url),
			params: {},
			state,
			next: () => {
				reached = true;
				return Promise.resolve(new Response("page"));
			},
		});
		assert(reached);
		assertEquals(state.screenShare, cookie.endsWith("=1"));
	}
});
