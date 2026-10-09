import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import {
	IDLE,
	type SaveState,
	SaveStatus,
	SettingsBlock,
	SettingsRow,
} from "../../SettingsParts.tsx";
import { SettingsService } from "../../../core/SettingsService.ts";

/** Props for {@link PasswordBlock}. */
export interface PasswordBlockProps {
	/** The GoTrue sign-in address, or `null` when it couldn't be read. */
	signIn: string | null;
}

/** Password — a reset link mailed to the sign-in address (GoTrue sends it). */
export function PasswordBlock(props: PasswordBlockProps): JSX.Element {
	const state = useSignal<SaveState>(IDLE);

	async function sendReset(): Promise<void> {
		if (!props.signIn) return;
		state.value = { tone: "busy", text: "Sending…" };
		const res = await SettingsService.requestPasswordReset(props.signIn);
		state.value = res.ok
			? { tone: "saved", text: `If ${props.signIn} can sign in, a reset link is on its way.` }
			: { tone: "error", text: res.message };
	}

	return (
		<SettingsBlock anchor="password" title="Password">
			<SettingsRow
				label="Reset your password"
				descId="stg-password-desc"
				description={props.signIn
					? `We'll email a reset link to ${props.signIn}.`
					: "Your sign-in address couldn't be read, so a link can't be sent from here."}
				control={
					<Button
						variant="outlined"
						size="sm"
						label="Email me a link"
						disabled={!props.signIn}
						loading={state.value.tone === "busy"}
						onClick={sendReset}
					/>
				}
			/>
			<SaveStatus state={state.value} />
		</SettingsBlock>
	);
}
