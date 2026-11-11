import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { browserZone, sittingLabel } from "../core/sitting-time.ts";

/** Props for {@link SittingTime}. */
export interface SittingTimeProps {
	/** The sitting's start, ISO-8601. */
	startsAt: string;
	/** The sitting's end, ISO-8601. */
	endsAt: string;
}

/**
 * SittingTime — one scheduled sitting's day and time on a listing page. The first byte prints it in
 * UTC and says so; hydration re-renders it in the viewer's own zone, which only the browser knows.
 */
export default function SittingTime({ startsAt, endsAt }: SittingTimeProps): JSX.Element {
	const zone = useSignal<string | null>(null);
	useEffect(() => {
		zone.value = browserZone();
	}, []);
	return (
		<time class="evp-track__meta" dateTime={startsAt}>
			{sittingLabel(startsAt, endsAt, zone.value)}
		</time>
	);
}
