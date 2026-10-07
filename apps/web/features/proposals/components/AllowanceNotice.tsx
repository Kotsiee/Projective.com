import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "../styles/proposals.css";
import { allowanceNotice, formatCountdown } from "@projective/types/finance";
import { type AllowanceSnapshot, msUntil } from "../core/allowance-model.ts";
import { useAllowanceClock } from "../hooks/useAllowanceClock.ts";

/**
 * AllowanceNotice — the apply modal's pre-flight statement when the applicant is out: a paced buffer
 * (with a live `04h 12m 30s` countdown to the next token), a spent week, a one-member team, or a
 * missing seat-binding permission. The sentences are `allowanceNotice`'s, the same words the server's
 * `422` uses, so the modal and a refused request can never explain the same refusal two ways.
 *
 * An `InlineNotice` (§B.4 / §C.1): one unboxed line in the meta register, separated by spacing alone.
 * `data-blocking` says whether it refuses (enforcement on) or only warns (enforcement off).
 *
 * The countdown is the one moving figure, and it is kept OUT of the accessibility tree: the notice is a
 * live region, and a figure that changes every second inside one would be announced every second. A
 * screen reader hears a still phrase instead — the wait as it stood when the status was read, and the
 * clock time it ends — which is announced once and never moves.
 */
/** `about 4 hours 12 minutes, at 11:49` — the wait as a screen reader hears it, fixed at the read. */
function spokenWait(target: string, snapshot: AllowanceSnapshot): string {
	const ms = Math.max(0, msUntil(target, snapshot, snapshot.receivedAt));
	const minutes = Math.ceil(ms / 60_000);
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	const parts = [
		h > 0 ? `${h} ${h === 1 ? "hour" : "hours"}` : null,
		m > 0 || h === 0 ? `${m} ${m === 1 ? "minute" : "minutes"}` : null,
	].filter(Boolean).join(" ");
	const at = new Date(snapshot.receivedAt + ms).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	});
	return `about ${parts}, at ${at}`;
}

export function AllowanceNotice({ snapshot }: { snapshot: AllowanceSnapshot }): JSX.Element | null {
	const notice = allowanceNotice(snapshot.status);
	const now = useAllowanceClock(notice?.countdownTo != null);
	if (!notice) return null;

	const remaining = notice.countdownTo ? msUntil(notice.countdownTo, snapshot, now) : 0;
	// Measured once, at the read — not from the ticking clock, or the phrase would change (and be
	// re-announced) every minute.
	const spoken = notice.countdownTo ? spokenWait(notice.countdownTo, snapshot) : null;

	return (
		<InlineNotice
			align="start"
			class="prop-notice"
			icon={<Icon name={notice.reason === "buffer_exhausted" ? "hourglass" : "info"} size="sm" />}
		>
			<span
				class="prop-notice__text"
				data-blocking={String(notice.blocking)}
				data-reason={notice.reason}
			>
				{notice.lead}
				{notice.countdownTo
					? (
						<>
							<span class="prop-notice__clock" aria-hidden="true">
								{formatCountdown(remaining)}
							</span>
							<span class="ui-visually-hidden">{spoken}</span>
						</>
					)
					: null}
				{notice.tail}
			</span>
		</InlineNotice>
	);
}
