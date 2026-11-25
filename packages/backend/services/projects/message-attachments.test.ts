import { assertEquals } from "@std/assert";
import { MessageAttachmentSchema, MessageAudioSchema } from "@projective/types/projects";
import { type FileRow, memoFactsOf, toAttachment, toMessageMedia } from "./message-attachments.ts";

const FILE_ID = "7a010c3d-0a24-4910-a512-71b47c30fc63";
const LINK = { id: "a528d5a3-393c-4adb-8bba-33f8b3e59c88" };

function file(over: Partial<FileRow> = {}): FileRow {
	return {
		id: FILE_ID,
		slug: "fil-abcdefghjk",
		display_name: "orbit-poster.png",
		original_name: "orbit-poster.png",
		mime_type: "image/png",
		source: "supabase",
		status: "uploaded",
		link_url: null,
		external_web_url: null,
		metadata: {},
		...over,
	};
}

Deno.test("toAttachment: a stored image is a proxy md tile keyed by its link row", () => {
	const tile = MessageAttachmentSchema.parse(toAttachment(LINK, file()));
	assertEquals(tile.id, LINK.id);
	assertEquals(tile.kind, "image");
	assertEquals(tile.url, `/api/media/proxy/${FILE_ID}?tier=md`);
	assertEquals([tile.assetId, tile.mimeType], [FILE_ID, "image/png"]);
	assertEquals([tile.width, tile.height, tile.blurhash], [null, null, null]);
});

Deno.test("toAttachment: the upload-time envelope supplies dimensions and the BlurHash", () => {
	const tile = MessageAttachmentSchema.parse(toAttachment(
		LINK,
		file({
			metadata: {
				version: 1,
				source: "client",
				extractedAt: "2026-10-09T12:00:00.000Z",
				media: {
					kind: "image",
					width: 1200,
					height: 800,
					aspectRatio: 1.5,
					blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
					colors: null,
					animated: false,
					vector: false,
					hasAlpha: null,
				},
				notes: [],
			},
		}),
	));
	assertEquals([tile.width, tile.height], [1200, 800]);
	assertEquals(tile.blurhash, "LEHV6nWB2yk8pyo0adR*.7kCMdnj");
});

Deno.test("toAttachment: a document streams its original; an unsettled upload has no address", () => {
	const pdf = toAttachment(
		LINK,
		file({ display_name: "brief.pdf", original_name: "brief.pdf", mime_type: "application/pdf" }),
	);
	assertEquals([pdf.url, pdf.mimeType], [`/api/media/proxy/${FILE_ID}`, "application/pdf"]);
	const pending = toAttachment(LINK, file({ status: "pending_upload" }));
	assertEquals([pending.kind, pending.url, pending.assetId], ["file", "", FILE_ID]);
});

Deno.test("toAttachment: a link keeps its target; a blank MIME is null", () => {
	const link = toAttachment(
		LINK,
		file({
			source: "link",
			display_name: "Moodboard",
			original_name: "Moodboard",
			mime_type: "  ",
			link_url: "https://example.org/board",
		}),
	);
	assertEquals([link.kind, link.url, link.mimeType], ["file", "https://example.org/board", null]);
});

// #region Voice memos (CAS M18)
const MEMO = {
	id: "c3b1f0a2-5d4e-4f6a-8b7c-9d0e1f2a3b4c",
	mode: "copy",
	attachment_id: FILE_ID,
	audio_duration_ms: 61_500,
	audio_peaks: [0, 0.5, 1],
};
const voice = () =>
	new Map([[
		FILE_ID,
		file({ mime_type: "audio/webm", display_name: "voice.webm", original_name: "voice.webm" }),
	]]);

Deno.test("toMessageMedia: a memo row is the player, not a tile", () => {
	const media = toMessageMedia([MEMO], voice());
	assertEquals(media.attachments, []);
	assertEquals(MessageAudioSchema.parse(media.audio), {
		url: `/api/media/proxy/${FILE_ID}`,
		durationMs: 61_500,
		durationLabel: "1:01",
		peaks: [0, 0.5, 1],
	});
});

Deno.test("toMessageMedia: a memo whose file cannot play stays a tile", () => {
	const pending = new Map([[FILE_ID, file({ mime_type: "audio/webm", status: "pending_upload" })]]);
	const media = toMessageMedia([MEMO], pending);
	assertEquals(media.audio, null);
	assertEquals(media.attachments.map((a) => a.id), [MEMO.id]);
});

Deno.test("toMessageMedia: stored facts the player cannot draw degrade to a tile", () => {
	for (
		const bad of [{ audio_peaks: [1.5] }, { audio_peaks: "x" }, { audio_duration_ms: -1 }, {
			audio_peaks: null,
		}]
	) {
		const media = toMessageMedia([{ ...MEMO, ...bad }], voice());
		assertEquals(media.audio, null, JSON.stringify(bad));
		assertEquals(media.attachments.length, 1);
	}
	assertEquals(memoFactsOf({ audio_duration_ms: 0, audio_peaks: [] }), {
		durationMs: 0,
		peaks: [],
	});
});

Deno.test("toMessageMedia: other files keep their order around the memo", () => {
	const doc = "d4c2e1b3-6f5a-4b7c-8d9e-0f1a2b3c4d5e";
	const files = new Map([
		...voice(),
		[
			doc,
			file({
				id: doc,
				display_name: "brief.pdf",
				original_name: "brief.pdf",
				mime_type: "application/pdf",
			}),
		],
	]);
	const media = toMessageMedia([
		{ id: "a1", mode: "copy", attachment_id: doc },
		MEMO,
		{ id: "a3", mode: "link", attachment_id: doc },
	], files);
	assertEquals(media.attachments.map((a) => a.id), ["a1", "a3"]);
	assertEquals(media.audio?.durationMs, 61_500);
});
// #endregion
