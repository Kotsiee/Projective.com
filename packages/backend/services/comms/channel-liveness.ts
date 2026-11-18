import {
	type ChannelLiveness,
	type ChannelLivenessOverride,
	NO_LIVE_CHANNELS,
	type OutboundChannel,
} from "@projective/types/comms";
import { configuredChannels } from "./dispatch-transports.ts";
import { NotificationDispatchService } from "./NotificationDispatchService.ts";

/**
 * channel-liveness — whether each outbound notification channel (email, push, SMS) actually delivers
 * in this environment, so no surface promises a channel that sends nothing.
 *
 * A channel is live only while the notification dispatcher runs AND that channel's transport is
 * registered with it: a configured provider with nothing dispatching to it sends nothing, and neither
 * does a dispatcher with no transport. {@link deliverySources} is the one place both halves are read,
 * so the answer turns true by itself as each transport lands in the dispatcher's registry (COMMS
 * NT3 email, NT4 push, NT5 SMS).
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
 * This environment's delivery sources: whether the dispatcher runs (a well-formed
 * `COMMS_DISPATCH_SECRET` and the `comms.dispatch_webhook` flag on,
 * {@link NotificationDispatchService.isRunning}) and which channels its transport registry can carry
 * ({@link configuredChannels}; empty until NT3–NT5).
 */
export async function deliverySources(
	running: () => Promise<boolean> = () => NotificationDispatchService.isRunning(),
	transports: () => Readonly<Record<OutboundChannel, boolean>> = () => configuredChannels(),
): Promise<DeliverySources> {
	return { dispatcher: await running(), transports: transports() };
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
 * `notificationDelivery` axis) draws every channel as live or none, without reading the sources;
 * without one, `sources` (this environment's, by default) decide.
 */
export async function channelLiveness(
	override: ChannelLivenessOverride | null = null,
	sources?: DeliverySources,
): Promise<ChannelLiveness> {
	if (override === "live") return { email: true, push: true, sms: true };
	if (override === "off") return NO_LIVE_CHANNELS;
	return resolveChannelLiveness(sources ?? await deliverySources());
}
// #endregion
