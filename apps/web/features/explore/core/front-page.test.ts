import { assertEquals } from "@std/assert";
import { frontPageRedirect } from "./front-page.ts";

const at = (path: string) => new URL(path, "https://projective.test");

Deno.test("a guest on / with no query renders the Explore Home", () => {
	assertEquals(frontPageRedirect(at("/"), false), null);
	assertEquals(frontPageRedirect(at("/?utm_source=x"), false), null);
});

Deno.test("a signed-in visitor is sent to /explore, the query kept", () => {
	assertEquals(frontPageRedirect(at("/"), true), "/explore");
	assertEquals(frontPageRedirect(at("/?tkv=tkt-abc"), true), "/explore?tkv=tkt-abc");
});

Deno.test("a search on / lands on /explore's results for everyone", () => {
	assertEquals(frontPageRedirect(at("/?q=logo"), false), "/explore?q=logo");
	assertEquals(frontPageRedirect(at("/?category=services"), false), "/explore?category=services");
});

Deno.test("a ?demo= link opens the stage on /features, before any session rule", () => {
	assertEquals(frontPageRedirect(at("/?demo=payments"), false), "/features?demo=payments#demo");
	assertEquals(frontPageRedirect(at("/?demo=payments&q=a"), true), "/features?demo=payments#demo");
	assertEquals(frontPageRedirect(at("/?demo=a%20b"), false), "/features?demo=a+b#demo");
});
