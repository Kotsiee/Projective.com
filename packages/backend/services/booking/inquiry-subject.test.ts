import { assertEquals } from "@std/assert";
import { CreateConversationSchema } from "@projective/types/messaging";
import { inquiryConversation } from "./BookingBackendService.ts";
import { dmThreadArgs } from "../messaging/live-conversation-writes.ts";

const SELLER = "11111111-1111-4111-8111-111111111111";
const LISTING = "22222222-2222-4222-8222-222222222222";

Deno.test("a question from /view names the listing it was asked about", () => {
	const input = inquiryConversation({ accountUserId: SELLER, listingId: LISTING }, "Is May free?");
	assertEquals(input, { contactIds: [SELLER], message: "Is May free?", subjectListingId: LISTING });
	assertEquals(CreateConversationSchema.safeParse(input).success, true);
});

Deno.test("an item with no catalogue listing row asks without a subject", () => {
	assertEquals(inquiryConversation({ accountUserId: SELLER, listingId: null }, "Hi"), {
		contactIds: [SELLER],
		message: "Hi",
	});
	assertEquals(inquiryConversation({ accountUserId: SELLER, listingId: "svc-brand01" }, "Hi"), {
		contactIds: [SELLER],
		message: "Hi",
	});
});

Deno.test("the thread door receives the subject listing, and a plain DM sends none", () => {
	assertEquals(dmThreadArgs(SELLER, { subjectListingId: LISTING }), {
		target_user_id: SELLER,
		p_subject_listing: LISTING,
	});
	assertEquals(dmThreadArgs(SELLER, {}), { target_user_id: SELLER });
});
