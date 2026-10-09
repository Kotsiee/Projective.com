import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { AccountLifecycle, DateFormat, UserEmail } from "@projective/types/org";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { SectionHead } from "../SettingsParts.tsx";
import { sectionMeta } from "../../core/settings-registry.ts";
import { type AccountSimulation, simulatedAccountData } from "../../core/account-simulation.ts";
import { IdentityBlock } from "./account/IdentityBlock.tsx";
import { HandleBlock } from "./account/HandleBlock.tsx";
import { AccountTypeBlock } from "./account/AccountTypeBlock.tsx";
import { EmailsBlock } from "./account/EmailsBlock.tsx";
import { PasswordBlock } from "./account/PasswordBlock.tsx";
import { ConnectedAccountsBlock } from "./account/ConnectedAccountsBlock.tsx";
import { DeleteAccountBlock } from "./account/DeleteAccountBlock.tsx";

// #region Stylesheet carrier
import "../../styles/settings-account.css";
// #endregion

/**
 * Settings → Account (Decisions #151, #156): the legal identity (read here), the @handle and its
 * change policy, freelancer or client, the email addresses, the password, the providers the person
 * signs in with, and deleting the account. Each block owns its own writes; the section shares the
 * two pieces of state more than one block reads — the addresses (the password reset goes to the
 * sign-in one) and the lifecycle (the account type and the deletion both change it).
 *
 * The dev `accountLifecycle` axis substitutes the handle policy or the lifecycle; the blocks remount
 * per position, so each one re-seeds from what it is given.
 */

export interface AccountSectionProps {
	data: SettingsSectionDataOf<"account">;
	locale: string;
	dateFormat: DateFormat | null;
}

export function AccountSection(props: AccountSectionProps): JSX.Element {
	const meta = sectionMeta("account");
	const simulation = useSignal<AccountSimulation>("auto");

	useEffect(() => {
		const apply = () => (simulation.value = readDevSeam()?.accountLifecycle ?? "auto");
		apply();
		return subscribeDevSeam(apply);
	}, []);

	const data = simulatedAccountData(simulation.value, props.data, new Date());

	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />
			<AccountBlocks
				key={simulation.value}
				data={data}
				locale={props.locale}
				dateFormat={props.dateFormat}
			/>
		</div>
	);
}

function AccountBlocks(props: AccountSectionProps): JSX.Element {
	const emails = useSignal<UserEmail[] | null>(props.data.emails);
	const lifecycle = useSignal<AccountLifecycle | null>(props.data.lifecycle);
	const signIn = emails.value?.find((e) => e.isSignIn)?.email ?? null;

	return (
		<>
			<IdentityBlock
				identity={props.data.identity}
				locale={props.locale}
				dateFormat={props.dateFormat}
			/>
			<HandleBlock policy={props.data.handlePolicy} locale={props.locale} />
			<AccountTypeBlock lifecycle={lifecycle} locale={props.locale} />
			<EmailsBlock emails={emails} />
			<PasswordBlock signIn={signIn} />
			<ConnectedAccountsBlock connected={props.data.connected} />
			<DeleteAccountBlock lifecycle={lifecycle} locale={props.locale} />
		</>
	);
}
