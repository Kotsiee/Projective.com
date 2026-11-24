/**
 * The messaging row schemas against the tables that store them (PROJECTS CH4).
 *
 * Reads the consolidated migration, never a live database, so a column added on either side fails
 * here on a laptop. `comms.message_attachments` is compared column for key, and the memo CHECKs it
 * mirrors are pinned to the SQL that declares them, so the bound the Zod side enforces is the one the
 * table enforces.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { columnDrift, readRepoFile, tableColumns } from "../core/table-contract.ts";
import { MEMO_PEAKS_MAX, MessageAttachmentRowSchema } from "./rows.ts";

const SQL = readRepoFile("supabase/migrations/00000016_tables_comms.sql").replace(/\r\n/g, "\n");
const INDEXES = readRepoFile("supabase/migrations/00004006_indexes_comms.sql").replace(
	/\r\n/g,
	"\n",
);

Deno.test("comms.message_attachments: every column has a key and every key a column", () => {
	const drift = columnDrift(
		tableColumns(SQL, "comms.message_attachments"),
		Object.keys(MessageAttachmentRowSchema.shape),
	);
	assertEquals(drift, { missingKeys: [], extraKeys: [], staleAllowlist: [] });
});

Deno.test("comms.message_attachments: the memo bounds are the table's", () => {
	const start = SQL.indexOf("CREATE TABLE comms.message_attachments");
	assert(start >= 0, "comms.message_attachments is gone");
	const body = SQL.slice(start, SQL.indexOf("\n);", start));
	assertStringIncludes(body, `cardinality(audio_peaks) <= ${MEMO_PEAKS_MAX}`);
	assertStringIncludes(body, "0 <= ALL (audio_peaks)");
	assertStringIncludes(body, "1 >= ALL (audio_peaks)");
	assertStringIncludes(body, "(audio_duration_ms IS NULL) = (audio_peaks IS NULL)");
	assertStringIncludes(body, "audio_duration_ms IS NULL OR mode = 'copy'");
	assertStringIncludes(body, "audio_duration_ms IS NULL OR audio_duration_ms >= 0");
	assert(
		/CREATE UNIQUE INDEX IF NOT EXISTS uq_message_attachments_one_memo\s+ON comms\.message_attachments \(message_table, message_id\)\s+WHERE audio_duration_ms IS NOT NULL;/
			.test(INDEXES),
		"one memo per message is no longer enforced",
	);
});

Deno.test("MessageAttachmentRowSchema refuses what the table refuses", () => {
	const row = {
		id: "a528d5a3-393c-4adb-8bba-33f8b3e59c88",
		messageTable: "comms.dm_messages",
		messageId: "7a010c3d-0a24-4910-a512-71b47c30fc63",
		attachmentId: "1f4c7d0e-6a1b-4c2d-9e3f-0a1b2c3d4e5f",
		mode: "copy",
		createdAt: "2026-11-24T10:00:00.000Z",
		audioDurationMs: 42_000,
		audioPeaks: [0.125, 0.5, 1],
	};
	assert(MessageAttachmentRowSchema.safeParse(row).success, "a memo row parses");
	assert(
		MessageAttachmentRowSchema.safeParse({ ...row, audioDurationMs: null, audioPeaks: null })
			.success,
		"a plain link row parses",
	);
	assert(
		!MessageAttachmentRowSchema.safeParse({ ...row, audioPeaks: null }).success,
		"half a pair",
	);
	assert(
		!MessageAttachmentRowSchema.safeParse({ ...row, mode: "link" }).success,
		"a memo as a link",
	);
	assert(
		!MessageAttachmentRowSchema.safeParse({ ...row, audioPeaks: [1.5] }).success,
		"a peak above 1",
	);
	assert(
		!MessageAttachmentRowSchema.safeParse({
			...row,
			audioPeaks: Array.from({ length: MEMO_PEAKS_MAX + 1 }, () => 0.5),
		}).success,
		"more than 512 samples",
	);
	assert(
		!MessageAttachmentRowSchema.safeParse({ ...row, audioDurationMs: -1 }).success,
		"a negative length",
	);
});
