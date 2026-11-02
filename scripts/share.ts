/**
 * `deno task share` — let an external tester use this machine's Projective from a browser, over
 * Cloudflare quick tunnels. The tester installs nothing; this machine needs `cloudflared` on PATH.
 *
 *   1. Builds the production bundle and serves it on a free loopback port. Not the dev server: it
 *      serves every npm module unbundled (thousands of requests per cold page), which a tunnel turns
 *      into minutes.
 *   2. Opens a quick tunnel to it; its URL becomes `APP_URL` (links, callbacks, share URLs).
 *   3. When the Supabase API answers, opens a second tunnel to a storage-only proxy; its URL becomes
 *      `SUPABASE_PUBLIC_URL`. Islands never call Supabase (root CLAUDE.md §2): the only Supabase URLs a
 *      browser is handed are storage objects — public reads, signed reads, signed uploads
 *      (packages/backend/core/storage-url.ts, storage-signed.ts). Kong itself is never exposed: it
 *      also routes /rest, /auth and /pg, and the local stack's service-role key is a published default.
 *   4. Everything server-side — `SUPABASE_URL`, the service-role key, every secret — still comes from
 *      `.env.local` / `.env` and stays on 127.0.0.1. An optional, untracked `.env.share` overrides any
 *      of them for the shared server only (`.env.example` §Share mode).
 *
 * Not over the tunnel: Google sign-in (GoTrue's redirect allow-list is localhost), email (Mailpit is
 * local), Stripe webhooks. Testers sign in with a seed persona. Ctrl+C stops the server and tunnels.
 */
import { loadSync } from "@std/dotenv";

// #region Pure helpers

/** A quick-tunnel URL in cloudflared's log; never its own `api.trycloudflare.com`, which its errors name. */
const TUNNEL_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

/** The quick-tunnel URL cloudflared assigned, once it appears in its log output. */
export function tunnelUrl(log: string): string | null {
	return log.match(TUNNEL_URL)?.[0] ?? null;
}

/** The only Supabase routes a browser is sent to, and the methods it uses on each. */
const STORAGE_ROUTES: readonly [prefix: string, methods: readonly string[]][] = [
	["/storage/v1/object/public/", ["GET", "HEAD"]],
	["/storage/v1/object/sign/", ["GET", "HEAD"]],
	["/storage/v1/object/upload/sign/", ["PUT"]],
];

/**
 * Whether the storage proxy forwards `method` on `path` (OPTIONS for the CORS preflight). An encoded
 * slash or backslash is refused: an upstream that decodes it could resolve `..` out of the prefix.
 */
export function storageAllowed(method: string, path: string): boolean {
	if (/%2f|%5c/i.test(path)) return false;
	return STORAGE_ROUTES.some(([prefix, methods]) =>
		path.startsWith(prefix) && (method === "OPTIONS" || methods.includes(method))
	);
}

/**
 * Forwards allowed storage requests to `upstream` without any credential: public and signed URLs
 * carry their own authority, so an `authorization` or `apikey` header could only be someone trying
 * the published local keys.
 */
export function storageProxy(upstream: string): (req: Request) => Promise<Response> {
	return async (req) => {
		const url = new URL(req.url);
		if (!storageAllowed(req.method, url.pathname)) {
			return new Response("Not found", { status: 404 });
		}
		const headers = new Headers(req.headers);
		for (const name of ["authorization", "apikey", "cookie", "host"]) headers.delete(name);
		// Identity, so the body passes through byte-for-byte under the upstream's own headers.
		headers.set("accept-encoding", "identity");
		return await fetch(new URL(url.pathname + url.search, upstream), {
			method: req.method,
			headers,
			body: req.body,
			redirect: "manual",
		});
	};
}

// #endregion

// #region Processes

const INSTALL_HINT =
	`cloudflared is not on PATH. Install it once on this machine (testers need nothing):
  Windows  winget install --id Cloudflare.cloudflared
  macOS    brew install cloudflared
  Linux    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
Then open a new terminal and run \`deno task share\` again.`;

/** Every process this script started, killed on exit. */
const children: { name: string; child: Deno.ChildProcess }[] = [];

function shutdown(code: number): never {
	for (const { child } of children) {
		try {
			child.kill();
		} catch {
			// Already exited.
		}
	}
	Deno.exit(code);
}

function spawn(name: string, args: string[], env?: Record<string, string>): Deno.ChildProcess {
	const child = new Deno.Command("deno", { args, env, stdin: "null" }).spawn();
	children.push({ name, child });
	return child;
}

async function hasCloudflared(): Promise<boolean> {
	try {
		await new Deno.Command("cloudflared", { args: ["--version"], stdout: "null", stderr: "null" })
			.output();
		return true;
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return false;
		throw error;
	}
}

/** Starts a quick tunnel to a loopback port and resolves with its public URL. */
async function openTunnel(name: string, port: number): Promise<string> {
	const child = new Deno.Command("cloudflared", {
		args: ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`],
		stdin: "null",
		stdout: "null",
		stderr: "piped",
	}).spawn();
	children.push({ name, child });
	const reader = child.stderr.pipeThrough(new TextDecoderStream()).getReader();
	let log = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) {
			throw new Error(`cloudflared (${name}) exited before assigning a URL:\n${log.slice(-2000)}`);
		}
		log += value;
		const url = tunnelUrl(log);
		if (url) {
			// Keep draining: a full stderr pipe would stall cloudflared.
			(async () => {
				while (!(await reader.read()).done) { /* discard */ }
			})();
			return url;
		}
	}
}

/** Whether anything answers HTTP at `url` (any status: Kong answers 404 at its root). */
async function reachable(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
		await res.body?.cancel();
		return true;
	} catch {
		return false;
	}
}

function freePort(): number {
	const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
	const { port } = listener.addr;
	listener.close();
	return port;
}

// #endregion

// #region Main

async function main(): Promise<void> {
	Deno.addSignalListener("SIGINT", () => shutdown(130));
	if (Deno.build.os !== "windows") Deno.addSignalListener("SIGTERM", () => shutdown(143));

	// The server's own precedence, with `.env.share` on top: it reaches the server as process env.
	const shareEnv = loadSync({ envPath: ".env.share" });
	const files = { ...loadSync(), ...loadSync({ envPath: ".env.local" }) };
	const setting = (key: string) => shareEnv[key] || Deno.env.get(key) || files[key] || undefined;

	if (!(await hasCloudflared())) {
		console.error(INSTALL_HINT);
		Deno.exit(1);
	}

	const supabaseUrl = setting("SUPABASE_URL");
	const upstream = supabaseUrl && (await reachable(supabaseUrl)) ? supabaseUrl : null;
	if (!upstream) {
		console.warn(
			`⚠ Supabase is not answering at ${
				supabaseUrl ?? "SUPABASE_URL (unset)"
			}. Is Docker running? ` +
				"Start the stack with `npx supabase start`.\n" +
				"  Sharing the app alone: live (*_BACKEND_LIVE) pages will fail, fixture pages (USE_MOCKS=true) work.",
		);
	}

	const build = await spawn("build", ["task", "build"]).status;
	if (!build.success) shutdown(build.code);
	children.pop(); // The finished build; only long-running processes from here.

	const appPort = freePort();
	const proxy = upstream
		? Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, storageProxy(upstream))
		: null;
	const [appUrl, storageUrl] = await Promise.all([
		openTunnel("app tunnel", appPort),
		proxy ? openTunnel("storage tunnel", proxy.addr.port) : null,
	]);

	spawn(
		"server",
		[
			"serve",
			"-A",
			"--unstable-kv",
			"--host",
			"127.0.0.1",
			"--port",
			String(appPort),
			"apps/web/_fresh/server.js",
		],
		{ ...shareEnv, APP_URL: appUrl, ...(storageUrl ? { SUPABASE_PUBLIC_URL: storageUrl } : {}) },
	);

	const deadline = Date.now() + 60_000;
	while (!(await reachable(`http://127.0.0.1:${appPort}/`))) {
		if (Date.now() > deadline) {
			console.error("The server did not answer within a minute; stopping.");
			shutdown(1);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	console.log(`
  Projective is shared.

    Testers open   ${appUrl}
    Storage        ${storageUrl ?? "not shared (Supabase is down)"}
    Sign in as     any seed persona: <username>@projective.dev / password123 (documentation/database/Seed.md)

  Anyone with the link reaches this machine's server and database. Ctrl+C stops everything.
`);

	const ended = await Promise.race(
		children.map(async ({ name, child }) => ({ name, status: await child.status })),
	);
	console.error(`${ended.name} exited (code ${ended.status.code}); stopping.`);
	shutdown(ended.status.success ? 0 : 1);
}

if (import.meta.main) await main();

// #endregion
