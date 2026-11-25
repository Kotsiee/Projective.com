import type { DevPushPermission } from "@web/utils/dev-seam.ts";

/**
 * push-device-model — the pure half of "Alerts on this device" (COMMS NT4): which state the control
 * draws for the served key, a simulated Dev Context Switcher state, the platform, the permission and
 * the subscription. No browser or build-time import, so every state is unit-tested; the browser half
 * is `push-device.ts`.
 */

// #region State
/** What the device control draws. */
export type PushDeviceState =
	/** Push is not configured, or this browser has no Push API: nothing renders. */
	| { kind: "hidden" }
	/** iOS Safari outside a Home-Screen app: the reason and how to install, no switch (§3.11). */
	| { kind: "ios-not-installed" }
	/** The person blocked notifications for this site in the browser. */
	| { kind: "denied" }
	/** Not on for this browser yet: one press asks (if needed) and subscribes. */
	| { kind: "off"; publicKey: string }
	/** This browser is subscribed AND is the caller's own live device. `endpoint` is null under a simulated state. */
	| { kind: "on"; publicKey: string; endpoint: string | null }
	/**
	 * This browser was the caller's device until Projective turned it off: the push service answered
	 * 404 or 410, its failures reached the reaper's threshold, or it went unseen for 180 days (PROJECTS
	 * NO3). Turning on again replaces the dead subscription with a fresh one.
	 */
	| { kind: "stopped"; publicKey: string };

/** What the browser can do here. */
export type PushPlatform = "supported" | "unsupported" | "ios-not-installed";

/** The inputs {@link pushStateFor} reads, each from the server, the seam or the browser. */
export interface PushInputs {
	/** The served VAPID key, or null when push is not configured (`/push/config` answered 404). */
	publicKey: string | null;
	simulated: DevPushPermission | null;
	platform: PushPlatform;
	permission: NotificationPermission | null;
	endpoint: string | null;
	/**
	 * Whether `endpoint` is the caller's own live device (`/api/notifications/devices/status`). A
	 * browser another account turned on, or one released since, is subscribed but not the caller's.
	 */
	registered: boolean;
	/** Whether `endpoint`'s newest row for the caller was revoked by the system, not by a person. */
	stopped: boolean;
}

/** The control's state for these inputs. A simulated state wins over the real browser. */
export function pushStateFor(input: PushInputs): PushDeviceState {
	const { publicKey } = input;
	if (!publicKey) return { kind: "hidden" };
	switch (input.simulated) {
		case "unsupported":
			return { kind: "hidden" };
		case "ios-not-installed":
			return { kind: "ios-not-installed" };
		case "denied":
			return { kind: "denied" };
		case "prompt":
			return { kind: "off", publicKey };
		case "granted":
			return { kind: "on", publicKey, endpoint: input.endpoint };
		case "stopped":
			return { kind: "stopped", publicKey };
	}
	if (input.platform === "unsupported") return { kind: "hidden" };
	if (input.platform === "ios-not-installed") return { kind: "ios-not-installed" };
	if (input.permission === "denied") return { kind: "denied" };
	// A subscription alone is not "on": on a shared browser it may be someone else's (COMMS NT4).
	if (input.endpoint && input.registered) {
		return { kind: "on", publicKey, endpoint: input.endpoint };
	}
	return input.endpoint && input.stopped
		? { kind: "stopped", publicKey }
		: { kind: "off", publicKey };
}

/** What this browser supports, from its navigator and display mode. */
export function detectPlatform(
	nav: Partial<Navigator> & { standalone?: boolean } | undefined = globalThis.navigator,
	scope: Partial<typeof globalThis> = globalThis,
): PushPlatform {
	if (!nav) return "unsupported";
	const ua = nav.userAgent ?? "";
	const ios = /iPad|iPhone|iPod/.test(ua) ||
		(nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
	const standalone = nav.standalone === true ||
		(typeof scope.matchMedia === "function" &&
			scope.matchMedia("(display-mode: standalone)").matches);
	if (ios && !standalone) return "ios-not-installed";
	if (!("serviceWorker" in nav) || !("PushManager" in scope) || !("Notification" in scope)) {
		return "unsupported";
	}
	return "supported";
}
// #endregion
