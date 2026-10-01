import { assert, assertEquals } from "@std/assert";
import {
	folderAfterSend,
	folderUnreadCounts,
	INBOX_FOLDERS,
	InboxFolder,
	requestRouting,
	SetConversationFolderSchema,
} from "./folders.ts";

const REPO = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO)).replace(/\r\n/g, "\n");

// #region The reply-promotion rule
Deno.test("the recipient replying moves their copy from Requests to Primary", () => {
	assertEquals(folderAfterSend("requests", true), "primary");
});

Deno.test("the requester following up never moves anybody else's copy", () => {
	assertEquals(folderAfterSend("requests", false), "requests");
});

Deno.test("a reply leaves Primary and Archived where they are", () => {
	assertEquals(folderAfterSend("primary", true), "primary");
	assertEquals(folderAfterSend("archived", true), "archived");
	assertEquals(folderAfterSend("archived", false), "archived");
});
// #endregion

// #region Request routing
Deno.test("a request between strangers files the recipient's copy in Requests", () => {
	assertEquals(requestRouting({ opens: true, mutualFollow: false }), {
		sender: "primary",
		recipient: "requests",
	});
});

Deno.test("a request between two people who follow each other lands in Primary", () => {
	assertEquals(requestRouting({ opens: true, mutualFollow: true }), {
		sender: "primary",
		recipient: "primary",
	});
});

Deno.test("a request into a conversation already under way re-files nothing", () => {
	assertEquals(requestRouting({ opens: false, mutualFollow: false }), null);
	assertEquals(requestRouting({ opens: false, mutualFollow: true }), null);
});
// #endregion

// #region Counts + payload
Deno.test("unread counts are per folder and ignore read conversations", () => {
	assertEquals(
		folderUnreadCounts([
			{ folder: "primary", unread: true },
			{ folder: "requests", unread: true },
			{ folder: "requests", unread: true },
			{ folder: "requests", unread: false },
			{ folder: "archived", unread: false },
		]),
		{ primary: 1, requests: 2, archived: 0 },
	);
});

Deno.test("a folder move names a real folder", () => {
	assert(SetConversationFolderSchema.safeParse({ folder: "requests" }).success);
	assert(!SetConversationFolderSchema.safeParse({ folder: "inbox" }).success);
	assert(!SetConversationFolderSchema.safeParse({}).success);
});
// #endregion

// #region The SQL twins
Deno.test("the inbox_folder CHECK is exactly the Zod enum", () => {
	const sql = read("supabase/migrations/00000016_tables_comms.sql");
	const match = sql.match(
		/dm_participants_inbox_folder_check CHECK \(inbox_folder IN \(([^)]*)\)\)/,
	);
	assert(match, "the inbox_folder CHECK is gone or renamed");
	const db = match[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
	assertEquals(db, [...INBOX_FOLDERS]);
	assertEquals(InboxFolder.options, ["primary", "requests", "archived"]);
});

Deno.test("is_archived is derived from the folder, so the two cannot disagree", () => {
	const sql = read("supabase/migrations/00000016_tables_comms.sql");
	assert(/is_archived boolean GENERATED ALWAYS AS \(inbox_folder = 'archived'\) STORED/.test(sql));
});

Deno.test("the promotion trigger moves the SENDER's own Requests row and nothing else", () => {
	const sql = read("supabase/migrations/00001300_functions_comms_channels.sql");
	const start = sql.indexOf("CREATE OR REPLACE FUNCTION comms.fn_promote_thread_on_reply(");
	assert(start >= 0, "comms.fn_promote_thread_on_reply is gone");
	const body = sql.slice(start, sql.indexOf("\n$$;", start));
	assert(
		body.includes("p.user_id = NEW.sender_user_id"),
		"the trigger no longer scopes to the sender",
	);
	assert(
		body.includes("p.inbox_folder = 'requests'"),
		"the trigger no longer starts from Requests",
	);
	assert(
		body.includes("SET inbox_folder = 'primary'"),
		"the trigger no longer promotes to Primary",
	);
});
// #endregion
