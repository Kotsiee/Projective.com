import "../styles/session-disputes.css";
import type { DisputeAudit } from "@projective/types/finance";
import { disputeAuditLine, disputeRoomLine, disputeTimeLabel } from "../core/dispute-view.ts";

/**
 * DisputeRoomLog — what the room recorded of a session, as the audit froze it (Decision #383 (b)). The
 * parties and the operator read the same evidence, so a case is argued over one record.
 */
export function DisputeRoomLog({ audit }: { audit: DisputeAudit }) {
	return (
		<div class="dispute-log">
			<p class="dispute-dlg__meta">{disputeAuditLine(audit)}</p>
			{audit.timeline.length
				? (
					<ol class="dispute-log__list" aria-label="Room log">
						{audit.timeline.map((entry, i) => (
							<li key={i}>{disputeTimeLabel(entry.at)} · {disputeRoomLine(entry)}</li>
						))}
					</ol>
				)
				: null}
		</div>
	);
}
