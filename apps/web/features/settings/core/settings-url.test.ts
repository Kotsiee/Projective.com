import { assertEquals } from "@std/assert";
import {
	readSettingsParam,
	settingsModalAllowed,
	settingsParamSection,
	withSettingsParam,
} from "./settings-url.ts";

Deno.test("settings param — read, validate, and keep a malformed value visible", () => {
	assertEquals(readSettingsParam("?settings=messaging"), "messaging");
	assertEquals(readSettingsParam("?settings="), null);
	assertEquals(readSettingsParam("?w=x"), null);
	assertEquals(readSettingsParam("?settings=nope"), "nope");
	assertEquals(settingsParamSection("?settings=nope"), null);
	assertEquals(settingsParamSection("?a=1&settings=appearance"), "appearance");
});

Deno.test("withSettingsParam — sets, replaces and removes, preserving other params and the hash", () => {
	assertEquals(withSettingsParam("/messages", "messaging"), "/messages?settings=messaging");
	assertEquals(
		withSettingsParam("/wallet?w=abc&display=EUR#top", "verification"),
		"/wallet?w=abc&display=EUR&settings=verification#top",
	);
	assertEquals(
		withSettingsParam("/wallet?w=abc&settings=billing&tkv=tkt-1", "account"),
		"/wallet?w=abc&settings=account&tkv=tkt-1",
	);
	assertEquals(
		withSettingsParam("/wallet?w=abc&settings=billing&tkv=tkt-1", null),
		"/wallet?w=abc&tkv=tkt-1",
	);
	assertEquals(withSettingsParam("/messages?settings=messaging", null), "/messages");
});

Deno.test("withSettingsParam — idempotent", () => {
	const once = withSettingsParam("/a?x=1", "appearance");
	assertEquals(withSettingsParam(once, "appearance"), once);
	assertEquals(withSettingsParam("/a?x=1", null), "/a?x=1");
});

Deno.test("settingsModalAllowed — never over the console or the auth screens", () => {
	assertEquals(settingsModalAllowed("/messages"), true);
	assertEquals(settingsModalAllowed("/settings"), false);
	assertEquals(settingsModalAllowed("/settings/appearance"), false);
	assertEquals(settingsModalAllowed("/settingsx"), true);
	assertEquals(settingsModalAllowed("/login"), false);
});
