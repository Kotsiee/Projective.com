import { assertEquals } from "@std/assert";
import { MessageAttachmentSchema } from "@projective/types/projects";
import { type FileRow, toAttachment } from "./message-attachments.ts";

const FILE_ID = "7a010c3d-0a24-4910-a512-71b47c30fc63";
const LINK = { id: "a528d5a3-393c-4adb-8bba-33f8b3e59c88" };

function file(over: Partial<FileRow> = {}): FileRow {
	return {
		id: FILE_ID,
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
