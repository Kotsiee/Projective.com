import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import { Button, InputText } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import type { EmailDeliveryOutcome, EmailVerifyOutcome, UserEmail } from "@projective/types/org";
import { EMAIL_TOKEN_PARAM, MAX_USER_EMAILS } from "@projective/types/org";
import {
	IDLE,
	type SaveState,
	SaveStatus,
	SettingsBlock,
	StatusMark,
} from "../../SettingsParts.tsx";
import { SettingsService } from "../../../core/SettingsService.ts";
import { SignInChangeDialog } from "./SignInChangeDialog.tsx";

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

/** Read and strip one query parameter, leaving the rest of the address as it was. */
function takeParam(name: string): string | null {
	if (typeof location === "undefined") return null;
	const url = new URL(location.href);
	const value = url.searchParams.get(name);
	if (value === null) return null;
	url.searchParams.delete(name);
	const state = history.state && typeof history.state === "object" ? history.state : {};
	history.replaceState(
		{ ...state, fClientNav: false },
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
	return value;
}

/** Read and strip the `?email=` outcome a refused link lands with. */
function takeVerifyOutcome(): EmailVerifyOutcome | null {
	const value = takeParam("email");
	return value && value in VERIFY_COPY ? value as EmailVerifyOutcome : null;
}
// #endregion

/** Props for {@link EmailsBlock}. */
export interface EmailsBlockProps {
	/** The person's addresses — shared with the section so the password block reads the sign-in one. */
	emails: Signal<UserEmail[] | null>;
}

/**
 * Email addresses — add, resend, make primary, use to sign in ({@link SignInChangeDialog}) and
 * remove. An address is only ever VERIFIED by the link mailed to it; this block can never mark one
 * verified (`org.user_emails` is definer-written).
 *
 * The mailed link spends nothing when it is opened (PRD-C11): it lands here with its token in
 * `?email-token=`, which is taken off the address at once, and the person presses Confirm to spend it
 * (`POST /api/user/emails/verify`). Not now drops it; the link still works until it expires.
 */
export function EmailsBlock(props: EmailsBlockProps): JSX.Element {
	const { emails } = props;
	const draft = useSignal("");
	const fieldError = useSignal<string | null>(null);
	const busy = useSignal<string | null>(null);
	const confirming = useSignal<string | null>(null);
	const status = useSignal<SaveState>(IDLE);
	const verify = useSignal<EmailVerifyOutcome | null>(null);
	/** A mailed link's token, held for the person's press of Confirm. */
	const pending = useSignal<string | null>(null);
	const signInOpen = useSignal(false);
	const signInTarget = useSignal<UserEmail | null>(null);

	useEffect(() => {
		verify.value = takeVerifyOutcome();
		pending.value = takeParam(EMAIL_TOKEN_PARAM);
	}, []);

	async function confirmLink(token: string): Promise<void> {
		busy.value = "link";
		const res = await SettingsService.confirmEmail(token);
		busy.value = null;
		if (!res.ok) {
			status.value = { tone: "error", text: res.message };
			return;
		}
		pending.value = null;
		verify.value = res.data.outcome;
		if (res.data.outcome !== "verified") return;
		const fresh = await SettingsService.listEmails();
		if (fresh.ok) emails.value = fresh.data.emails;
	}

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
			{pending.value
				? (
					<div
						class="stg-emails__confirm stg-emails__confirm--lead"
						role="group"
						aria-label="Confirm your email address"
					>
						<span class="stg-emails__ask">Confirm the address this link was sent to?</span>
						<Button
							size="sm"
							label="Confirm"
							loading={busy.value === "link"}
							onClick={() => {
								if (pending.value) void confirmLink(pending.value);
							}}
						/>
						<Button
							size="sm"
							variant="text"
							severity="secondary"
							label="Not now"
							disabled={busy.value === "link"}
							onClick={() => (pending.value = null)}
						/>
					</div>
				)
				: null}
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
										{e.isPrimary
											? <StatusMark tone="neutral" glyph="check" label="Primary" />
											: null}
										{e.verifiedAt
											? <StatusMark tone="success" label="Verified" />
											: <StatusMark tone="warning" label="Unverified" />}
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
											{e.verifiedAt && !e.isSignIn
												? (
													<Button
														size="sm"
														variant="text"
														label="Use to sign in"
														aria-label={`Sign in with ${e.email}`}
														onClick={() => {
															signInTarget.value = e;
															signInOpen.value = true;
														}}
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
			<SignInChangeDialog
				open={signInOpen}
				target={signInTarget.value}
				current={list?.find((e) => e.isSignIn) ?? null}
				onChanged={(saved, message) => {
					emails.value = saved.emails;
					status.value = { tone: "saved", text: message };
				}}
			/>
		</SettingsBlock>
	);
}
