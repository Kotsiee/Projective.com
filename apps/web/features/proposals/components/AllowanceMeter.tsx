import type { JSX } from "preact";
import { ProgressBar, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "../styles/proposals.css";
import { settingsHref } from "@features/settings/core/settings-registry.ts";
import {
	type AllowanceSnapshot,
	bufferLine,
	bufferShare,
	meterLabel,
	meterTooltip,
	refillLine,
	resetLine,
	showsPacing,
	showsUpgrade,
	weeklyLine,
	weeklyShare,
} from "../core/allowance-model.ts";
import { useAllowanceClock } from "../hooks/useAllowanceClock.ts";

/**
 * AllowanceMeter — the proposal allowance as a compact bar under the identity block of the header
 * account popover:
 *
 *     Proposals                      38/50
 *     ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░
 *     38 of 50 left · Resets Mon 09:00
 *
 * The weekly bar is always drawn. A second, pacing bar appears only while the buffer is what blocks a
 * spend — no tokens ready while the week still has room — with when the next token arrives
 * (`showsPacing`, Decision #520). Once the week is spent the meter says so and when it resets; the
 * buffer offers nothing then, so no bar promises it. The heading row links to the viewer's sent
 * proposals, and its portal `Tooltip` explains the drip and the earned bonus.
 */
export function AllowanceMeter(
	{ snapshot, onNavigate }: { snapshot: AllowanceSnapshot; onNavigate?: () => void },
): JSX.Element {
	const status = snapshot.status;
	const now = useAllowanceClock(status.nextBufferRefillAt !== null);
	const refill = refillLine(snapshot, now);
	const pacing = showsPacing(status);
	const reset = resetLine(status);

	return (
		<div class="prop-meter">
			<Tooltip content={meterTooltip(status)} placement="bottom-start">
				<a
					class="prop-meter__head"
					href="/projects#proposals"
					aria-label={meterLabel(status)}
					onClick={onNavigate}
				>
					<span class="prop-meter__label">Proposals</span>
					<span class="prop-meter__figure">
						{status.weeklyRemaining}/{status.weeklyGranted}
					</span>
				</a>
			</Tooltip>
			<ProgressBar
				class="prop-meter__bar"
				value={weeklyShare(status)}
				aria-label={`Weekly proposals, ${weeklyLine(status)}`}
			/>
			<span class="prop-meter__sub">
				{weeklyLine(status)}
				{reset ? ` · ${reset}` : null}
			</span>

			{pacing && (
				<>
					<span class="prop-meter__label prop-meter__label--pacing">Pacing</span>
					<ProgressBar
						class="prop-meter__bar prop-meter__bar--pacing"
						value={bufferShare(status)}
						aria-label={`Proposal tokens, ${bufferLine(status)}`}
					/>
					<span class="prop-meter__sub">
						{bufferLine(status)}
						{refill ? ` · ${refill}` : null}
					</span>
				</>
			)}

			{showsUpgrade(status)
				? (
					<a class="prop-meter__upgrade" href={settingsHref("billing")} onClick={onNavigate}>
						Accelerate volume with Pro <Icon name="arrow-right" />
					</a>
				)
				: null}
		</div>
	);
}
