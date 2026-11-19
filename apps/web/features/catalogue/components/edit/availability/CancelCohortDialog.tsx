import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { useIsMobile } from "@projective/ui/hooks";
import type { ListingCohorts } from "@projective/types/projects";
import { cancelConsequence, cohortForAddress } from "../../../core/cohort-model.ts";
import { cancelCohort, cohortBusy, setCohortDialog } from "../../../core/cohort-store.ts";
import { workspaceUrl } from "../../../core/workspace-store.ts";

/**
 * CancelCohortDialog — the seller confirms cancelling a cohort before its first session (Decision
 * #498), at `?cohort=cancel:<first sitting's ssn- slug>`. It says what happens before the press: every
 * seat is refunded in full, the sessions leave the calendar, and the waitlist keeps its order. An
 * address naming a cohort that can no longer be cancelled opens nothing. A bottom sheet on a phone.
 */
export function CancelCohortDialog(props: { listing: string; data: ListingCohorts }): JSX.Element {
	const mobile = useIsMobile();
	const visible = useSignal(false);
	const failure = useSignal<string | null>(null);

	const address = workspaceUrl.value.cohort;
	const cohort = cohortForAddress(props.data, address);

	useSignalEffect(() => {
		const want = !!cohortForAddress(props.data, workspaceUrl.value.cohort);
		if (want && !visible.peek()) failure.value = null;
		visible.value = want;
	});

	async function confirm(): Promise<void> {
		if (!cohort) return;
		const out = await cancelCohort(props.listing, cohort.cohortId);
		if (!out.ok) failure.value = out.message;
	}

	return (
		<Dialog
			visible={visible}
			role="alertdialog"
			position={mobile ? "bottom" : "center"}
			header="Cancel this cohort?"
			width="min(30rem, calc(100vw - 2rem))"
			onVisibleChange={(v) => {
				if (!v && workspaceUrl.peek().cohort?.startsWith("cancel:")) setCohortDialog(undefined);
			}}
			footer={
				<div class="cat-ws__dialog-actions">
					<Button
						label="Keep it"
						severity="neutral"
						variant="outlined"
						disabled={cohortBusy.value}
						onClick={() => setCohortDialog(undefined)}
					/>
					<Button
						label="Cancel cohort"
						severity="danger"
						loading={cohortBusy.value}
						disabled={cohortBusy.value || !cohort}
						onClick={() => void confirm()}
					/>
				</div>
			}
		>
			{cohort && (
				<div class="cat-coh__form">
					{failure.value && <InlineNotice assertive align="start" text={failure.value} />}
					<p class="cat-ws__dialog-text">
						{cohort.underFilled
							? `"${cohort.name}" closed with ${cohort.seatsPaid} of the ${cohort.minSeats} seats it needs.`
							: `"${cohort.name}" hasn't started yet.`} {cancelConsequence(cohort)}
					</p>
					<p class="cat-coh__disclosure">
						This can't be undone. You can open another cohort afterwards.
					</p>
				</div>
			)}
		</Dialog>
	);
}
