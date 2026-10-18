/**
 * strip-tkv.test — the landing routes' `?tkv=` redirect: absent means render, present means a 303 to
 * the same path with every other parameter kept verbatim.
 */
import { assertEquals } from "@std/assert";
import { tkvRedirect } from "./strip-tkv.ts";

// #region Helpers
const ORIGIN = "http://localhost:3000";

/** The redirect's status and `Location` for a path + query, or `null` when there is none. */
function redirectOf(href: string): { status: number; location: string | null } | null {
	const response = tkvRedirect(new URL(href, ORIGIN));
	return response === null
		? null
		: { status: response.status, location: response.headers.get("location") };
}
// #endregion

// #region Absent
Deno.test("tkvRedirect renders a URL with no tkv parameter", () => {
	assertEquals(redirectOf("/"), null);
	assertEquals(redirectOf("/?"), null);
	assertEquals(redirectOf("/?q=brand+identity&category=services"), null);
	assertEquals(redirectOf("/features?demo=board"), null);
});

Deno.test("tkvRedirect ignores names and values that only contain tkv", () => {
	assertEquals(redirectOf("/?xtkv=1&tkvx=2"), null);
	assertEquals(redirectOf("/?q=tkv&note=tkv%3Dtkt-abc"), null);
});
// #endregion

// #region Present
Deno.test("tkvRedirect answers a sole tkv with a bodiless 303 to the bare path", () => {
	const response = tkvRedirect(new URL("/?tkv=tkt-abcdefghij", ORIGIN));
	assertEquals(response?.status, 303);
	assertEquals(response?.headers.get("location"), "/");
	assertEquals(response?.body, null);
});

Deno.test("tkvRedirect keeps every other parameter byte for byte and in order", () => {
	assertEquals(redirectOf("/?q=brand+identity&tkv=tkt-abcdefghij&category=services"), {
		status: 303,
		location: "/?q=brand+identity&category=services",
	});
	assertEquals(redirectOf("/features?demo=board&tkv=x&q=%E2%9C%93"), {
		status: 303,
		location: "/features?demo=board&q=%E2%9C%93",
	});
});

Deno.test("tkvRedirect drops empty, bare, repeated and encoded tkv pairs", () => {
	assertEquals(redirectOf("/?tkv&a=1&tkv=&tkv=tkt-x&&b=2"), { status: 303, location: "/?a=1&b=2" });
	assertEquals(redirectOf("/?%74kv=tkt-abcdefghij"), { status: 303, location: "/" });
	assertEquals(redirectOf("/?a=%zz&tkv=1"), { status: 303, location: "/?a=%zz" });
});

Deno.test("tkvRedirect leaves the fragment out and never emits a protocol-relative Location", () => {
	assertEquals(redirectOf("/?tkv=1#how-it-works"), { status: 303, location: "/" });
	const doubled = tkvRedirect(new URL(`${ORIGIN}//evil.example/?tkv=1&q=a`));
	assertEquals(doubled?.headers.get("location"), "/evil.example/?q=a");
});
// #endregion
