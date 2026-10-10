import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { contentSecurityPolicy, cspHeaderFor, originOf } from "./csp.ts";

function directive(policy: string, name: string): string[] {
	const found = policy.split("; ").find((d) => d.startsWith(`${name} `));
	return found ? found.slice(name.length + 1).split(" ") : [];
}

Deno.test("csp: Stripe.js, the Payment Element frames and the Stripe API are allowed", () => {
	const policy = contentSecurityPolicy({ dev: false, supabaseOrigin: null });
	assert(directive(policy, "script-src").includes("https://js.stripe.com"));
	assert(directive(policy, "frame-src").includes("https://js.stripe.com"));
	assert(directive(policy, "frame-src").includes("https://hooks.stripe.com"));
	assert(directive(policy, "connect-src").includes("https://api.stripe.com"));
});

Deno.test("csp: nothing can frame the app, and plugins are off", () => {
	const policy = contentSecurityPolicy({ dev: false, supabaseOrigin: null });
	assertEquals(directive(policy, "frame-ancestors"), ["'none'"]);
	assertEquals(directive(policy, "object-src"), ["'none'"]);
});

Deno.test("csp: the Supabase origin reaches connect/img/media, and only the origin", () => {
	const origin = originOf("http://127.0.0.1:54321/storage/v1/object/x");
	assertEquals(origin, "http://127.0.0.1:54321");
	const policy = contentSecurityPolicy({ dev: true, supabaseOrigin: origin });
	for (const name of ["connect-src", "img-src", "media-src"]) {
		assert(directive(policy, name).includes("http://127.0.0.1:54321"), name);
	}
});

Deno.test("csp: development allows the HMR socket; production upgrades insecure requests instead", () => {
	const dev = contentSecurityPolicy({ dev: true, supabaseOrigin: null });
	const prod = contentSecurityPolicy({ dev: false, supabaseOrigin: null });
	assert(directive(dev, "connect-src").includes("ws:"));
	assert(!directive(prod, "connect-src").includes("ws:"));
	assertStringIncludes(prod, "upgrade-insecure-requests");
	assert(!dev.includes("upgrade-insecure-requests"));
});

Deno.test("csp: a non-http supabase value is ignored rather than widening the policy", () => {
	assertEquals(originOf("javascript:alert(1)"), null);
	assertEquals(originOf("not a url"), null);
});

Deno.test("csp: the platform policy allows neither wasm compilation nor blob: fetches", () => {
	const policy = contentSecurityPolicy({ dev: false, supabaseOrigin: null });
	assert(!directive(policy, "script-src").includes("'wasm-unsafe-eval'"));
	assert(!directive(policy, "connect-src").includes("blob:"));
	assertEquals(contentSecurityPolicy({ dev: false, supabaseOrigin: null, relax: {} }), policy);
});

Deno.test("csp: each relaxation adds exactly its own source and never JS eval", () => {
	const base = { dev: false, supabaseOrigin: null };
	const wasm = contentSecurityPolicy({ ...base, relax: { wasm: true } });
	assert(directive(wasm, "script-src").includes("'wasm-unsafe-eval'"));
	assert(!directive(wasm, "script-src").includes("'unsafe-eval'"));
	assert(!directive(wasm, "connect-src").includes("blob:"));
	const blob = contentSecurityPolicy({ ...base, relax: { blobConnect: true } });
	assert(directive(blob, "connect-src").includes("blob:"));
	assert(!directive(blob, "script-src").includes("'wasm-unsafe-eval'"));
});

Deno.test("csp: the inspector profile is the app profile plus wasm and blob: connect only", () => {
	const app = cspHeaderFor("app");
	const inspector = cspHeaderFor("inspector");
	assertEquals(cspHeaderFor("inspector"), inspector);
	assert(!directive(app, "script-src").includes("'wasm-unsafe-eval'"));
	assert(!directive(app, "connect-src").includes("blob:"));
	const appScript = directive(app, "script-src");
	assertEquals(directive(inspector, "script-src"), [
		...appScript.slice(0, 2),
		"'wasm-unsafe-eval'",
		...appScript.slice(2),
	]);
	assertEquals(directive(inspector, "connect-src"), [
		"'self'",
		"blob:",
		...directive(app, "connect-src").slice(1),
	]);
	const rest = (policy: string) =>
		policy.split("; ").filter((d) => !d.startsWith("script-src ") && !d.startsWith("connect-src "));
	assertEquals(rest(inspector), rest(app));
	assertEquals(directive(inspector, "frame-ancestors"), ["'none'"]);
	assertEquals(directive(inspector, "object-src"), ["'none'"]);
	assert(!directive(inspector, "script-src").includes("'unsafe-eval'"));
});
