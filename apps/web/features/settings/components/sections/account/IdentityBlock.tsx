import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import { type DateFormat, formatDateValue } from "@projective/types/org";
import { OutLink, SettingsBlock } from "../../SettingsParts.tsx";

/** Props for {@link IdentityBlock}. */
export interface IdentityBlockProps {
	identity: SettingsSectionDataOf<"account">["identity"];
	locale: string;
	dateFormat: DateFormat | null;
}

/**
 * Name & date of birth — the legal identity on the account, read-only here: the name is edited in
 * the profile editor, the birth date only by support. The date is written in the person's own date
 * format (Settings → Language & region).
 */
export function IdentityBlock(props: IdentityBlockProps): JSX.Element {
	const { identity } = props;
	const dob = identity?.dob
		? formatDateValue(new Date(`${identity.dob}T00:00:00Z`), {
			locale: props.locale,
			dateFormat: props.dateFormat,
			timeZone: "UTC",
		})
		: "";
	return (
		<SettingsBlock
			anchor="identity"
			title="Name & date of birth"
			description="Your legal name is used for verification and invoices."
		>
			{identity
				? (
					<dl class="stg-facts">
						<div class="stg-facts__row">
							<dt>Legal name</dt>
							<dd>
								{[identity.firstName, identity.lastName].filter(Boolean).join(" ") || "Not set"}
							</dd>
						</div>
						<div class="stg-facts__row">
							<dt>Date of birth</dt>
							<dd>
								<span class="stg-tabular">{dob || "Not available"}</span>
								<span class="stg-facts__note">
									To correct it, <a href="/help/account">contact support</a>.
								</span>
							</dd>
						</div>
					</dl>
				)
				: <InlineNotice align="start" text="Your account details couldn't be loaded just now." />}
			{identity?.username
				? <OutLink href={`/${identity.username}/edit`}>Edit your name on your profile</OutLink>
				: null}
		</SettingsBlock>
	);
}
