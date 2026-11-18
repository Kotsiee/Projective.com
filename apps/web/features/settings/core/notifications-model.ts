import type { ChannelLiveness, OutboundChannel, PersonalChannel } from "@projective/types/comms";

/**
 * notifications-model — the words Settings → Notifications uses for its channels. Pure, so the one
 * rule it carries is testable: a channel's copy says it delivers only while the server's liveness map
 * says it does. In-app always delivers; an outbound channel that is not live says nothing is sent yet,
 * and its switch still saves, because the preference applies once that channel launches.
 */

// #region Vocabulary
/** Each channel's name, as the switches and the matrix columns print it. */
export const CHANNEL_LABEL: Readonly<Record<PersonalChannel, string>> = {
	in_app: "In-app",
	push: "Push",
	email: "Email",
	sms: "Text",
};

const DELIVERING: Readonly<Record<PersonalChannel, string>> = {
	in_app: "Your inbox on Projective — always real time.",
	push: "Alerts on devices where you've allowed notifications.",
	email: "Sent to your primary email address.",
	sms: "Sent by text message to your confirmed phone number.",
};

const NOT_YET: Readonly<Record<OutboundChannel, string>> = {
	push: "Nothing is sent as a push alert yet — this choice applies once push alerts launch.",
	email: "Nothing is sent by email yet — this choice applies once email alerts launch.",
	sms: "Nothing is sent by text message yet — this choice applies once text alerts launch.",
};

const ALERT_NOUN: Readonly<Record<OutboundChannel, string>> = {
	push: "push",
	email: "email",
	sms: "text",
};
// #endregion

// #region Copy
function channelDelivers(channel: PersonalChannel, delivery: ChannelLiveness): boolean {
	return channel === "in_app" || delivery[channel];
}

/** The sentence under a channel's switch: its delivery, or that nothing is sent yet. */
export function channelDescription(channel: PersonalChannel, delivery: ChannelLiveness): string {
	return channel === "in_app" || delivery[channel] ? DELIVERING[channel] : NOT_YET[channel];
}

/**
 * Where a category's required alerts go: the channels that deliver, then the ones that follow at
 * launch — "Sent by in-app. Email alerts follow once they launch."
 */
export function requiredDeliveryNote(
	channels: readonly PersonalChannel[],
	delivery: ChannelLiveness,
): string {
	const now = channels.filter((channel) => channelDelivers(channel, delivery));
	const later = channels.filter((channel): channel is OutboundChannel =>
		!channelDelivers(channel, delivery)
	);
	const parts: string[] = [];
	if (now.length > 0) {
		parts.push(`Sent by ${now.map((channel) => CHANNEL_LABEL[channel].toLowerCase()).join(", ")}.`);
	}
	if (later.length > 0) {
		const nouns = listOf(later.map((channel) => ALERT_NOUN[channel]));
		parts.push(`${nouns.charAt(0).toUpperCase()}${nouns.slice(1)} alerts follow once they launch.`);
	}
	return parts.join(" ");
}

function listOf(words: readonly string[]): string {
	return words.length < 2
		? words.join("")
		: `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
// #endregion
