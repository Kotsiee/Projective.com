import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import type { AccountLifecycle } from "@projective/types/org";
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

/** Props for {@link AccountTypeBlock}. */
export interface AccountTypeBlockProps {
	lifecycle: Signal<AccountLifecycle | null>;
	locale: string;
}

/**
 * Freelancer or client — the role switch. A client becomes a freelancer through the standard
 * onboarding (`/become-partner`). A freelancer switching to client-only goes through the
 * high-friction {@link RemovalDialog}: the persona drops at once and the seller profile is erased
 * after 90 days, reversibly until then. A scheduled removal shows its date and one way back.
 */
export function AccountTypeBlock(props: AccountTypeBlockProps): JSX.Element {
	const dialog = useSignal(false);
	const busy = useSignal(false);
	const status = useSignal<SaveState>(IDLE);
	const life = props.lifecycle.value;

	async function keepProfile(): Promise<void> {
		busy.value = true;
		status.value = { tone: "busy", text: "Restoring…" };
		const res = await SettingsService.cancelDeletion("freelancer_profile");
		busy.value = false;
		if (!res.ok) {
			status.value = { tone: "error", text: res.message };
			return;
		}
		props.lifecycle.value = res.data.lifecycle;
		await SettingsService.renewSession();
		globalThis.location.reload();
	}

	async function scheduled(next: AccountLifecycle): Promise<void> {
		props.lifecycle.value = next;
		status.value = { tone: "busy", text: "Switching you to client only…" };
		await SettingsService.renewSession();
		globalThis.location.reload();
	}

	let body: JSX.Element;
	if (!life) {
		body = <InlineNotice align="start" text="Your account type couldn't be read just now." />;
	} else if (life.freelancerRemoval) {
		body = (
			<SettingsRow
				label="Client only"
				description={`Your freelancer profile will be permanently deleted on ${
					longDate(life.freelancerRemoval.scheduledFor, props.locale)
				}. Your listings are paused until then.`}
				control={
					<Button
						variant="outlined"
						size="sm"
						label="Keep my freelancer profile"
						loading={busy.value}
						onClick={keepProfile}
					/>
				}
			/>
		);
	} else if (life.isFreelancer) {
		body = (
			<SettingsRow
				label="Freelancer and client"
				description="You can sell your skills and hire others."
				control={
					<Button
						variant="outlined"
						severity="danger"
						size="sm"
						label="Switch to client only"
						onClick={() => (dialog.value = true)}
					/>
				}
			/>
		);
	} else {
		body = (
			<SettingsRow
				label="Client"
				description="You hire on Projective. Become a freelancer to offer your skills too."
				control={
					<a
						class="ui-button ui-button--primary ui-button--outlined ui-button--size-sm"
						href="/become-partner"
					>
						<span class="ui-button__label">Become a freelancer</span>
					</a>
				}
			/>
		);
	}

	return (
		<SettingsBlock
			anchor="account-type"
			title="Freelancer or client"
			description="A freelancer is also a client: switching to client only removes the seller half."
		>
			{body}
			<SaveStatus state={status.value} />
			{life?.isFreelancer
				? (
					<RemovalDialog
						open={dialog}
						scope="freelancer_profile"
						blockers={life.freelancerBlockers}
						onScheduled={scheduled}
					/>
				)
				: null}
		</SettingsBlock>
	);
}
