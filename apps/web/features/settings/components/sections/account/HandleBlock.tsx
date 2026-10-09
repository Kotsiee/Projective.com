import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button, InputText } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { HANDLE_POLICY, type HandlePolicy } from "@projective/types/org";
import { IDLE, type SaveState, SaveStatus, SettingsBlock } from "../../SettingsParts.tsx";
import { SettingsService } from "../../../core/SettingsService.ts";
import { longDate } from "../../../core/settings-dates.ts";

/** Props for {@link HandleBlock}. */
export interface HandleBlockProps {
	policy: HandlePolicy | null;
	locale: string;
}

/** What the policy allows right now, in one sentence. */
function policyLine(policy: HandlePolicy, locale: string): string {
	if (policy.lockedUntil) {
		return `You changed your handle twice in ${HANDLE_POLICY.windowDays} days, so you can change it again on ${
			longDate(policy.lockedUntil, locale)
		}.`;
	}
	if (policy.remaining === 1 && policy.windowEndsAt) {
		return `You can correct it once more until ${
			longDate(policy.windowEndsAt, locale)
		}. After that change, it locks for ${HANDLE_POLICY.lockDays} days.`;
	}
	return `You can change it twice within ${HANDLE_POLICY.windowDays} days — enough to fix a typo — and then it locks for ${HANDLE_POLICY.lockDays} days.`;
}

/**
 * Handle — the person's @username and the change policy (`org.change_username`): two changes inside
 * a three-day window, then a 90-day lock. The policy is stated before a change and after it; the
 * last change before a lock says so on its button. A released handle is held for its previous
 * owner for 90 days, so nobody can step into the old links.
 */
export function HandleBlock(props: HandleBlockProps): JSX.Element {
	const policy = useSignal<HandlePolicy | null>(props.policy);
	const draft = useSignal(props.policy?.handle ?? "");
	const fieldError = useSignal<string | null>(null);
	const busy = useSignal(false);
	const status = useSignal<SaveState>(IDLE);

	const current = policy.value;
	const locked = current !== null && current.remaining === 0;
	const next = draft.value.trim().toLowerCase();
	const changed = current !== null && next.length > 0 && next !== current.handle.toLowerCase();
	const lastChange = current?.remaining === 1;

	async function save(event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		if (!changed || busy.value) return;
		busy.value = true;
		fieldError.value = null;
		status.value = { tone: "busy", text: "Saving…" };
		const res = await SettingsService.changeHandle(next);
		busy.value = false;
		if (!res.ok) {
			fieldError.value = res.errors?.handle ?? res.message;
			status.value = IDLE;
			return;
		}
		policy.value = res.data.policy;
		draft.value = res.data.policy.handle;
		await SettingsService.renewSession();
		status.value = {
			tone: "saved",
			text:
				`Your handle is now @${res.data.policy.handle}. @${res.data.previous} is held for you for ${HANDLE_POLICY.holdDays} days.`,
		};
	}

	return (
		<SettingsBlock
			anchor="handle"
			title="Handle"
			description="Your @handle is your profile's address and how people mention you."
		>
			{current === null
				? <InlineNotice align="start" text="Your handle couldn't be loaded just now." />
				: (
					<form class="stg-handle" onSubmit={save} noValidate>
						<label class="stg-field stg-field--grow">
							<span class="stg-field__label">Handle</span>
							<InputText
								value={draft}
								disabled={locked}
								autoComplete="username"
								maxLength={40}
								start="@"
								status={fieldError.value ? "invalid" : undefined}
								aria-describedby="stg-handle-hint"
								onValueChange={(value: string) => {
									draft.value = value;
									fieldError.value = null;
								}}
							/>
						</label>
						<Button
							type="submit"
							label={lastChange ? "Change and lock" : "Change handle"}
							severity={lastChange ? "warning" : "primary"}
							loading={busy.value}
							disabled={locked || !changed}
						/>
						<p
							id="stg-handle-hint"
							class={`stg-field__hint${fieldError.value ? " stg-field__hint--error" : ""}`}
							role={fieldError.value ? "alert" : undefined}
						>
							{fieldError.value ??
								"Lowercase letters, numbers and hyphens, 3 to 40 characters."}
						</p>
					</form>
				)}
			{current ? <p class="stg-note">{policyLine(current, props.locale)}</p> : null}
			<SaveStatus state={status.value} />
		</SettingsBlock>
	);
}
