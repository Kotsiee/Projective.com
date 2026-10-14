import { assertEquals } from "@std/assert";
import type { UserConnection } from "@projective/types/integrations";
import { DEFAULT_PROVIDER, providerChoices, providerOf } from "./conferencing-model.ts";

function connection(slug: string, patch: Partial<UserConnection> = {}): UserConnection {
	return {
		providerSlug: slug,
		status: "active",
		grantedKinds: ["conferencing"],
		...patch,
	} as UserConnection;
}

Deno.test("only active conferencing grants are offered, after My default", () => {
	const choices = providerChoices({
		connections: [
			connection("zoom"),
			connection("zoom"),
			connection("google", { grantedKinds: ["calendar"] }),
			connection("microsoft_teams", { status: "expired" }),
			connection("slack"),
		],
		activeConferencingProvider: "zoom",
	}, null);
	assertEquals(choices.options, [
		{ value: DEFAULT_PROVIDER, label: "My default (Zoom)" },
		{ value: "zoom", label: "Zoom" },
	]);
	assertEquals(choices.empty, false);
});

Deno.test("a stored provider stays listed when its connection lapsed; nothing at all is empty", () => {
	const lapsed = providerChoices({ connections: [], activeConferencingProvider: null }, "discord");
	assertEquals(lapsed.options[1], { value: "discord", label: "Discord (not connected)" });
	const none = providerChoices({ connections: [], activeConferencingProvider: null }, null);
	assertEquals(none, { options: [{ value: DEFAULT_PROVIDER, label: "My default" }], empty: true });
});

Deno.test("the default choice stores null", () => {
	assertEquals(providerOf(DEFAULT_PROVIDER), null);
	assertEquals(providerOf("zoom"), "zoom");
});
