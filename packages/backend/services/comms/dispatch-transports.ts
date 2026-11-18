import {
	type ClaimedDelivery,
	type DeliveryResultStatus,
	OutboundChannel,
} from "@projective/types/comms";
import type { DispatchPayload } from "./dispatch-payload.ts";
import { emailDispatchTransport } from "./email-transport.ts";

/**
 * dispatch-transports — the registry of what the notification dispatcher can send through: one
 * transport per outbound channel, behind one entry point (EPI §8.1).
 *
 * The dispatcher claims only the channels with a configured transport here, so any other channel's
 * deliveries stay pending and untouched (deferred, EPI §3.2) and go out once its transport is
 * configured, while they are still inside the 24-hour window. COMMS NT3 registered email (Resend);
 * NT4 adds push and NT5 SMS. Each entry is a factory read at call time, so a provider key set later
 * counts without a restart, and a provider that is not configured (a missing or placeholder key)
 * answers `null`.
 * Channel liveness reads the same registry (`channel-liveness.ts`), so a channel is never shown as
 * delivering before something here can carry it.
 */

// #region Contract
/** One send's outcome, in the terms `comms.fn_record_delivery_result` records. */
export interface TransportOutcome {
	status: DeliveryResultStatus;
	/** The provider's name, as `comms.notification_deliveries.provider` holds it. */
	provider: string;
	/** The provider's own message id, which its delivery callback quotes. */
	providerRef?: string | null;
	/**
	 * Why a send failed: a status or a code, never the destination or the message. `gone` (push only)
	 * means the subscription no longer exists, which revokes the device.
	 */
	error?: string | null;
}

/** Carries one payload to one claimed delivery's destination on one channel. */
export interface DispatchTransport {
	readonly channel: OutboundChannel;
	readonly provider: string;
	/** Send, or say why not. It may throw; the dispatcher records a throw as a failure. */
	send(delivery: ClaimedDelivery, payload: DispatchPayload): Promise<TransportOutcome>;
}

/** A channel's transport, or `null` while its provider is not configured here. */
export type TransportFactory = () => DispatchTransport | null;

/** Factories by channel. */
export type TransportRegistry = Partial<Record<OutboundChannel, TransportFactory>>;
// #endregion

// #region Registry
/**
 * The transports this build ships: email through Resend (NT3), while its key and sender are
 * configured. Push (NT4) and SMS (NT5) are still to come.
 */
const REGISTRY: TransportRegistry = {
	email: () => emailDispatchTransport(),
};

/** Every configured transport, by channel, in the outbound channels' declared order. */
export function configuredTransports(
	registry: TransportRegistry = REGISTRY,
): Map<OutboundChannel, DispatchTransport> {
	const transports = new Map<OutboundChannel, DispatchTransport>();
	for (const channel of OutboundChannel.options) {
		const transport = registry[channel]?.() ?? null;
		if (transport) transports.set(channel, transport);
	}
	return transports;
}

/** Whether each outbound channel has a configured transport. */
export function configuredChannels(
	registry: TransportRegistry = REGISTRY,
): Record<OutboundChannel, boolean> {
	const transports = configuredTransports(registry);
	return {
		email: transports.has("email"),
		push: transports.has("push"),
		sms: transports.has("sms"),
	};
}
// #endregion
