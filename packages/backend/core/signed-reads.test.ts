/**
 * No signed read URL and no private bucket's address reaches a browser (`ASSET_DELIVERY_ARCHITECTURE.md`
 * invariant 2, phase 1). Nothing in the tree may mint one: storage-js's read signers are refused
 * everywhere, and the storage REST read address is built only by the server-side transport
 * (`storage-stream.ts`), which calls the internal origin as the service role. Signed UPLOAD URLs stay
 * (ruling A2, Decision #499); the four public buckets' addresses wait for phase 4 (§4.2).
 */
import { assert, assertEquals } from "@std/assert";

// #region Policy
/** The repository root, from `packages/backend/core/`. */
const ROOT = new URL("../../../", import.meta.url);

/** The trees the gate reads: everything that can answer a request or run in a browser. */
const SCAN_ROOTS = ["apps/web/", "packages/", "scripts/", "supabase/functions/"] as const;

/** Build output and dependencies are not source. */
const SKIP_DIRS = new Set(["node_modules", "_fresh", "dist", "coverage", "vendor"]);

const SCANNED = /\.(tsx?|jsx?)$/;

/** What mints or names a private read: storage-js's read signers, and storage's read routes. */
const READ_SIGNERS = /\.createSignedUrls?\(/g;
const READ_ROUTES = /\/storage\/v1\/object\/(?:authenticated|sign)\//g;

/** The one file that may name a read route: the service-role transport, internal origin only. */
const TRANSPORT = "packages/backend/core/storage-stream.ts";
// #endregion

// #region Scanner
/** Every `path:line token` in `text` that mints or names a private read. */
function findSignedReads(path: string, text: string): string[] {
	const out: string[] = [];
	const line = (index: number) => text.slice(0, index).split("\n").length;
	for (const m of text.matchAll(READ_SIGNERS)) out.push(`${path}:${line(m.index)} ${m[0]}`);
	if (path !== TRANSPORT) {
		for (const m of text.matchAll(READ_ROUTES)) out.push(`${path}:${line(m.index)} ${m[0]}`);
	}
	return out;
}

function* walk(dir: string): Generator<string> {
	let entries: Iterable<Deno.DirEntry>;
	try {
		entries = Deno.readDirSync(new URL(dir, ROOT));
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.isDirectory) {
			if (!SKIP_DIRS.has(entry.name)) yield* walk(`${dir}${entry.name}/`);
		} else if (entry.isFile && SCANNED.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
			yield `${dir}${entry.name}`;
		}
	}
}
// #endregion

// #region Gate
Deno.test("nothing mints a signed read URL or names a private storage read address", () => {
	const found: string[] = [];
	let scanned = 0;
	for (const root of SCAN_ROOTS) {
		for (const path of walk(root)) {
			scanned++;
			found.push(...findSignedReads(path, Deno.readTextFileSync(new URL(path, ROOT))));
		}
	}
	assert(scanned > 500, `the scan read only ${scanned} files — is the root right?`);
	assertEquals(found, [], "every private read streams through the app (ASSET_DELIVERY §5.3)");
});

Deno.test("the scanner catches a planted signer and route, and spares the transport and uploads", () => {
	const planted =
		"const a = 1;\nawait s.createSignedUrl(p, 60);\nconst u = `${b}/storage/v1/object/sign/x`;";
	assertEquals(findSignedReads("packages/x.ts", planted), [
		"packages/x.ts:2 .createSignedUrl(",
		"packages/x.ts:3 /storage/v1/object/sign/",
	]);
	assertEquals(findSignedReads(TRANSPORT, "`${b}/storage/v1/object/authenticated/${k}`"), []);
	assertEquals(
		findSignedReads(
			"packages/x.ts",
			"s.createSignedUploadUrl(p); '/storage/v1/object/upload/sign/'",
		),
		[],
	);
});
// #endregion
