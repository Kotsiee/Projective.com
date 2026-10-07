import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import "../styles/proposals.css";
import { settingsHref } from "@features/settings/core/settings-registry.ts";
import {
	type AllowanceSnapshot,
	meterLine,
	meterTooltip,
	refillLine,
	showsUpgrade,
} from "../core/allowance-model.ts";
import { useAllowanceClock } from "../hooks/useAllowanceClock.ts";

/**
 * AllowanceMeter — the proposal allowance as one quiet status row, directly under the profile
 * completion bar in the header account popover:
 *
 *     Proposals: 38/50 weekly · 12/12 ready
 *     Next token in 2h 45m
 *     Accelerate volume with Pro →          (only when ≤ 5 weekly are left or the buffer is empty)
 *
 * Meta register throughout (`--text-xs`, `--fw-normal`, `--text-secondary`), unbordered and unboxed:
 * it is non-actionable metadata (§B.11), so it is inline text and never a chip. The figures line is a
 * link to the viewer's sent proposals on `/projects` — the one thing a reader of the count wants next —
 * so it is focusable, which is also what lets its portal `Tooltip` (the drip and the earned bonus)
 * open for a keyboard. The refill line ticks once a minute's worth changes, from the shared clock.
 */
export function AllowanceMeter(
	{ snapshot, onNavigate }: { snapshot: AllowanceSnapshot; onNavigate?: () => void },
): JSX.Element {
	const status = snapshot.status;
	const now = useAllowanceClock(status.nextBufferRefillAt !== null);
	const refill = refillLine(snapshot, now);

	return (
		<div class="prop-meter">
			<Tooltip content={meterTooltip(status)} placement="bottom-start">
				<a class="prop-meter__line" href="/projects#proposals" onClick={onNavigate}>
					{meterLine(status)}
				</a>
			</Tooltip>
			{refill ? <span class="prop-meter__refill">{refill}</span> : null}
			{showsUpgrade(status)
				? (
					<a class="prop-meter__upgrade" href={settingsHref("billing")} onClick={onNavigate}>
						Accelerate volume with Pro →
					</a>
				)
				: null}
		</div>
	);
}
