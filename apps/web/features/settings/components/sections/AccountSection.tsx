import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Button, InputText } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import type { EmailDeliveryOutcome, EmailVerifyOutcome, UserEmail } from "@projective/types/org";
import { MAX_USER_EMAILS } from "@projective/types/org";
import type { SettingsSectionDataOf } from "@projective/types/settings";
import {
	IDLE,
	OutLink,
	type SaveState,
	SaveStatus,
	SectionHead,
	SettingsBlock,
	SettingsRow,
} from "../SettingsParts.tsx";
import { SettingsService } from "../../core/SettingsService.ts";
import { sectionMeta } from "../../core/settings-registry.ts";

/**
 * Settings → Account (Decision #150): the names and birth date on the account (read here, edited in
 * the profile editor or by support), every email address with its verification state, and a password
 * reset. An address is only ever VERIFIED by the link mailed to it — this section can add, resend,
 * make primary and remove, never mark one verified (the security fix the same change makes in
 * `org.user_emails`).
 */

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

function formatDob(iso: string | null): string {
	if (!iso) return "Not available";
	const date = new Date(`${iso}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat(undefined, {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(date);
}

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

export interface AccountSectionProps {
	data: SettingsSectionDataOf<"account">;
}

export function AccountSection(props: AccountSectionProps): JSX.Element {
	const meta = sectionMeta("account");
	const emails = useSignal<UserEmail[] | null>(props.data.emails);
	const draft = useSignal("");
	const fieldError = useSignal<string | null>(null);
	const busy = useSignal<string | null>(null);
	const confirming = useSignal<string | null>(null);
	const status = useSignal<SaveState>(IDLE);
	const verify = useSignal<EmailVerifyOutcome | null>(null);
	const resetState = useSignal<SaveState>(IDLE);

	useEffect(() => {
		verify.value = takeVerifyOutcome();
	}, []);

	const identity = props.data.identity;
	const list = emails.value;
	const signIn = list?.find((e) => e.isSignIn)?.email ?? null;

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

	async function sendReset(): Promise<void> {
		if (!signIn) return;
		resetState.value = { tone: "busy", text: "Sending…" };
		const res = await SettingsService.requestPasswordReset(signIn);
		resetState.value = res.ok
			? { tone: "saved", text: `If ${signIn} can sign in, a reset link is on its way.` }
			: { tone: "error", text: res.message };
	}

	const full = (list?.length ?? 0) >= MAX_USER_EMAILS;
	const outcome = verify.value ? VERIFY_COPY[verify.value] : null;

	return (
		<div class="stg-section">
			<SectionHead title={meta.label} description={meta.description} />
			{outcome
				? <InlineNotice align="start" assertive={outcome.tone === "warning"} text={outcome.text} />
				: null}

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
								<dt>Handle</dt>
								<dd>
									{identity.username ? `@${identity.username}` : "Not set"}
									<span class="stg-facts__note">
										Handles can't be changed here — <a href="/help/account">ask support</a>.
									</span>
								</dd>
							</div>
							<div class="stg-facts__row">
								<dt>Date of birth</dt>
								<dd>
									{formatDob(identity.dob)}
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

			<SettingsBlock
				anchor="emails"
				title="Email addresses"
				description="Verified addresses can receive project and team invitations. Your primary address is where we write to you."
			>
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
											<div
												class="stg-emails__confirm"
												role="group"
												aria-label={`Remove ${e.email}?`}
											>
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

			<SettingsBlock anchor="password" title="Password">
				<SettingsRow
					label="Reset your password"
					descId="stg-password-desc"
					description={signIn
						? `We'll email a reset link to ${signIn}.`
						: "Your sign-in address couldn't be read, so a link can't be sent from here."}
					control={
						<Button
							variant="outlined"
							size="sm"
							label="Email me a link"
							disabled={!signIn}
							loading={resetState.value.tone === "busy"}
							onClick={sendReset}
						/>
					}
				/>
				<SaveStatus state={resetState.value} />
			</SettingsBlock>
		</div>
	);
}
