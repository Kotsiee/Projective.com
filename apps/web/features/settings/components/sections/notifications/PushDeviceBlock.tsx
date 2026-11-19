import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { SettingsBlock, SettingsRow } from "../../SettingsParts.tsx";
import {
	disablePush,
	enablePush,
	type PushDeviceState,
	readPushState,
} from "../../../core/push-device.ts";

/**
 * "This device" — Web Push alerts on the browser in hand (COMMS NT4; providers spec §8.2).
 *
 * It renders only when push is configured and the browser has the Push API (a control that renders
 * must do something, §3.11). On iOS outside a Home-Screen app it gives the reason and the way to
 * install instead of a switch, and when notifications are blocked it says where to unblock them. The
 * permission prompt opens only from the button, never on load. The account-wide Push switch above
 * still decides which alerts may come at all.
 */
export function PushDeviceBlock(): JSX.Element | null {
	const state = useSignal<PushDeviceState | null>(null);
	const busy = useSignal(false);
	const notice = useSignal<string | null>(null);

	useEffect(() => {
		let live = true;
		void readPushState().then((s) => {
			if (live) state.value = s;
		});
		return () => {
			live = false;
		};
	}, []);

	const s = state.value;
	if (!s || s.kind === "hidden") return null;

	async function turnOn(publicKey: string): Promise<void> {
		busy.value = true;
		notice.value = null;
		const res = await enablePush(publicKey);
		busy.value = false;
		if (res.ok) state.value = { kind: "on", publicKey, endpoint: res.endpoint };
		else notice.value = res.message;
	}

	async function turnOff(publicKey: string): Promise<void> {
		busy.value = true;
		notice.value = null;
		const res = await disablePush();
		busy.value = false;
		if (res.ok) state.value = { kind: "off", publicKey };
		else notice.value = res.message;
	}

	return (
		<SettingsBlock
			anchor="this-device"
			title="This device"
			description="Alerts that pass your settings above can appear on this device as system notifications."
		>
			{s.kind === "ios-not-installed"
				? (
					<p class="stg-note">
						On an iPhone or iPad, alerts reach Projective only once it is on your Home Screen: open
						it in Safari, tap Share, then Add to Home Screen, and turn alerts on from there.
					</p>
				)
				: s.kind === "denied"
				? (
					<p class="stg-note">
						Notifications are blocked for Projective in this browser. Allow them in the browser's
						site settings, then come back here to turn alerts on.
					</p>
				)
				: (
					<SettingsRow
						label="Alerts on this device"
						descId="stg-this-device-desc"
						description={s.kind === "on"
							? "On. Alerts arrive here even when Projective isn't open."
							: "Off. Your browser will ask once for permission."}
						control={s.kind === "on"
							? (
								<Button
									size="sm"
									variant="text"
									label="Stop on this device"
									loading={busy.value}
									aria-describedby="stg-this-device-desc"
									onClick={() => void turnOff(s.publicKey)}
								/>
							)
							: (
								<Button
									size="sm"
									label="Turn on alerts"
									loading={busy.value}
									aria-describedby="stg-this-device-desc"
									onClick={() => void turnOn(s.publicKey)}
								/>
							)}
					/>
				)}
			{notice.value ? <InlineNotice align="start" assertive text={notice.value} /> : null}
		</SettingsBlock>
	);
}
