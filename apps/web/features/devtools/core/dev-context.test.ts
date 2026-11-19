/// <reference lib="dom" />
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	CHECKOUT_PAYMENT_SIM_COOKIE,
	FX_CHECKOUT_OVERRIDE_COOKIE,
	parseCheckoutPaymentSim,
	parseFxCheckoutOverride,
} from "@projective/types/finance";
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
const ATTR = "data-dev-wallet-aurora";

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
Deno.test("walletAurora — the inert default is auto", () => {
	assertEquals(ctx.DEV_DEFAULTS.walletAurora, "auto");
	assertEquals(ctx.devOverrides.value.walletAurora, "auto");
});
// #endregion

// #region reflect()
Deno.test("reflect — writes data-dev-wallet-aurora only while it overrides, and deletes it", async () => {
	await withDocument((root) => {
		ctx.patchDevContext({ enabled: true, walletAurora: "animated" });
		assertEquals(root.attributes.get(ATTR), "animated");
		assertEquals(seam.readDevSeam()?.walletAurora, "animated");

		ctx.patchDevContext({ walletAurora: "static" });
		assertEquals(root.attributes.get(ATTR), "static");
		assertEquals(seam.readDevSeam()?.walletAurora, "static");

		// `auto` is the ABSENT attribute, never the stamped word.
		ctx.patchDevContext({ walletAurora: "auto" });
		assertFalse(root.attributes.has(ATTR));
		assertEquals(seam.readDevSeam()?.walletAurora, "auto");
	});
});

Deno.test("reflect — switching simulation off deletes the attribute; switching it on restores it", async () => {
	await withDocument((root) => {
		ctx.patchDevContext({ enabled: true, walletAurora: "animated" });
		ctx.setDevEnabled(false);
		assertFalse(root.attributes.has(ATTR));
		assertEquals(seam.readDevSeam(), null);

		ctx.setDevEnabled(true);
		assertEquals(root.attributes.get(ATTR), "animated");
	});
});

Deno.test("reflect — a reset deletes the attribute and returns the store to auto", async () => {
	await withDocument((root) => {
		ctx.patchDevContext({ enabled: true, walletAurora: "static" });
		ctx.resetDevContext();
		assertFalse(root.attributes.has(ATTR));
		assertEquals(ctx.devOverrides.value.walletAurora, "auto");
	});
});

Deno.test("reflect — subscribers receive the decoded value on every change", async () => {
	await withDocument(() => {
		const seen: Array<string | undefined> = [];
		const stop = seam.subscribeDevSeam((state) => seen.push(state?.walletAurora));
		try {
			ctx.patchDevContext({ enabled: true, walletAurora: "animated" });
			ctx.patchDevContext({ walletAurora: "auto" });
			ctx.setDevEnabled(false);
		} finally {
			stop();
		}
		assertEquals(seen, ["animated", "auto", undefined]);
	});
});

Deno.test("hydrate — a blob saved before the axis existed reads as auto", async () => {
	await withDocument((root) => {
		globalThis.sessionStorage.setItem(
			"pj.session.dev.contextOverrides",
			JSON.stringify({ enabled: true, accountType: "freelancer" }),
		);
		ctx.hydrateDevContext();
		assertEquals(ctx.devOverrides.value.walletAurora, "auto");
		assertFalse(root.attributes.has(ATTR));
		assertEquals(root.attributes.get("data-dev-persona"), "freelancer");
	});
});
// #endregion

// #region Read side
Deno.test("readDevSeam — an unknown attribute value reads as auto", async () => {
	await withDocument((root) => {
		root.dataset.devPersona = "client";
		root.dataset.devWalletAurora = "webgl";
		assertEquals(seam.readDevSeam()?.walletAurora, "auto");
	});
});

Deno.test("readDevSeam — a production build never reads the axis or subscribes", async () => {
	await withDocument((root) => {
		root.dataset.devPersona = "client";
		root.dataset.devWalletAurora = "animated";
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

// #region checkoutPayment (Pay's answer, server-side through a cookie, FINANCE_AUDIT CO29)
const PAYMENT_ATTR = "data-dev-checkout-payment";

/** Run `fn` against a fake `document` whose cookie writes are recorded in order. */
async function withCookieJar(
	fn: (root: ReturnType<typeof fakeRoot>, writes: string[]) => void | Promise<void>,
) {
	const root = fakeRoot();
	const writes: string[] = [];
	Object.defineProperty(globalThis, "document", {
		value: {
			documentElement: root,
			get cookie() {
				return "";
			},
			set cookie(value: string) {
				writes.push(value);
			},
		},
		configurable: true,
		writable: true,
	});
	try {
		await fn(root, writes);
	} finally {
		ctx.resetDevContext();
		delete (globalThis as { document?: unknown }).document;
	}
}

/** The last write of the checkout-payment cookie. */
function lastPaymentCookie(writes: readonly string[]): string | undefined {
	return writes.filter((w) => w.startsWith(`${CHECKOUT_PAYMENT_SIM_COOKIE}=`)).at(-1);
}

Deno.test("checkoutPayment — the inert default is ok; every other option is a simulation the route reads", () => {
	assertEquals(ctx.DEV_DEFAULTS.checkoutPayment, "ok");
	assertEquals(ctx.DEV_CHECKOUT_PAYMENTS.map((o) => o.value), [
		"ok",
		"declined",
		"authenticate",
		"timeout",
		"unapplied",
		"price_changed",
		"promo_exhausted",
		"promo_already_used",
	]);
	for (const { value } of ctx.DEV_CHECKOUT_PAYMENTS) {
		assertEquals(parseCheckoutPaymentSim(value), value === "ok" ? null : value);
	}
});

Deno.test("checkoutPayment — reflect writes the attribute and the cookie while it simulates, and deletes both", async () => {
	await withCookieJar((root, writes) => {
		ctx.patchDevContext({ enabled: true, checkoutPayment: "declined" });
		assertEquals(root.attributes.get(PAYMENT_ATTR), "declined");
		assertEquals(seam.readDevSeam()?.checkoutPayment, "declined");
		assertEquals(
			lastPaymentCookie(writes),
			`${CHECKOUT_PAYMENT_SIM_COOKIE}=declined; path=/; samesite=lax`,
		);

		ctx.patchDevContext({ checkoutPayment: "promo_exhausted" });
		assertEquals(
			lastPaymentCookie(writes),
			`${CHECKOUT_PAYMENT_SIM_COOKIE}=promo_exhausted; path=/; samesite=lax`,
		);

		// `ok` is the ABSENT attribute and no cookie, never the stamped word.
		ctx.patchDevContext({ checkoutPayment: "ok" });
		assertFalse(root.attributes.has(PAYMENT_ATTR));
		assertEquals(seam.readDevSeam()?.checkoutPayment, "ok");
		assertEquals(
			lastPaymentCookie(writes),
			`${CHECKOUT_PAYMENT_SIM_COOKIE}=; path=/; max-age=0; samesite=lax`,
		);
	});
});

Deno.test("checkoutPayment — switching simulation off deletes the attribute and removes the cookie", async () => {
	await withCookieJar((root, writes) => {
		ctx.patchDevContext({ enabled: true, checkoutPayment: "timeout" });
		ctx.setDevEnabled(false);
		assertFalse(root.attributes.has(PAYMENT_ATTR));
		assertEquals(
			lastPaymentCookie(writes),
			`${CHECKOUT_PAYMENT_SIM_COOKIE}=; path=/; max-age=0; samesite=lax`,
		);
	});
});

Deno.test("checkoutPayment — an unknown attribute or cookie value reads as no simulation", async () => {
	await withDocument((root) => {
		root.dataset.devPersona = "client";
		root.dataset.devCheckoutPayment = "refund";
		assertEquals(seam.readDevSeam()?.checkoutPayment, "ok");
	});
	assertEquals(parseCheckoutPaymentSim("refund"), null);
	assertEquals(parseCheckoutPaymentSim(undefined), null);
	assertEquals(parseCheckoutPaymentSim(" timeout "), "timeout");
});
// #endregion

// #region fxCheckout (paying in one's own currency, server-side through a cookie, Decision #436)
const FX_ATTR = "data-dev-fx-checkout";

/** The last write of the FX checkout cookie. */
function lastFxCookie(writes: readonly string[]): string | undefined {
	return writes.filter((w) => w.startsWith(`${FX_CHECKOUT_OVERRIDE_COOKIE}=`)).at(-1);
}

Deno.test("fxCheckout — the inert default is auto; on and off are overrides the server reads", () => {
	assertEquals(ctx.DEV_DEFAULTS.fxCheckout, "auto");
	assertEquals(ctx.DEV_FX_CHECKOUTS.map((o) => o.value), ["auto", "on", "off"]);
	for (const { value } of ctx.DEV_FX_CHECKOUTS) {
		assertEquals(parseFxCheckoutOverride(value), value === "auto" ? null : value);
	}
});

Deno.test("fxCheckout — reflect writes the attribute and the cookie while it overrides, and deletes both", async () => {
	await withCookieJar((root, writes) => {
		ctx.patchDevContext({ enabled: true, fxCheckout: "on" });
		assertEquals(root.attributes.get(FX_ATTR), "on");
		assertEquals(seam.readDevSeam()?.fxCheckout, "on");
		assertEquals(lastFxCookie(writes), `${FX_CHECKOUT_OVERRIDE_COOKIE}=on; path=/; samesite=lax`);

		ctx.patchDevContext({ fxCheckout: "off" });
		assertEquals(lastFxCookie(writes), `${FX_CHECKOUT_OVERRIDE_COOKIE}=off; path=/; samesite=lax`);

		ctx.patchDevContext({ fxCheckout: "auto" });
		assertFalse(root.attributes.has(FX_ATTR));
		assertEquals(seam.readDevSeam()?.fxCheckout, "auto");
		assertEquals(
			lastFxCookie(writes),
			`${FX_CHECKOUT_OVERRIDE_COOKIE}=; path=/; max-age=0; samesite=lax`,
		);
	});
});

Deno.test("fxCheckout — switching simulation off deletes the attribute and removes the cookie", async () => {
	await withCookieJar((root, writes) => {
		ctx.patchDevContext({ enabled: true, fxCheckout: "on" });
		ctx.setDevEnabled(false);
		assertFalse(root.attributes.has(FX_ATTR));
		assertEquals(
			lastFxCookie(writes),
			`${FX_CHECKOUT_OVERRIDE_COOKIE}=; path=/; max-age=0; samesite=lax`,
		);
	});
});

Deno.test("fxCheckout — an unknown attribute or cookie value reads as no override", async () => {
	await withDocument((root) => {
		root.dataset.devPersona = "client";
		root.dataset.devFxCheckout = "maybe";
		assertEquals(seam.readDevSeam()?.fxCheckout, "auto");
	});
	assertEquals(parseFxCheckoutOverride("maybe"), null);
	assertEquals(parseFxCheckoutOverride(undefined), null);
	assertEquals(parseFxCheckoutOverride(" off "), "off");
});
// #endregion

// #region fileAccess (the inspector's Access tab, Decision #402)
const FILE_ACCESS_ATTR = "data-dev-file-access";

Deno.test("fileAccess — reflect writes the standing while it simulates, and deletes it on auto and off", async () => {
	await withDocument((root) => {
		assertEquals(ctx.DEV_DEFAULTS.fileAccess, "auto");
		ctx.patchDevContext({ enabled: true, fileAccess: "editor" });
		assertEquals(root.attributes.get(FILE_ACCESS_ATTR), "editor");
		assertEquals(seam.readDevSeam()?.fileAccess, "editor");

		ctx.patchDevContext({ fileAccess: "auto" });
		assertFalse(root.attributes.has(FILE_ACCESS_ATTR));
		assertEquals(seam.readDevSeam()?.fileAccess, "auto");

		ctx.patchDevContext({ fileAccess: "signed-out" });
		ctx.setDevEnabled(false);
		assertFalse(root.attributes.has(FILE_ACCESS_ATTR));
	});
});

Deno.test("fileAccess — an unknown attribute value reads as auto", async () => {
	await withDocument((root) => {
		root.dataset.devPersona = "client";
		root.dataset.devFileAccess = "admin";
		assertEquals(seam.readDevSeam()?.fileAccess, "auto");
	});
});
// #endregion

// #region termsAcceptance (the re-accept gate, server-side through a cookie, Decision #446)
const TERMS_ATTR = "data-dev-terms";

Deno.test("termsAcceptance — auto is inert; due and current reach the server through pj.dev.terms", async () => {
	assertEquals(ctx.DEV_DEFAULTS.termsAcceptance, "auto");
	assertEquals(ctx.DEV_TERMS_ACCEPTANCES.map((o) => o.value), ["auto", "due", "current"]);
	const last = (writes: readonly string[]) => writes.filter((w) => w.startsWith("pj.dev.terms=")).at(-1);
	await withCookieJar((root, writes) => {
		ctx.patchDevContext({ enabled: true, termsAcceptance: "due" });
		assertEquals(root.attributes.get(TERMS_ATTR), "due");
		assertEquals(seam.readDevSeam()?.termsAcceptance, "due");
		assertEquals(last(writes), "pj.dev.terms=due; path=/; samesite=lax");

		ctx.patchDevContext({ termsAcceptance: "auto" });
		assertFalse(root.attributes.has(TERMS_ATTR));
		assertEquals(last(writes), "pj.dev.terms=; path=/; max-age=0; samesite=lax");

		ctx.patchDevContext({ termsAcceptance: "current" });
		ctx.setDevEnabled(false);
		assertFalse(root.attributes.has(TERMS_ATTR));
		assertEquals(last(writes), "pj.dev.terms=; path=/; max-age=0; samesite=lax");
	});
});
// #endregion

// #region captcha (the auth forms' bot check, server-side through a cookie, Decision #447)
const CAPTCHA_ATTR = "data-dev-captcha";

Deno.test("captcha — auto is inert; pass, fail and interactive reach the server through pj.dev.captcha", async () => {
	assertEquals(ctx.DEV_DEFAULTS.captcha, "auto");
	assertEquals(ctx.DEV_CAPTCHAS.map((o) => o.value), ["auto", "pass", "fail", "interactive"]);
	const last = (writes: readonly string[]) => writes.filter((w) => w.startsWith("pj.dev.captcha=")).at(-1);
	await withCookieJar((root, writes) => {
		ctx.patchDevContext({ enabled: true, captcha: "fail" });
		assertEquals(root.attributes.get(CAPTCHA_ATTR), "fail");
		assertEquals(seam.readDevSeam()?.captcha, "fail");
		assertEquals(last(writes), "pj.dev.captcha=fail; path=/; samesite=lax");

		ctx.patchDevContext({ captcha: "auto" });
		assertFalse(root.attributes.has(CAPTCHA_ATTR));
		assertEquals(last(writes), "pj.dev.captcha=; path=/; max-age=0; samesite=lax");

		ctx.patchDevContext({ captcha: "interactive" });
		ctx.setDevEnabled(false);
		assertFalse(root.attributes.has(CAPTCHA_ATTR));
		assertEquals(last(writes), "pj.dev.captcha=; path=/; max-age=0; samesite=lax");
	});
});
// #endregion

// #region notificationDelivery (Settings → Notifications' channel liveness, server-side through a cookie)
const DELIVERY_ATTR = "data-dev-notification-delivery";
const DELIVERY_COOKIE = "pj.dev.notification-delivery";

Deno.test("notificationDelivery — auto is inert; live and off reach the server through pj.dev.notification-delivery", async () => {
	assertEquals(ctx.DEV_DEFAULTS.notificationDelivery, "auto");
	assertEquals(ctx.DEV_NOTIFICATION_DELIVERIES.map((o) => o.value), ["auto", "live", "off"]);
	const last = (writes: readonly string[]) =>
		writes.filter((w) => w.startsWith(`${DELIVERY_COOKIE}=`)).at(-1);
	await withCookieJar((root, writes) => {
		ctx.patchDevContext({ enabled: true, notificationDelivery: "live" });
		assertEquals(root.attributes.get(DELIVERY_ATTR), "live");
		assertEquals(seam.readDevSeam()?.notificationDelivery, "live");
		assertEquals(last(writes), `${DELIVERY_COOKIE}=live; path=/; samesite=lax`);

		ctx.patchDevContext({ notificationDelivery: "auto" });
		assertFalse(root.attributes.has(DELIVERY_ATTR));
		assertEquals(seam.readDevSeam()?.notificationDelivery, "auto");
		assertEquals(last(writes), `${DELIVERY_COOKIE}=; path=/; max-age=0; samesite=lax`);

		ctx.patchDevContext({ notificationDelivery: "off" });
		assertEquals(last(writes), `${DELIVERY_COOKIE}=off; path=/; samesite=lax`);
		ctx.setDevEnabled(false);
		assertFalse(root.attributes.has(DELIVERY_ATTR));
		assertEquals(last(writes), `${DELIVERY_COOKIE}=; path=/; max-age=0; samesite=lax`);
	});
});
// #endregion
