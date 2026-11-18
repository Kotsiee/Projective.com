import {
	type ChannelLiveness,
	type ChannelLivenessOverride,
	NO_LIVE_CHANNELS,
	type OutboundChannel,
} from "@projective/types/comms";
import { configuredTransport } from "../mail/transport.ts";

/**
 * channel-liveness — whether each outbound notification channel (email, push, SMS) actually delivers
 * in this environment, so no surface promises a channel that sends nothing.
 *
 * A channel is live only while the notification dispatcher runs AND that channel's transport is
 * configured: a configured provider with nothing dispatching to it sends nothing, and neither does a
 * dispatcher with no provider. {@link deliverySources} is the one place both halves are read, so the
 * answer turns true by itself once delivery for a channel lands (COMMS NT2–NT5).
 */

// #region Sources
/** What delivery on each outbound channel depends on. */
export interface DeliverySources {
	/** The notification dispatcher claims and sends outbound deliveries here. */
	dispatcher: boolean;
	/** Each channel has a configured transport the dispatcher sends through. */
	transports: Readonly<Record<OutboundChannel, boolean>>;
}

/**
 * This environment's delivery sources. No dispatcher exists, so nothing is dispatched. Email's
 * transport is the Resend one ({@link configuredTransport}); push and SMS have no transport.
 */
export function deliverySources(): DeliverySources {
	return {
		dispatcher: false,
		transports: { email: configuredTransport() !== null, push: false, sms: false },
	};
}
// #endregion

// #region Liveness
/** A channel is live only when the dispatcher runs and that channel's transport is configured. */
export function resolveChannelLiveness(sources: DeliverySources): ChannelLiveness {
	const live = (channel: OutboundChannel) => sources.dispatcher && sources.transports[channel];
	return { email: live("email"), push: live("push"), sms: live("sms") };
}

/**
 * Which outbound channels deliver here. A development `override` (the Dev Context Switcher's
 * `notificationDelivery` axis) draws every channel as live or none; without one, `sources` decide.
 */
export function channelLiveness(
	override: ChannelLivenessOverride | null = null,
	sources: DeliverySources = deliverySources(),
): ChannelLiveness {
	if (override === "live") return { email: true, push: true, sms: true };
	if (override === "off") return NO_LIVE_CHANNELS;
	return resolveChannelLiveness(sources);
}
// #endregion
