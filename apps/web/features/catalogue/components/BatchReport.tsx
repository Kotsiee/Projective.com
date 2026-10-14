import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { batchState } from "../core/console-store.ts";
import { dismissBatchReport } from "../core/console-actions.ts";

/**
 * BatchReport — what the batch bar's last run did, above the listings: one line when every listing
 * passed, and the title and reason of each one that did not otherwise. A batch is not all-or-nothing,
 * so a failure is named per listing rather than summarised as "something went wrong".
 */
export function BatchReport(): JSX.Element | null {
	const run = batchState.value;
	if (run.running || run.verb === null) return null;

	if (run.error) {
		return (
			<InlineNotice
				class="cat-batchreport"
				align="start"
				assertive
				text={run.error}
				actionLabel="Dismiss"
				onAction={dismissBatchReport}
			/>
		);
	}

	const failed = run.results.filter((o) => !o.ok);
	const total = run.results.length;
	if (failed.length === 0) {
		return (
			<InlineNotice
				class="cat-batchreport"
				align="start"
				text={`${total} ${total === 1 ? "listing" : "listings"} ${run.verb.past}.`}
				actionLabel="Dismiss"
				onAction={dismissBatchReport}
			/>
		);
	}

	return (
		<InlineNotice
			class="cat-batchreport"
			align="start"
			assertive
			actionLabel="Dismiss"
			onAction={dismissBatchReport}
		>
			<span class="cat-batchreport__lead">
				{failed.length} of {total} couldn't be {run.verb.past}. They're still selected.
			</span>
			{failed.map((o) => (
				<span key={o.id} class="cat-batchreport__row">
					<span class="cat-batchreport__title">{run.titles[o.id] ?? o.id}</span>
					<span class="cat-batchreport__reason">{o.message ?? "Refused."}</span>
				</span>
			))}
		</InlineNotice>
	);
}
