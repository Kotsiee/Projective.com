import { assertEquals } from "@std/assert";
import {
	attachmentInserts,
	linkShareProblem,
	linkShareRefusal,
	type LinkShareRow,
} from "./link-shares.ts";

const SENDER = "11111111-1111-4111-8111-111111111111";
const FILE = "6d43f88f-84c7-4454-a2e1-c3bd6a2839e2";

const row = (over: Partial<LinkShareRow> = {}): LinkShareRow => ({
	id: FILE,
	owner_user_id: SENDER,
	owner_type: "user",
	source: "supabase",
	bucket_id: "personal",
	visibility: "private",
	...over,
});

Deno.test("the sender's own upload in their personal library may be shared as a link", () => {
	assertEquals(linkShareProblem([FILE], [row()], SENDER), null);
	assertEquals(linkShareProblem([FILE], [row({ visibility: "public" })], SENDER), null);
});

Deno.test("a file the sender cannot read, or that was deleted, is missing", () => {
	assertEquals(linkShareProblem([FILE], [], SENDER), "missing");
});

Deno.test("somebody else's file, a team's, a project room's, a mount or a saved link is not theirs to link", () => {
	assertEquals(
		linkShareProblem([FILE], [row({ owner_user_id: "someone-else" })], SENDER),
		"not_yours",
	);
	assertEquals(linkShareProblem([FILE], [row({ owner_type: "team" })], SENDER), "not_yours");
	assertEquals(linkShareProblem([FILE], [row({ bucket_id: "project" })], SENDER), "not_yours");
	assertEquals(linkShareProblem([FILE], [row({ source: "google_drive" })], SENDER), "not_yours");
	assertEquals(linkShareProblem([FILE], [row({ source: "link" })], SENDER), "not_yours");
});

Deno.test("a refusal names the field and says what to do instead", () => {
	const refusal = linkShareRefusal("not_yours");
	assertEquals(refusal.status, 422);
	assertEquals(refusal.errors, { linkedFileIds: "not_yours" });
});

Deno.test("a message's rows are its copies, then its link shares", () => {
	assertEquals(attachmentInserts("comms.dm_messages", "m1", ["a"], ["b"]), [
		{ message_table: "comms.dm_messages", message_id: "m1", attachment_id: "a", mode: "copy" },
		{ message_table: "comms.dm_messages", message_id: "m1", attachment_id: "b", mode: "link" },
	]);
});
