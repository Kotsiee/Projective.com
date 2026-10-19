/**
 * The per-IP rate-limit key (Decision #296 (F)): a real peer is its own key, and the dev server's
 * peer header is read only for Fresh's placeholder address, so it can never be forged in production.
 */
import { assert, assertEquals } from "@std/assert";
import { clientKey, DEV_REMOTE_HEADER, isPlaceholderAddr } from "./client-key.ts";

const placeholder: Deno.Addr = { transport: "tcp", hostname: "localhost", port: 1234 };

Deno.test("clientKey: a real peer's hostname, a unix socket's transport", () => {
	assertEquals(
		clientKey({ transport: "tcp", hostname: "203.0.113.7", port: 51234 }),
		"203.0.113.7",
	);
	assertEquals(clientKey({ transport: "udp", hostname: "2001:db8::1", port: 443 }), "2001:db8::1");
	assertEquals(clientKey({ transport: "unix", path: "/tmp/app.sock" }), "unix");
});

Deno.test("clientKey: the dev peer header splits Fresh's one placeholder bucket", () => {
	assert(isPlaceholderAddr(placeholder));
	const a = new Headers({ [DEV_REMOTE_HEADER]: "127.0.0.11" });
	const b = new Headers({ [DEV_REMOTE_HEADER]: " ::ffff:127.0.0.12 " });
	assertEquals(clientKey(placeholder, a), "127.0.0.11");
	assertEquals(clientKey(placeholder, b), "::ffff:127.0.0.12");
	assertEquals(clientKey(placeholder), "localhost", "no header: the placeholder, as before");
	assertEquals(clientKey(placeholder, new Headers({ [DEV_REMOTE_HEADER]: "  " })), "localhost");
});

Deno.test("clientKey: a real peer never reads the header, so it cannot be forged", () => {
	const forged = new Headers({ [DEV_REMOTE_HEADER]: "198.51.100.1" });
	const real: Deno.Addr = { transport: "tcp", hostname: "203.0.113.7", port: 51234 };
	assertEquals(clientKey(real, forged), "203.0.113.7");
	// Even a real loopback peer on another port is a peer, not the placeholder.
	const loopback: Deno.Addr = { transport: "tcp", hostname: "localhost", port: 51000 };
	assertEquals(isPlaceholderAddr(loopback), false);
	assertEquals(clientKey(loopback, forged), "localhost");
});

Deno.test("the dev-server plugin writes the header this helper reads", async () => {
	const config = await Deno.readTextFile(new URL("../../../vite.config.ts", import.meta.url));
	assert(config.includes(`"${DEV_REMOTE_HEADER}"`), "vite.config.ts names the same header");
	assert(config.includes("projective:dev-client-address"));
	const listed = config.lastIndexOf("devClientAddress(),");
	assert(
		listed > 0 && listed < config.lastIndexOf("fresh({"),
		"the plugin is listed ahead of fresh(), so its middleware runs before the app's",
	);
});
