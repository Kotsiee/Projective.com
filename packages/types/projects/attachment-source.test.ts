import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	ATTACHMENT_SOURCE_EXCERPT_MAX,
	attachmentSourceExcerpt,
	AttachmentSourceSchema,
	MessageAttachmentSchema,
} from "./messages.ts";
import { assetIdOf, AssetItemSchema } from "../files/assets.ts";

const UUID = "7a010c3d-0a24-4910-a512-71b47c30fc63";

// #region assetIdOf
Deno.test("assetIdOf: a files.items uuid passes; anything else is null", () => {
	assertEquals(assetIdOf(UUID), UUID);
	for (const raw of [null, undefined, "", "a-1", "m1-img-0", "prj-67ss4hwneu", `${UUID}x`]) {
		assertEquals(assetIdOf(raw), null);
	}
});

Deno.test("AssetItemSchema.assetId is optional, nullable and uuid-checked", () => {
	const shape = AssetItemSchema.shape.assetId;
	assert(shape.safeParse(undefined).success);
	assert(shape.safeParse(null).success);
	assert(shape.safeParse(UUID).success);
	assertFalse(shape.safeParse("a-1").success);
});
// #endregion

// #region MessageAttachment
Deno.test("MessageAttachmentSchema accepts a legacy tile and a tile with the new facts", () => {
	const legacy = {
		id: "m1-img-0",
		kind: "image",
		url: "https://x/y.jpg",
		name: "y.jpg",
		ext: "jpg",
		width: 4,
		height: 3,
	};
	assert(MessageAttachmentSchema.safeParse(legacy).success);
	assert(
		MessageAttachmentSchema.safeParse({
			...legacy,
			assetId: UUID,
			mimeType: "image/jpeg",
			blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
		}).success,
	);
	assertFalse(MessageAttachmentSchema.safeParse({ ...legacy, assetId: "m1-img-0" }).success);
	assertFalse(MessageAttachmentSchema.safeParse({ ...legacy, blurhash: "<script>" }).success);
});
// #endregion

// #region Excerpt
Deno.test("attachmentSourceExcerpt folds whitespace and keeps short bodies whole", () => {
	assertEquals(
		attachmentSourceExcerpt("  Here's the\n\nposter   draft \t"),
		"Here's the poster draft",
	);
	assertEquals(attachmentSourceExcerpt(null), "");
	assertEquals(attachmentSourceExcerpt(""), "");
});

Deno.test("attachmentSourceExcerpt cuts long bodies on a word, within the bound", () => {
	const body = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
	const out = attachmentSourceExcerpt(body);
	assert(out.length <= ATTACHMENT_SOURCE_EXCERPT_MAX);
	assert(out.endsWith("…"));
	assert(body.startsWith(out.slice(0, -1)));
	assertFalse(out.slice(0, -1).endsWith(" "));
	const unbroken = attachmentSourceExcerpt("x".repeat(400));
	assertEquals(unbroken.length, ATTACHMENT_SOURCE_EXCERPT_MAX);
});
// #endregion

// #region Schema
Deno.test("AttachmentSourceSchema: a DM and a project source parse; an over-long excerpt does not", () => {
	const base = {
		messageId: "e8d7c7f7-f84a-44d6-b4ac-d51b16b8219d",
		kind: "project",
		conversationId: "178b022d-abe2-4784-bbef-d740aa0ed5c0",
		channelLabel: "Concepts",
		sender: { id: "u-1", name: "Chloe Winters", handle: "chloewinters", avatarSrc: null },
		createdAt: "2026-10-09T12:00:00.000Z",
		dayLabel: "Yesterday",
		timeLabel: "12:00 PM",
		excerpt: "Here's the poster",
		href: "/projects/prj-67ss4hwneu/stg-3f4gvyycwv/chat?m=e8d7c7f7-f84a-44d6-b4ac-d51b16b8219d",
	};
	assert(AttachmentSourceSchema.safeParse(base).success);
	assert(AttachmentSourceSchema.safeParse({ ...base, kind: "dm", channelLabel: null }).success);
	assertFalse(AttachmentSourceSchema.safeParse({ ...base, excerpt: "x".repeat(281) }).success);
	assertFalse(AttachmentSourceSchema.safeParse({ ...base, href: "" }).success);
});
// #endregion
