import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { type AccountLifecycle, DELETION_WINDOW_DAYS } from "@projective/types/org";
import {
	IDLE,
	type SaveState,
	SaveStatus,
	SettingsBlock,
	SettingsRow,
} from "../../SettingsParts.tsx";
import { SettingsService } from "../../../core/SettingsService.ts";
import { RemovalDialog } from "./RemovalDialog.tsx";
import { longDate } from "../../../core/settings-dates.ts";

/** Props for {@link DeleteAccountBlock}. */
export interface DeleteAccountBlockProps {
	lifecycle: Signal<AccountLifecycle | null>;
	locale: string;
}

/**
 * Delete account — schedules the erasure through the {@link RemovalDialog} (hidden at once, erased
 * after 30 days); a scheduled deletion shows its date and one way back.
 */
export function DeleteAccountBlock(props: DeleteAccountBlockProps): JSX.Element {
	const dialog = useSignal(false);
	const busy = useSignal(false);
	const status = useSignal<SaveState>(IDLE);
	const life = props.lifecycle.value;

	async function keepAccount(): Promise<void> {
		busy.value = true;
		status.value = { tone: "busy", text: "Cancelling…" };
		const res = await SettingsService.cancelDeletion("account");
		busy.value = false;
		if (!res.ok) {
			status.value = { tone: "error", text: res.message };
			return;
		}
		props.lifecycle.value = res.data.lifecycle;
		status.value = {
			tone: "saved",
			text: "Your account will not be deleted, and your profile is visible again.",
		};
	}

	return (
		<SettingsBlock
			anchor="delete-account"
			title="Delete account"
			description={`Deleting your account erases your profile and personal details after ${DELETION_WINDOW_DAYS.account} days.`}
		>
			{!life
				? <InlineNotice align="start" text="Your account's status couldn't be read just now." />
				: life.accountDeletion
				? (
					<SettingsRow
						label="Deletion scheduled"
						description={`Your account will be permanently deleted on ${
							longDate(life.accountDeletion.scheduledFor, props.locale)
						}. Your profile is hidden until then.`}
						control={
							<Button
								variant="outlined"
								size="sm"
								label="Keep my account"
								loading={busy.value}
								onClick={keepAccount}
							/>
						}
					/>
				)
				: (
					<SettingsRow
						label="Delete your account"
						description="You'll be asked to confirm, and told anything that has to be finished first."
						control={
							<Button
								variant="outlined"
								severity="danger"
								size="sm"
								label="Delete account…"
								onClick={() => (dialog.value = true)}
							/>
						}
					/>
				)}
			<SaveStatus state={status.value} />
			{life && !life.accountDeletion
				? (
					<RemovalDialog
						open={dialog}
						scope="account"
						blockers={life.accountBlockers}
						onScheduled={(next) => {
							props.lifecycle.value = next;
							status.value = {
								tone: "saved",
								text:
									"Your account is scheduled for deletion. You can cancel here any time before then.",
							};
						}}
					/>
				)
				: null}
		</SettingsBlock>
	);
}
