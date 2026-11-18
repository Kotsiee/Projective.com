import { assert, assertEquals, assertFalse } from "@std/assert";
import { NO_LIVE_CHANNELS, NotificationCategory, PERSONAL_CHANNELS } from "@projective/types/comms";
import { resolveChannelLiveness } from "@server/services/comms/channel-liveness.ts";
import {
	categoryChannelOn,
	channelDescription,
	requiredDeliveryNote,
} from "./notifications-model.ts";

const DELIVERY_CLAIM = /^Sent |^Alerts on devices/;

Deno.test("channelDescription — with no transport, no outbound channel claims delivery", () => {
	const delivery = resolveChannelLiveness({
		dispatcher: true,
		transports: { email: false, push: false, sms: false },
	});
	for (const channel of PERSONAL_CHANNELS) {
		const text = channelDescription(channel, delivery);
		if (channel === "in_app") {
			assertEquals(text, "Your inbox on Projective — always real time.");
			continue;
		}
		assertFalse(DELIVERY_CLAIM.test(text), `${channel}: ${text}`);
		assert(text.startsWith("Nothing is sent"), `${channel}: ${text}`);
		assert(text.endsWith("launch."), `${channel}: ${text}`);
	}
});

Deno.test("channelDescription — a stubbed live channel gets its delivery sentence back, alone", () => {
	const delivery = resolveChannelLiveness({
		dispatcher: true,
		transports: { email: true, push: false, sms: false },
	});
	assertEquals(channelDescription("email", delivery), "Sent to your primary email address.");
	assert(channelDescription("push", delivery).startsWith("Nothing is sent"));
	assert(channelDescription("sms", delivery).startsWith("Nothing is sent"));
});

Deno.test("channelDescription — every outbound channel's live sentence returns when all are live", () => {
	const all = { email: true, push: true, sms: true };
	assertEquals(
		channelDescription("push", all),
		"Alerts on devices where you've allowed notifications.",
	);
	assertEquals(
		channelDescription("sms", all),
		"Sent by text message to your confirmed phone number.",
	);
});

Deno.test("requiredDeliveryNote — names only in-app as sending while nothing else is live", () => {
	assertEquals(
		requiredDeliveryNote(["in_app", "email"], NO_LIVE_CHANNELS),
		"Sent by in-app. Email alerts follow once they launch.",
	);
	assertEquals(
		requiredDeliveryNote(["in_app", "push", "email", "sms"], NO_LIVE_CHANNELS),
		"Sent by in-app. Push, email and text alerts follow once they launch.",
	);
});

Deno.test("requiredDeliveryNote — a live channel joins the sending list", () => {
	const delivery = { email: true, push: false, sms: false };
	assertEquals(requiredDeliveryNote(["in_app", "email"], delivery), "Sent by in-app, email.");
	assertEquals(
		requiredDeliveryNote(["in_app", "email", "push"], delivery),
		"Sent by in-app, email. Push alerts follow once they launch.",
	);
});

Deno.test("requiredDeliveryNote — an outbound-only category never claims delivery", () => {
	assertEquals(
		requiredDeliveryNote(["email"], NO_LIVE_CHANNELS),
		"Email alerts follow once they launch.",
	);
});

Deno.test("categoryChannelOn — a category's own value wins over the master, in both directions", () => {
	for (const category of NotificationCategory.options) {
		assert(categoryChannelOn(category, true, false), `${category}: own on, master off`);
		assertFalse(categoryChannelOn(category, false, true), `${category}: own off, master on`);
	}
});

Deno.test("categoryChannelOn — with no value of its own a category follows the master, except Marketing", () => {
	for (const category of NotificationCategory.options) {
		assertFalse(categoryChannelOn(category, null, false), `${category}: master off`);
		if (category === "marketing") {
			assertFalse(
				categoryChannelOn(category, null, true),
				"Marketing is opt-in: master on is no yes",
			);
		} else {
			assert(categoryChannelOn(category, null, true), `${category}: follows master on`);
		}
	}
});
