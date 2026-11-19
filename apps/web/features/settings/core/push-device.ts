import { IS_DEV } from "@web/utils/dev.ts";
import { readDevSeam } from "@web/utils/dev-seam.ts";
import { detectPlatform, type PushDeviceState, pushStateFor } from "./push-device-model.ts";

export type { PushDeviceState } from "./push-device-model.ts";

/**
 * push-device — the browser half of "Alerts on this device" (COMMS NT4; providers spec §8.2).
 *
 * Permission is asked only when the person presses the control, never on load. A subscription is
 * `userVisibleOnly` and keyed with the served VAPID public key, then POSTed to
 * `/api/notifications/devices`; stopping unsubscribes and revokes it. Development registers the
 * push-only worker (`/sw.js?mode=push`), because the shell cache must never run there
 * (`ServiceWorkerBridge`). The account-wide Push switch keeps its meaning: it decides which alerts may
 * come at all, and this control turns them on for one browser.
 *
 * The states themselves are pure (`push-device-model.ts`), so the Dev Context Switcher's
 * `pushPermission` axis can draw each one without touching real browser settings.
 */

// #region Browser
/** The worker a subscription lives on: push-only in development, the full shell worker in production. */
export const SW_URL = IS_DEV ? "/sw.js?mode=push" : "/sw.js";

function urlBase64ToBytes(text: string): Uint8Array<ArrayBuffer> {
	const padded = text.replaceAll("-", "+").replaceAll("_", "/") +
		"=".repeat((4 - (text.length % 4)) % 4);
	return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration> {
	const existing = await navigator.serviceWorker.getRegistration("/");
	if (existing) return existing;
	await navigator.serviceWorker.register(SW_URL, { scope: "/" });
	return await navigator.serviceWorker.ready;
}

async function currentEndpoint(): Promise<string | null> {
	try {
		const reg = await navigator.serviceWorker.getRegistration("/");
		return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
	} catch {
		return null;
	}
}

/** A short, non-identifying label for the device list: "Chrome on Windows". */
function deviceLabel(): string {
	const ua = navigator.userAgent;
	const browser = /Edg\//.test(ua)
		? "Edge"
		: /Firefox\//.test(ua)
		? "Firefox"
		: /Chrome\//.test(ua)
		? "Chrome"
		: /Safari\//.test(ua)
		? "Safari"
		: "Browser";
	const os = /Windows/.test(ua)
		? "Windows"
		: /Android/.test(ua)
		? "Android"
		: /iPhone|iPad|iPod/.test(ua)
		? "iOS"
		: /Mac OS X/.test(ua)
		? "macOS"
		: /Linux/.test(ua)
		? "Linux"
		: "this device";
	return `${browser} on ${os}`;
}

/** Read the control's state: the served key, the seam, the platform, permission and subscription. */
export async function readPushState(): Promise<PushDeviceState> {
	let publicKey: string | null = null;
	try {
		const res = await fetch("/api/notifications/push/config", {
			headers: { accept: "application/json" },
		});
		if (res.ok) publicKey = (await res.json()).publicKey ?? null;
	} catch {
		publicKey = null;
	}
	const seam = readDevSeam()?.pushPermission;
	const platform = detectPlatform();
	return pushStateFor({
		publicKey,
		simulated: seam && seam !== "auto" ? seam : null,
		platform,
		permission: platform === "supported" ? Notification.permission : null,
		endpoint: platform === "supported" ? await currentEndpoint() : null,
	});
}

/** The outcome of a press. */
export type PushPress = { ok: true; endpoint: string | null } | { ok: false; message: string };

async function messageOf(res: Response, fallback: string): Promise<string> {
	try {
		return (await res.json()).message ?? fallback;
	} catch {
		return fallback;
	}
}

/** Turn alerts on for this browser: ask (only now), subscribe, register. Undoes the subscription on refusal. */
export async function enablePush(publicKey: string): Promise<PushPress> {
	try {
		const permission = await Notification.requestPermission();
		if (permission !== "granted") {
			return {
				ok: false,
				message: permission === "denied"
					? "Notifications are blocked for Projective in this browser."
					: "Notifications weren't allowed, so alerts stay off on this device.",
			};
		}
		const reg = await registration();
		const sub = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToBytes(publicKey),
		});
		const res = await fetch("/api/notifications/devices", {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({ ...sub.toJSON(), label: deviceLabel() }),
		});
		if (!res.ok) {
			await sub.unsubscribe().catch(() => false);
			return { ok: false, message: await messageOf(res, "Alerts couldn't be turned on just now.") };
		}
		return { ok: true, endpoint: sub.endpoint };
	} catch {
		return {
			ok: false,
			message: "This browser couldn't turn on alerts just now. Try again in a moment.",
		};
	}
}

/** Stop alerts on this browser: revoke the device on the server, then unsubscribe here. */
export async function disablePush(): Promise<PushPress> {
	try {
		const reg = await navigator.serviceWorker.getRegistration("/");
		const sub = await reg?.pushManager.getSubscription();
		if (sub) {
			const res = await fetch("/api/notifications/devices", {
				method: "DELETE",
				headers: { "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify({ endpoint: sub.endpoint }),
			});
			if (!res.ok) {
				return {
					ok: false,
					message: await messageOf(res, "Alerts couldn't be turned off just now."),
				};
			}
			await sub.unsubscribe();
		}
		return { ok: true, endpoint: null };
	} catch {
		return {
			ok: false,
			message: "This browser couldn't turn off alerts just now. Try again in a moment.",
		};
	}
}
// #endregion
