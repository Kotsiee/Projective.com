import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import { Button, InputText } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import type { EmailDeliveryOutcome, EmailVerifyOutcome, UserEmail } from "@projective/types/org";
import { MAX_USER_EMAILS } from "@projective/types/org";
import { IDLE, type SaveState, SaveStatus, SettingsBlock } from "../../SettingsParts.tsx";
import { SettingsService } from "../../../core/SettingsService.ts";

// #region Copy
const DELIVERY_COPY: Readonly<Record<EmailDeliveryOutcome, (email: string) => string>> = {
	sent: (email) => `We sent a verification link to ${email}.`,
	logged: (email) =>
		`Verification link for ${email} written to the server log (development — no mail is sent here).`,
	unavailable: (email) =>
		`${email} is saved but unverified — verification emails can't be sent right now. Try "Resend link" later.`,
};

const VERIFY_COPY: Readonly<
	Record<EmailVerifyOutcome, { tone: "success" | "warning"; text: string }>
> = {
	verified: { tone: "success", text: "Email address verified." },
	expired: { tone: "warning", text: "That link has expired. Send a new one below." },
	invalid: { tone: "warning", text: "That link isn't valid. Send a new one below." },
	used: { tone: "warning", text: "That link was already used." },
	"wrong-account": {
		tone: "warning",
		text: "That link belongs to a different account. Sign in as that account to use it.",
	},
	"in-use": { tone: "warning", text: "That address is already verified on another account." },
	unavailable: {
		tone: "warning",
		text: "We couldn't check that link just now. Open it again in a few minutes.",
	},
};

/** Read and strip the `?email=` outcome the verify link lands back with. */
function takeVerifyOutcome(): EmailVerifyOutcome | null {
	if (typeof location === "undefined") return null;
	const url = new URL(location.href);
	const value = url.searchParams.get("email");
	if (!value || !(value in VERIFY_COPY)) return null;
	url.searchParams.delete("email");
	const state = history.state && typeof history.state === "object" ? history.state : {};
	history.replaceState(
		{ ...state, fClientNav: false },
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
	return value as EmailVerifyOutcome;
}
// #endregion

/** Props for {@link EmailsBlock}. */
export interface EmailsBlockProps {
	/** The person's addresses — shared with the section so the password block reads the sign-in one. */
	emails: Signal<UserEmail[] | null>;
}

/**
 * Email addresses — add, resend, make primary and remove. An address is only ever VERIFIED by the
 * link mailed to it; this block can never mark one verified (`org.user_emails` is definer-written).
 */
export function EmailsBlock(props: EmailsBlockProps): JSX.Element {
	const { emails } = props;
	const draft = useSignal("");
	const fieldError = useSignal<string | null>(null);
	const busy = useSignal<string | null>(null);
	const confirming = useSignal<string | null>(null);
	const status = useSignal<SaveState>(IDLE);
	const verify = useSignal<EmailVerifyOutcome | null>(null);

	useEffect(() => {
		verify.value = takeVerifyOutcome();
	}, []);

	async function run(
		key: string,
		call: () => ReturnType<typeof SettingsService.removeEmail>,
		done: (delivery?: EmailDeliveryOutcome) => string,
	) {
		busy.value = key;
		status.value = { tone: "busy", text: "Working…" };
		const res = await call();
		busy.value = null;
		confirming.value = null;
		if (res.ok) {
			emails.value = res.data.emails;
			status.value = {
				tone: res.data.delivery === "unavailable" ? "device" : "saved",
				text: done(res.data.delivery),
			};
		} else {
			status.value = { tone: "error", text: res.message };
		}
	}

	async function add(event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		const email = draft.value.trim().toLowerCase();
		fieldError.value = null;
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			fieldError.value = "Enter an email address like name@example.com.";
			return;
		}
		busy.value = "add";
		const res = await SettingsService.addEmail(email);
		busy.value = null;
		if (!res.ok) {
			fieldError.value = res.errors?.email ?? res.message;
			return;
		}
		emails.value = res.data.emails;
		draft.value = "";
		status.value = {
			tone: res.data.delivery === "unavailable" ? "device" : "saved",
			text: DELIVERY_COPY[res.data.delivery ?? "unavailable"](email),
		};
	}

	const list = emails.value;
	const full = (list?.length ?? 0) >= MAX_USER_EMAILS;
	const outcome = verify.value ? VERIFY_COPY[verify.value] : null;

	return (
		<SettingsBlock
			anchor="emails"
			title="Email addresses"
			description="Verified addresses can receive project and team invitations. Your primary address is where we write to you."
		>
			{outcome
				? <InlineNotice align="start" assertive={outcome.tone === "warning"} text={outcome.text} />
				: null}
			{list === null
				? <InlineNotice align="start" text="Your email addresses couldn't be loaded just now." />
				: (
					<ul class="stg-emails" aria-label="Your email addresses">
						{list.map((e) => (
							<li key={e.id} class="stg-emails__item">
								<div class="stg-emails__main">
									<span class="stg-emails__address">{e.email}</span>
									<span class="stg-emails__meta">
										{e.isPrimary ? <span class="stg-pill stg-pill--primary">Primary</span> : null}
										{e.verifiedAt
											? <span class="stg-pill">Verified</span>
											: <span class="stg-pill stg-pill--pending">Unverified</span>}
										{e.isSignIn ? <span class="stg-emails__sign">Signs you in</span> : null}
									</span>
								</div>
								{confirming.value === e.id
									? (
										<div class="stg-emails__confirm" role="group" aria-label={`Remove ${e.email}?`}>
											<span class="stg-emails__ask">Remove this address?</span>
											<Button
												size="sm"
												severity="danger"
												label="Remove"
												loading={busy.value === e.id}
												onClick={() =>
													run(
														e.id,
														() => SettingsService.removeEmail(e.id),
														() => `${e.email} removed.`,
													)}
											/>
											<Button
												size="sm"
												variant="text"
												severity="secondary"
												label="Keep"
												onClick={() => (confirming.value = null)}
											/>
										</div>
									)
									: (
										<div class="stg-emails__actions">
											{!e.verifiedAt
												? (
													<Button
														size="sm"
														variant="text"
														label="Resend link"
														loading={busy.value === `r:${e.id}`}
														onClick={() =>
															run(
																`r:${e.id}`,
																() => SettingsService.resendEmail(e.id),
																(d) => DELIVERY_COPY[d ?? "unavailable"](e.email),
															)}
													/>
												)
												: null}
											{e.verifiedAt && !e.isPrimary
												? (
													<Button
														size="sm"
														variant="text"
														label="Make primary"
														loading={busy.value === `p:${e.id}`}
														onClick={() =>
															run(
																`p:${e.id}`,
																() => SettingsService.makePrimaryEmail(e.id),
																() => `${e.email} is now your primary address.`,
															)}
													/>
												)
												: null}
											{!e.isPrimary && !e.isSignIn
												? (
													<Button
														size="sm"
														variant="text"
														severity="danger"
														label="Remove"
														aria-label={`Remove ${e.email}`}
														onClick={() => (confirming.value = e.id)}
													/>
												)
												: null}
										</div>
									)}
							</li>
						))}
					</ul>
				)}
			{list !== null
				? (
					<form class="stg-addemail" onSubmit={add} noValidate>
						<label class="stg-field stg-field--grow">
							<span class="stg-field__label">Add an email address</span>
							<InputText
								type="email"
								autoComplete="email"
								value={draft}
								disabled={full}
								status={fieldError.value ? "invalid" : undefined}
								aria-describedby="stg-addemail-hint"
								onValueChange={(v: string) => (draft.value = v)}
							/>
						</label>
						<Button
							type="submit"
							label="Add"
							loading={busy.value === "add"}
							disabled={full || !draft.value.trim()}
						/>
						<p
							id="stg-addemail-hint"
							class={`stg-field__hint${fieldError.value ? " stg-field__hint--error" : ""}`}
							role={fieldError.value ? "alert" : undefined}
						>
							{fieldError.value ?? (full
								? `You can keep up to ${MAX_USER_EMAILS} addresses. Remove one to add another.`
								: "We'll email it a link to confirm it's yours.")}
						</p>
					</form>
				)
				: null}
			<SaveStatus state={status.value} />
		</SettingsBlock>
	);
}
