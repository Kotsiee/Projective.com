/**
 * The pure half of the contact intake (Decision #276): what the writer is handed, how its answer
 * reads, and how each of its refusals reaches the form.
 */
import { assert, assertEquals, assertMatch } from "@std/assert";
import { type ContactSubmission, ContactSubmissionSchema } from "@projective/types/contact";
import {
	fieldOfRefusal,
	localReceipt,
	receiptFromRpc,
	submitRefusal,
	submitRpcArgs,
} from "./contact-rpc.ts";

const MESSAGE = "The stage was approved but nothing was delivered to us.";
const FILE = "00000000-0000-4000-8000-0000000000a1";
const parse = (v: Record<string, unknown>): ContactSubmission => ContactSubmissionSchema.parse(v);

Deno.test("submitRpcArgs: the reply address lower-cased, payload without address or files", () => {
	const args = submitRpcArgs(parse({
		intent: "support",
		name: "Ada",
		email: "Ada@Example.COM",
		topic: "payments",
		message: MESSAGE,
		attachmentIds: [FILE],
	}));
	assertEquals(args.p_intent, "support");
	assertEquals(args.p_email, "ada@example.com");
	assertEquals(args.p_anonymous, false);
	assertEquals(args.p_attachment_ids, [FILE]);
	assertEquals(args.p_payload, { name: "Ada", topic: "payments", message: MESSAGE });
});

Deno.test("submitRpcArgs: an anonymous report sends no address and no files", () => {
	const args = submitRpcArgs(
		parse({ intent: "security", anonymous: true, reportType: "abuse", message: MESSAGE }),
	);
	assertEquals(args.p_email, null);
	assertEquals(args.p_anonymous, true);
	assertEquals(args.p_attachment_ids, []);
	assertEquals(args.p_payload, { reportType: "abuse", message: MESSAGE });
});

Deno.test("submitRpcArgs: a dispute stores the RESOLVED engagement, never the client's slug", () => {
	const s = parse({
		intent: "dispute",
		name: "Ada",
		email: "a@b.co",
		engagementSlug: "prj-abc",
		message: MESSAGE,
	});
	assertEquals(submitRpcArgs(s).p_payload, { name: "Ada", message: MESSAGE });
	assertEquals(
		submitRpcArgs(s, { slug: "prj-abc", title: "Brand refresh", format: "session" }).p_payload
			.engagement,
		{
			slug: "prj-abc",
			title: "Brand refresh",
			format: "session",
		},
	);
});

Deno.test("receiptFromRpc: the writer's document, or null when it drifted", () => {
	assertEquals(
		receiptFromRpc({
			id: "00000000-0000-4000-8000-000000000001",
			reference: "CT-7K4Q-2M9X",
			intent: "sales",
			status: "backlog",
			created_at: "2026-10-17T20:00:00Z",
		}),
		{
			reference: "CT-7K4Q-2M9X",
			intent: "sales",
			status: "backlog",
			receivedAt: "2026-10-17T20:00:00Z",
		},
	);
	assertEquals(receiptFromRpc({ reference: "nope" }), null);
	assertEquals(receiptFromRpc(null), null);
});

Deno.test("localReceipt: a well-formed reference in backlog", () => {
	const r = localReceipt("security", new Date("2026-10-17T10:00:00Z"));
	assertMatch(r.reference, /^CT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
	assertEquals(r.status, "backlog");
	assertEquals(r.receivedAt, "2026-10-17T10:00:00.000Z");
});

Deno.test("fieldOfRefusal: the writer's sentences name the field the form marks", () => {
	assertEquals(fieldOfRefusal("contact: message must be 20 to 5000 characters"), "message");
	assertEquals(fieldOfRefusal("contact: email must be a valid reply address"), "email");
	assertEquals(fieldOfRefusal("contact: name must be 1 to 120 characters"), "name");
	assertEquals(
		fieldOfRefusal("contact: an attachment is not yours, has not finished its check"),
		"attachmentIds",
	);
	assertEquals(fieldOfRefusal("contact: payload must be an object"), null);
});

Deno.test("submitRefusal: PR429 → 429, 22023 → 422 naming the field, 42501 → 401, else 503", () => {
	assertEquals(submitRefusal({ code: "PR429", message: "contact: …" }).status, 429);
	const invalid = submitRefusal({
		code: "22023",
		message: "contact: message must be 20 to 5000 characters",
	});
	assertEquals(invalid.status, 422);
	assert(invalid.errors?.message);
	assertEquals(
		submitRefusal({ code: "22023", message: "contact: a sales request has no field topic" }).errors,
		undefined,
	);
	const signIn = submitRefusal({ code: "42501", message: "contact: sign in to attach files" });
	assertEquals(signIn.status, 401);
	assert(signIn.errors?.attachmentIds);
	const down = submitRefusal({ code: "PGRST202", message: "not found" });
	assertEquals(down.status, 503);
	assertEquals(down.details, { code: "PGRST202" });
	assertEquals(submitRefusal({ message: "socket hang up" }).details, { code: null });
});
