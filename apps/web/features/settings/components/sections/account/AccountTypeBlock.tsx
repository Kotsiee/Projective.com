import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import type { AccountLifecycle } from "@projective/types/org";
import { RESTRICTED_REFUSAL } from "@projective/types/auth";
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
	/** A restricted (13–17) account: the block names the limit instead of offering an upgrade. */
	restricted: boolean;
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
		settle("Your freelancer profile is restored.", res.data.claimsStale === true);
	}

	function scheduled(next: AccountLifecycle, claimsStale: boolean): void {
		props.lifecycle.value = next;
		settle("You're switched to client only.", claimsStale);
	}

	function settle(done: string, claimsStale: boolean): void {
		if (claimsStale) {
			status.value = {
				tone: "saved",
				text: `${done} Menus may show your old account type for up to an hour.`,
			};
			return;
		}
		status.value = { tone: "busy", text: "Updating your menus…" };
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
						severity="neutral"
						variant="outlined"
						size="sm"
						label="Keep my freelancer profile"
						loading={busy.value}
						onClick={keepProfile}
					/>
				}
			/>
		);
	} else if (props.restricted) {
		body = <SettingsRow label="Limited account" description={RESTRICTED_REFUSAL} control={null} />;
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
						class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm"
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
