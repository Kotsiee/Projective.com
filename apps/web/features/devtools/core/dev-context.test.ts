/// <reference lib="dom" />
import { assert, assertEquals, assertFalse } from "@std/assert";
import { parseBackgroundForce } from "@features/landing/core/background-gate.ts";
import type * as DevContextModule from "./dev-context.ts";
import type * as DevSeamModule from "@web/utils/dev-seam.ts";

// #region Seam-free import
// `dev-context.ts` reaches `@web/utils/dev.ts` twice (through `dev-seam.ts` and `logger.ts`), whose
// `import.meta.env.DEV` is undefined under `deno test`. Same technique as
// `projects/core/board-access.test.ts`: load the sources as `data:` modules with `dev.ts` swapped for a
// literal and the logger for a silent stub, so the REAL write side and the REAL read side meet over
// the same `<html data-dev-*>` contract they share in the browser.
const DEV_SEAM = "@web/utils/dev-seam.ts";
const LOGGER = "@web/utils/logger.ts";
const LOGGER_STUB = "export const logger = { debug() {}, info() {}, warn() {}, error() {} };\n";

function dataUrl(source: string, type: "typescript" | "javascript"): string {
	return `data:application/${type},${encodeURIComponent(source)}`;
}

/** Rewrite every import specifier of `source` (read from `file`) through `swap`, else resolve it. */
async function rewrite(file: URL, swap: (spec: string) => string | null): Promise<string> {
	let source = await Deno.readTextFile(file);
	const specs = new Set([...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]));
	for (const spec of specs) {
		const target = swap(spec) ??
			(spec.startsWith(".") ? new URL(spec, file).href : import.meta.resolve(spec));
		source = source.replaceAll(`"${spec}"`, `"${target}"`);
	}
	return dataUrl(source, "typescript");
}

/** `dev-seam.ts` with `IS_DEV` fixed to `isDev` — `false` is what a production build compiles to. */
function seamUrl(isDev: boolean): Promise<string> {
	const flag = dataUrl(`export const IS_DEV = ${isDev};\n`, "javascript");
	return rewrite(
		new URL(import.meta.resolve(DEV_SEAM)),
		(spec) => spec === "./dev.ts" ? flag : null,
	);
}

const devSeamUrl = await seamUrl(true);
const seam: typeof DevSeamModule = await import(devSeamUrl);
const prodSeam: typeof DevSeamModule = await import(await seamUrl(false));
const ctx: typeof DevContextModule = await import(
	await rewrite(new URL("./dev-context.ts", import.meta.url), (spec) => {
		if (spec === DEV_SEAM) return devSeamUrl;
		if (spec === LOGGER) return dataUrl(LOGGER_STUB, "javascript");
		return null;
	})
);
// #endregion

// #region Fake document
const ATTR = "data-dev-landing-background";

/** `dataset` key → attribute name, the HTML spec's camelCase-to-kebab mapping. */
function dataAttr(key: string): string {
	return `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** The slice of `<html>` the seam touches, keyed by real attribute names so the contract is checked. */
function fakeRoot() {
	const attributes = new Map<string, string>();
	const dataset = new Proxy({} as Record<string, string | undefined>, {
		get: (_, key) => typeof key === "string" ? attributes.get(dataAttr(key)) : undefined,
		set: (_, key, value) => {
			attributes.set(dataAttr(String(key)), String(value));
			return true;
		},
		deleteProperty: (_, key) => {
			attributes.delete(dataAttr(String(key)));
			return true;
		},
	});
	return {
		attributes,
		dataset,
		dir: "",
		removeAttribute: (name: string) => attributes.delete(name),
	};
}

/** Run `fn` against a fresh fake `document`, then reset the store and remove the fake. */
async function withDocument(fn: (root: ReturnType<typeof fakeRoot>) => void | Promise<void>) {
	const root = fakeRoot();
	Object.defineProperty(globalThis, "document", {
		value: { documentElement: root, cookie: "" },
		configurable: true,
		writable: true,
	});
	try {
		await fn(root);
	} finally {
		ctx.resetDevContext();
		delete (globalThis as { document?: unknown }).document;
	}
}
// #endregion

// #region Defaults and options
Deno.test("landingBackground — the inert default is auto", () => {
	assertEquals(ctx.DEV_DEFAULTS.landingBackground, "auto");
	assertEquals(ctx.devOverrides.value.landingBackground, "auto");
});

Deno.test("landingBackground — the options are the landing gate's BackgroundForce values, in order", () => {
	assertEquals(ctx.DEV_LANDING_BACKGROUNDS.map((o) => [o.value, o.label]), [
		["auto", "Auto"],
		["static", "Static only"],
		["spotlight", "Force spotlight"],
	]);
	for (const { value } of ctx.DEV_LANDING_BACKGROUNDS) {
		assertEquals(parseBackgroundForce(value), value);
	}
});
// #endregion

// #region reflect()
Deno.test("reflect — writes data-dev-landing-background only while it overrides, and deletes it", async () => {
	await withDocument((root) => {
		ctx.patchDevContext({ enabled: true, landingBackground: "spotlight" });
		assertEquals(root.attributes.get(ATTR), "spotlight");
		assertEquals(seam.readDevSeam()?.landingBackground, "spotlight");

		ctx.patchDevContext({ landingBackground: "static" });
		assertEquals(root.attributes.get(ATTR), "static");
		assertEquals(seam.readDevSeam()?.landingBackground, "static");

		// `auto` is the ABSENT attribute, never the stamped word.
		ctx.patchDevContext({ landingBackground: "auto" });
		assertFalse(root.attributes.has(ATTR));
		assertEquals(seam.readDevSeam()?.landingBackground, "auto");
	});
});

Deno.test("reflect — switching simulation off deletes the attribute; switching it on restores it", async () => {
	await withDocument((root) => {
		ctx.patchDevContext({ enabled: true, landingBackground: "spotlight" });
		ctx.setDevEnabled(false);
		assertFalse(root.attributes.has(ATTR));
		assertEquals(seam.readDevSeam(), null);

		ctx.setDevEnabled(true);
		assertEquals(root.attributes.get(ATTR), "spotlight");
	});
});

Deno.test("reflect — a reset deletes the attribute and returns the store to auto", async () => {
	await withDocument((root) => {
		ctx.patchDevContext({ enabled: true, landingBackground: "static" });
		ctx.resetDevContext();
		assertFalse(root.attributes.has(ATTR));
		assertEquals(ctx.devOverrides.value.landingBackground, "auto");
	});
});

Deno.test("reflect — subscribers receive the decoded value on every change", async () => {
	await withDocument(() => {
		const seen: Array<string | undefined> = [];
		const stop = seam.subscribeDevSeam((state) => seen.push(state?.landingBackground));
		try {
			ctx.patchDevContext({ enabled: true, landingBackground: "spotlight" });
			ctx.patchDevContext({ landingBackground: "auto" });
			ctx.setDevEnabled(false);
		} finally {
			stop();
		}
		assertEquals(seen, ["spotlight", "auto", undefined]);
	});
});

Deno.test("hydrate — a blob saved before the axis existed reads as auto", async () => {
	await withDocument((root) => {
		globalThis.sessionStorage.setItem(
			"pj.session.dev.contextOverrides",
			JSON.stringify({ enabled: true, accountType: "freelancer" }),
		);
		ctx.hydrateDevContext();
		assertEquals(ctx.devOverrides.value.landingBackground, "auto");
		assertFalse(root.attributes.has(ATTR));
		assertEquals(root.attributes.get("data-dev-persona"), "freelancer");
	});
});
// #endregion

// #region Read side
Deno.test("readDevSeam — an unknown attribute value reads as auto", async () => {
	await withDocument((root) => {
		root.dataset.devPersona = "client";
		root.dataset.devLandingBackground = "webgl";
		assertEquals(seam.readDevSeam()?.landingBackground, "auto");
	});
});

Deno.test("readDevSeam — a production build never reads the axis or subscribes", async () => {
	await withDocument((root) => {
		root.dataset.devPersona = "client";
		root.dataset.devLandingBackground = "spotlight";
		assert(root.attributes.has(ATTR));
		assertEquals(prodSeam.readDevSeam(), null);

		let calls = 0;
		const stop = prodSeam.subscribeDevSeam(() => calls++);
		globalThis.dispatchEvent(new CustomEvent(prodSeam.DEV_SEAM_EVENT));
		stop();
		assertEquals(calls, 0);
	});
});
// #endregion
