import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

/**
 * LocalTimeClock — the profile meta rail's live local-time + timezone readout. Client-only: it renders
 * a stable placeholder on the server (so there is no hydration mismatch from a server↔client clock
 * skew), then fills in the real time in an effect and re-ticks each minute. The time is formatted in
 * the profile's IANA timezone, so a viewer in another region sees the profile owner's wall clock.
 */
export interface LocalTimeClockProps {
	/** IANA timezone id (e.g. `Europe/London`). */
	timezone: string;
}

/** Format a 12-hour `h:mm AM/PM` time + a short timezone label (e.g. "GMT+2"), defensive against bad ids. */
function formatNow(timezone: string): { time: string; zone: string } {
	try {
		const now = new Date();
		const time = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		}).format(now);
		const parts = new Intl.DateTimeFormat("en-GB", {
			timeZone: timezone,
			hour: "2-digit",
			timeZoneName: "shortOffset",
		}).formatToParts(now);
		const zone = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
		return { time, zone };
	} catch {
		return { time: "--:--", zone: "" };
	}
}

export default function LocalTimeClock({ timezone }: LocalTimeClockProps): JSX.Element {
	const time = useSignal<string>("--:--");
	const zone = useSignal<string>("");

	useEffect(() => {
		const tick = () => {
			const next = formatNow(timezone);
			time.value = next.time;
			zone.value = next.zone;
		};
		tick();
		const id = setInterval(tick, 30_000);
		return () => clearInterval(id);
	}, [timezone]);

	return (
		<span class="pf-clock">
			{zone.value ? <span class="pf-clock__zone">{zone.value}</span> : null}
			<span class="pf-clock__time">{time.value}</span>
		</span>
	);
}
