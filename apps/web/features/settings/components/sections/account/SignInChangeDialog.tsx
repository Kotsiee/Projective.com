import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button, Checkbox, FormControl, Password } from "@projective/ui/fields";
import { SIGN_IN_CHANGE_LIMIT, type UserEmail } from "@projective/types/org";
import { CaptchaField } from "@features/auth/components/CaptchaField.tsx";
import { useCaptcha } from "@features/auth/hooks/useCaptcha.ts";
import { SettingsService, type SignInSaved } from "../../../core/SettingsService.ts";

const PASSWORD_HINT =
	`We ask for your password because moving your sign-in is how accounts get taken over. ` +
	`Signed up with Google and never set a password? Set one under Password first. ` +
	`You can move your sign-in ${SIGN_IN_CHANGE_LIMIT.max} times in ${SIGN_IN_CHANGE_LIMIT.windowDays} days. ` +
	`Your old address stays on your account, confirmed, until you remove it.`;

/** Props for {@link SignInChangeDialog}. */
export interface SignInChangeDialogProps {
	open: Signal<boolean>;
	/** The confirmed address to sign in with from now on. */
	target: UserEmail | null;
	/** The address the account signs in with today, when it is on the list. */
	current: UserEmail | null;
	onChanged: (saved: SignInSaved, message: string) => void;
}

/**
 * SignInChangeDialog — re-authenticates the person with their current password, then moves their
 * sign-in to a confirmed address (Decision #451). It says, before they confirm, what happens: the
 * other devices are signed out and the old address is told. Why it asks for the password, the limit
 * and what happens to the old address sit behind the password's "?" hint.
 */
export function SignInChangeDialog(props: SignInChangeDialogProps): JSX.Element {
	const captcha = useCaptcha();
	const password = useSignal("");
	const makePrimary = useSignal(false);
	const busy = useSignal(false);
	const fieldError = useSignal<string | null>(null);
	const formError = useSignal<string | null>(null);
	const fieldRef = useRef<HTMLDivElement>(null);
	const { target, current } = props;

	useEffect(() => {
		if (!props.open.value) return;
		password.value = "";
		fieldError.value = null;
		formError.value = null;
		makePrimary.value = Boolean(current?.isPrimary && target && !target.isPrimary);
	}, [props.open.value, target?.id]);

	async function confirm(): Promise<void> {
		if (!target || busy.value) return;
		if (!password.value) {
			fieldError.value = "Enter your password.";
			return;
		}
		busy.value = true;
		fieldError.value = null;
		formError.value = null;
		const captchaToken = await captcha.take();
		const res = await SettingsService.makeSignInEmail(target.id, {
			password: password.value,
			captchaToken,
			makePrimary: makePrimary.value && !target.isPrimary,
		});
		captcha.reset();
		busy.value = false;
		if (!res.ok) {
			if (res.errors?.password) fieldError.value = res.errors.password;
			else formError.value = res.message;
			return;
		}
		props.open.value = false;
		props.onChanged(res.data, changedCopy(res.data, res.message, current?.email ?? null));
	}

	const currentLabel = current?.email ?? "your current address";

	return (
		<Dialog
			visible={props.open}
			header="Sign in with a different address"
			width="var(--overlay-w-md)"
			class="stg-signin"
			initialFocusRef={fieldRef}
			footer={
				<div class="stg-signin__actions">
					<Button
						label="Cancel"
						variant="text"
						severity="secondary"
						onClick={() => (props.open.value = false)}
					/>
					<Button label="Use to sign in" loading={busy.value} onClick={confirm} />
				</div>
			}
		>
			{target
				? (
					<div class="stg-signin__body">
						<p class="stg-signin__lede">
							You'll sign in with <strong>{target.email}</strong> instead of {currentLabel}.
						</p>
						<ul class="stg-signin__list">
							<li>Your other devices will be signed out.</li>
							<li>We'll email {currentLabel} to say the sign-in changed.</li>
						</ul>
						<FormControl
							label="Your current password"
							hint={PASSWORD_HINT}
							error={fieldError.value ?? undefined}
							status={fieldError.value ? "invalid" : "default"}
						>
							{({ id, describedBy }) => (
								<div ref={fieldRef}>
									<Password
										id={id}
										aria-describedby={describedBy}
										value={password}
										toggleMask
										autoComplete="current-password"
										status={fieldError.value ? "invalid" : "default"}
										fluid
										onKeyDown={(event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
											if (event.key === "Enter") {
												event.preventDefault();
												void confirm();
											}
										}}
									/>
								</div>
							)}
						</FormControl>
						{!target.isPrimary
							? <Checkbox value={makePrimary} label="Also make it my primary address" />
							: null}
						<CaptchaField controller={captcha} action="login" />
						{formError.value
							? (
								<p class="stg-field__hint stg-field__hint--error" role="alert">
									{formError.value}
								</p>
							)
							: null}
					</div>
				)
				: null}
		</Dialog>
	);
}

/** The status line after a move: the service's sentence, then how the old address was told. */
function changedCopy(saved: SignInSaved, message: string | undefined, old: string | null): string {
	const head = message ?? "Your sign-in address is changed.";
	if (!old) return head;
	switch (saved.notice) {
		case "sent":
			return `${head} We've let ${old} know.`;
		case "logged":
			return `${head} The notice to ${old} is in the server log (development — no mail is sent here).`;
		case "unavailable":
			return `${head} We couldn't email ${old} about it.`;
	}
}
