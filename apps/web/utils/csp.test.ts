import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { contentSecurityPolicy, originOf } from "./csp.ts";

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
