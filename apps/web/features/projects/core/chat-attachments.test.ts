import { assertEquals } from "@std/assert";
import type { ChatMessage, MessageAttachment } from "@projective/types/projects";
import {
	attachmentItems,
	attachmentOpenHref,
	attachmentPicture,
	attachmentPlaceholder,
	chatFeedScope,
	chatPreviewContext,
} from "./chat-attachments.ts";

// #region Fixtures
const ASSET = "8b0c5a3e-1f2d-4c6b-9a7e-2d3f4a5b6c7d";
const LINK_ROW = "11111111-2222-4333-8444-555555555555";
const CONVERSATION = "22222222-3333-4444-8555-666666666666";
const HASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

function attachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
	return {
		id: LINK_ROW,
		kind: "image",
		url: `/api/media/proxy/${ASSET}?tier=md`,
		name: "poster.png",
		ext: "png",
		width: 2400,
		height: 1600,
		assetId: ASSET,
		mimeType: "image/png",
		blurhash: HASH,
		...overrides,
	};
}

function message(
	attachments: MessageAttachment[],
	overrides: Partial<ChatMessage> = {},
): ChatMessage {
	return {
		id: "msg-1",
		type: "user",
		createdAt: "2026-10-09T14:30:00.000Z",
		timeLabel: "2:30 PM",
		dayLabel: "Yesterday",
		sender: { id: "user-1", name: "Chloe Winters", avatar: null, handle: "chloe" },
		isOwn: false,
		text: "Here is the poster",
		delta: null,
		replyTo: null,
		attachments,
		audio: null,
		system: null,
		reactions: [],
		pinned: false,
		favorited: false,
		...overrides,
	};
}
// #endregion

// #region Scope
Deno.test("chatFeedScope: a conversation mounts with one id for both keys", () => {
	assertEquals(chatFeedScope(CONVERSATION, CONVERSATION).kind, "conversation");
	assertEquals(chatFeedScope("prj-abcdefghij", "stg-3f4gvyycwv").kind, "project");
});

Deno.test("chatPreviewContext: a conversation previews as messages, a room as its project", () => {
	assertEquals(chatPreviewContext(chatFeedScope(CONVERSATION, CONVERSATION)), {
		kind: "messages",
		conversationId: CONVERSATION,
	});
	assertEquals(chatPreviewContext(chatFeedScope("prj-abcdefghij", "discussion")), {
		kind: "project",
		projectSlug: "prj-abcdefghij",
	});
});
// #endregion

// #region Tiles
Deno.test("attachmentPicture: a stored image reads the proxy's md rendition with candidates", () => {
	const picture = attachmentPicture(attachment());
	assertEquals(picture.src, `/api/media/proxy/${ASSET}?tier=md`);
	assertEquals(picture.srcset?.startsWith(`/api/media/proxy/${ASSET}?tier=sm `), true);
});

Deno.test("attachmentPicture: a stored video never puts its bytes in an img", () => {
	const picture = attachmentPicture(
		attachment({ kind: "video", url: `/api/media/proxy/${ASSET}`, ext: "mp4" }),
	);
	assertEquals(picture, { src: null, srcset: null });
});

Deno.test("attachmentPicture: a fixture tile draws its own address, never the link row id", () => {
	const fixture = attachment({ assetId: undefined, url: "https://images.example/p.jpg" });
	assertEquals(attachmentPicture(fixture), { src: "https://images.example/p.jpg", srcset: null });
	const video = attachment({ assetId: null, kind: "video", url: "https://images.example/v.jpg" });
	assertEquals(attachmentPicture(video).src, "https://images.example/v.jpg");
});

Deno.test("attachmentPicture: a file tile draws no picture", () => {
	assertEquals(attachmentPicture(attachment({ kind: "pdf", ext: "pdf" })).src, null);
});

Deno.test("attachmentPlaceholder: the upload's BlurHash, else nothing", () => {
	assertEquals(attachmentPlaceholder(attachment()), { blurhash: HASH, color: null });
	assertEquals(attachmentPlaceholder(attachment({ blurhash: null })), undefined);
});

Deno.test("attachmentOpenHref: the inspector for a stored file, else the own address untiered", () => {
	assertEquals(attachmentOpenHref(attachment()), `/inspect/${ASSET}`);
	assertEquals(
		attachmentOpenHref(attachment({ assetId: null, url: "/api/files/object/x?tier=md&share=s" })),
		"/api/files/object/x?share=s",
	);
	assertEquals(attachmentOpenHref(attachment({ assetId: null, url: "#" })), null);
	assertEquals(
		attachmentOpenHref(attachment({ assetId: null, url: "https://cdn.example/a.zip" })),
		"https://cdn.example/a.zip",
	);
});
// #endregion

// #region Preview rows
Deno.test("attachmentItems: rows carry the stored id apart from a non-uuid row id", () => {
	const [row] = attachmentItems(message([attachment()]), chatFeedScope(CONVERSATION, CONVERSATION));
	assertEquals(row.id, `msg-1:${LINK_ROW}`);
	assertEquals(row.assetId, ASSET);
	assertEquals(row.url, `/api/media/proxy/${ASSET}`);
	assertEquals(row.thumbnailUrl, `/api/media/proxy/${ASSET}?tier=sm`);
	assertEquals(row.source, "supabase");
	assertEquals(row.status, "uploaded");
	assertEquals(row.kind, "image");
	assertEquals([row.width, row.height], [2400, 1600]);
});

Deno.test("attachmentItems: the message is the provenance the modal paints", () => {
	const [row] = attachmentItems(
		message([attachment()]),
		chatFeedScope("prj-abcdefghij", "stg-3f4gvyycwv"),
	);
	assertEquals(row.messageId, "msg-1");
	assertEquals(row.messageText, "Here is the poster");
	assertEquals(row.channelId, "stg-3f4gvyycwv");
	assertEquals(row.channelKind, null);
	assertEquals(row.sender?.handle, "chloe");
	assertEquals(row.dateLabel, "Yesterday · 2:30 PM");
	const [dm] = attachmentItems(message([attachment()]), chatFeedScope(CONVERSATION, CONVERSATION));
	assertEquals(dm.channelKind, "dm");
});

Deno.test("attachmentItems: a fixture row keeps its own address and has no stored id", () => {
	const rows = attachmentItems(
		message([
			attachment({ assetId: undefined, url: "https://images.example/p.jpg" }),
			attachment({ id: "f-2", assetId: null, kind: "file", url: "#", name: "", ext: "zip" }),
		]),
		chatFeedScope(CONVERSATION, CONVERSATION),
	);
	assertEquals(rows[0].assetId, null);
	assertEquals(rows[0].url, "https://images.example/p.jpg");
	assertEquals(rows[0].thumbnailUrl, "https://images.example/p.jpg");
	assertEquals(rows[1].url, "#");
	assertEquals(rows[1].name, "Attachment");
	assertEquals(rows[1].kind, "archive");
	assertEquals(rows[1].thumbnailUrl, null);
});

Deno.test("attachmentItems: a bubble kind backs up a name the taxonomy cannot place", () => {
	const [row] = attachmentItems(
		message([attachment({ name: "clip", ext: "", mimeType: null, kind: "video" })]),
		chatFeedScope(CONVERSATION, CONVERSATION),
	);
	assertEquals(row.kind, "video");
	assertEquals(row.thumbnailUrl, null);
});
// #endregion
