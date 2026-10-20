import { assertEquals } from "@std/assert";
import { CHANNEL_NAME_MAX } from "@projective/types/workspace";
import {
	channelEditChanged,
	channelEditRefusals,
	channelHref,
	channelMarkOf,
	channelNameFrom,
	channelNameRefusal,
	channelTabHref,
	channelTabOfPath,
} from "./channel-model.ts";

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

// #region Views, marks and edits (Decision #308)
Deno.test("channels: a channel's views are addresses — Chat at its root, Files beneath it", () => {
	assertEquals(channelTabOfPath("/teams/north-loop/channels/general"), "chat");
	assertEquals(channelTabOfPath("/teams/north-loop/channels/general/files"), "files");
	assertEquals(channelTabOfPath("/businesses/acme/channels/general/files/"), "files");
	assertEquals(channelTabOfPath("/teams/north-loop/channels/general/nonsense"), "chat");
	assertEquals(channelTabHref("/teams/n/channels/general", "chat"), "/teams/n/channels/general");
	assertEquals(channelTabHref("/teams/n/channels/general", "files"), "/teams/n/channels/general/files");
});

Deno.test("channels: the mark is the image, else the emoji, else the #", () => {
	assertEquals(channelMarkOf({ avatar: "https://x/y.webp", emoji: "🚀" }), {
		kind: "photo",
		src: "https://x/y.webp",
	});
	assertEquals(channelMarkOf({ avatar: null, emoji: "🚀" }), { kind: "emoji", emoji: "🚀" });
	assertEquals(channelMarkOf({}), { kind: "hash" });
});

Deno.test("channels: an edit is refused per field before it is sent, as update_entity_channel would", () => {
	assertEquals(channelEditRefusals({ name: "Team room", topic: "", emoji: "🚀" }), {});
	assertEquals(channelEditRefusals({ name: "", topic: "", emoji: "" }), {});
	assertEquals(
		Object.keys(channelEditRefusals({ name: "a".repeat(61), topic: "b".repeat(201), emoji: "ab" })),
		["name", "topic", "emoji"],
	);
	// A flag or a skin-toned emoji is several code units and still one emoji.
	assertEquals(channelEditRefusals({ name: "", topic: "", emoji: "👍🏽" }), {});
});

Deno.test("channels: an untouched draft changes nothing, a trimmed one compares as stored", () => {
	const channel = { name: "Team room", topic: null, emoji: null };
	assertEquals(channelEditChanged(channel, { name: " Team room ", topic: "", emoji: "" }), false);
	assertEquals(channelEditChanged(channel, { name: "Team room", topic: "Ships", emoji: "" }), true);
	assertEquals(channelEditChanged({ name: null, topic: null, emoji: null }, { name: "", topic: "", emoji: "" }), false);
});
// #endregion
