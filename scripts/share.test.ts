import { assert, assertEquals, assertFalse } from "@std/assert";
import { storageAllowed, tunnelUrl } from "./share.ts";

Deno.test("tunnelUrl: finds the assigned host, never cloudflared's own API host", () => {
	assertEquals(
		tunnelUrl("failed to request quick Tunnel: Post https://api.trycloudflare.com/tunnel"),
		null,
	);
	assertEquals(
		tunnelUrl("|  https://cold-river-blue-sky.trycloudflare.com  |"),
		"https://cold-river-blue-sky.trycloudflare.com",
	);
	// Split across stderr chunks: matches only once the whole host has arrived.
	assertEquals(tunnelUrl("|  https://cold-river-blue-sky.trycloudflare.co"), null);
});

Deno.test("storageAllowed: only the browser-facing storage routes, with their methods", () => {
	assert(storageAllowed("GET", "/storage/v1/object/public/avatars/u/a.png"));
	assert(storageAllowed("HEAD", "/storage/v1/object/sign/project/p/brief.pdf"));
	assert(storageAllowed("PUT", "/storage/v1/object/upload/sign/project/p/new.png"));
	assert(storageAllowed("OPTIONS", "/storage/v1/object/upload/sign/project/p/new.png"));

	assertFalse(storageAllowed("DELETE", "/storage/v1/object/public/avatars/u/a.png"));
	assertFalse(storageAllowed("PUT", "/storage/v1/object/public/avatars/u/a.png"));
	assertFalse(storageAllowed("GET", "/storage/v1/bucket"));
	assertFalse(storageAllowed("GET", "/rest/v1/profiles"));
	assertFalse(storageAllowed("GET", "/auth/v1/admin/users"));
	assertFalse(storageAllowed("GET", "/pg/tables"));
	assertFalse(storageAllowed("GET", "/storage/v1/object/public/..%2F..%2F..%2Frest/v1/profiles"));
	assertFalse(storageAllowed("GET", "/storage/v1/object/public/..%5c..%5crest/v1/profiles"));
});
