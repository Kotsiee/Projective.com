import { assertEquals } from "@std/assert";
import { CHANNEL_NAME_MAX } from "@projective/types/workspace";
import { channelHref, channelNameFrom, channelNameRefusal } from "./channel-model.ts";

/** The entity channels' client rules (Decision #306): the typed name's fold and its refusals. */

Deno.test("channels: a typed name folds to the address it will have", () => {
	assertEquals(channelNameFrom("Delivery Sync"), "delivery-sync");
	assertEquals(channelNameFrom("#client-updates"), "client-updates");
	assertEquals(channelNameFrom("  Café  & Co.  "), "cafe-co");
	assertEquals(channelNameFrom("---"), "");
	assertEquals(channelNameFrom("a".repeat(60)).length, CHANNEL_NAME_MAX);
	// A cut never leaves a trailing hyphen.
	assertEquals(channelNameFrom(`${"a".repeat(CHANNEL_NAME_MAX - 1)} b`).endsWith("-"), false);
});

Deno.test("channels: a name is refused before it is sent, never after", () => {
	const existing = [{ slug: "general" }, { slug: "delivery-sync" }];
	assertEquals(channelNameRefusal("", existing), "Give the channel a name.");
	assertEquals(channelNameRefusal("a", existing), "Channel names are at least 2 characters.");
	assertEquals(channelNameRefusal("general", existing), "# general already exists.");
	assertEquals(channelNameRefusal("client-updates", existing), null);
	assertEquals(channelHref("/teams/n/channels", "client-updates"), "/teams/n/channels/client-updates");
});
