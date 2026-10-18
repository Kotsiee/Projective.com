import type { ComponentChildren, JSX } from "preact";
import type { Signal } from "@preact/signals";
import {
	Button,
	Checkbox,
	FieldLegend,
	FormControl,
	InputText,
	RadioGroup,
	Select,
	Textarea,
} from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import {
	CONTACT_BUDGETS,
	CONTACT_COMPANY_SIZES,
	CONTACT_LIMITS,
	CONTACT_SECURITY_REPORTS,
	CONTACT_SUPPORT_TOPICS,
	type ContactEngagementOption,
	type ContactIntent,
	engagementHref,
} from "@projective/types/contact";
import type { ContactFormState } from "../core/contact-model.ts";
import { counterText } from "../core/contact-model.ts";
import {
	BOOKING_UNAVAILABLE_REASON,
	DISCLOSURE_NOTE,
	INTENT_COPY,
	PROJECTIVE_SALES_HANDLE,
} from "../core/contact-copy.ts";
import { AttachmentDropzone, type AttachmentEntry } from "./AttachmentDropzone.tsx";

/**
 * IntentFieldsets — the four forms of `/contact` (Decision #276), one `<fieldset>` each with its own
 * legend, rendered together into one grid cell by the `ContactIntake` island so switching intent
 * never moves the page. The inactive three are `disabled` (never submitted, never focusable),
 * `inert` and `aria-hidden`; every control is a real named input, so the active fieldset also works
 * as a plain form post without JavaScript.
 */

/** Every field's signal, keyed like {@link ContactFormState}. */
export type FieldSignals = { [K in keyof ContactFormState]: Signal<ContactFormState[K]> };

/** What every fieldset reads. */
export interface IntakeModel {
	fields: FieldSignals;
	errors: Signal<Record<string, string>>;
	/**
	 * A refusal of the whole request (a rate limit, the intake unavailable, files still checking),
	 * shown beside the active form's Send button — where the sender is looking when it arrives.
	 */
	alert: Signal<string | null>;
	/** The intent whose fieldset is active — the one that shows the alert. */
	activeIntent: ContactIntent;
	busy: Signal<boolean>;
	signedIn: boolean;
	/**
	 * Whether the island has run. Before it has (or on a page whose JavaScript never loads) the form is
	 * a plain post, and the few rules that need a script to hold — removing the name and email of an
	 * anonymous report — are carried by CSS and the server instead.
	 */
	hydrated: boolean;
	engagements: readonly ContactEngagementOption[];
	/** Each intent's own files — a file belongs to the form it was added to. */
	attachments: Readonly<Record<ContactIntent, Signal<Record<string, AttachmentEntry>>>>;
	loginHref: string;
	/** Say something through the intake's polite live region. */
	announce: (text: string) => void;
}

// #region Field primitives
type TextKey = {
	[K in keyof ContactFormState]: ContactFormState[K] extends string ? K : never;
}[keyof ContactFormState];

function clearError(model: IntakeModel, name: string): void {
	if (!(name in model.errors.value)) return;
	const next = { ...model.errors.value };
	delete next[name];
	model.errors.value = next;
}

interface TextFieldProps {
	model: IntakeModel;
	name: TextKey;
	label: string;
	type?: string;
	autoComplete?: string;
	required?: boolean;
	/**
	 * The input's own `required` attribute, when it must differ from what the label says — a field
	 * that CSS may hide without JavaScript cannot carry it, or the browser refuses to send the form.
	 */
	nativeRequired?: boolean;
	hint?: string;
	maxLength?: number;
}

function TextField(props: TextFieldProps): JSX.Element {
	const {
		model,
		name,
		label,
		type = "text",
		autoComplete,
		required,
		nativeRequired,
		hint,
		maxLength,
	} = props;
	const error = model.errors.value[name];
	return (
		<div data-field={name}>
			<FormControl
				label={label}
				hint={hint}
				required={required}
				status={error ? "invalid" : "default"}
				error={error}
			>
				{({ id, describedBy, status, required: req }) => (
					<InputText
						id={id}
						name={name}
						type={type}
						autoComplete={autoComplete}
						maxLength={maxLength}
						aria-describedby={describedBy}
						status={status}
						required={nativeRequired ?? req}
						value={model.fields[name]}
						onValueChange={() => clearError(model, name)}
						fluid
					/>
				)}
			</FormControl>
		</div>
	);
}

function SelectField(
	props: {
		model: IntakeModel;
		name: TextKey;
		label: string;
		options: ReadonlyArray<{ value: string; label: string }>;
	},
): JSX.Element {
	const { model, name, label, options } = props;
	const error = model.errors.value[name];
	return (
		<div data-field={name}>
			<FormControl label={label} status={error ? "invalid" : "default"} error={error} required>
				{({ id, describedBy, status }) => (
					<Select
						id={id}
						name={name}
						options={options.map((o) => ({ value: o.value, label: o.label }))}
						aria-describedby={describedBy}
						status={status}
						value={model.fields[name]}
						onValueChange={() => clearError(model, name)}
						fluid
					/>
				)}
			</FormControl>
		</div>
	);
}

function MessageField(props: { model: IntakeModel; label: string; hint: string }): JSX.Element {
	const { model, label, hint } = props;
	const error = model.errors.value.message;
	const length = model.fields.message.value.length;
	return (
		<div data-field="message">
			<FormControl
				label={label}
				hint={`${hint} ${counterText(length, CONTACT_LIMITS.messageMax)}`}
				required
				status={error ? "invalid" : "default"}
				error={error}
				class="ctc-counter"
			>
				{({ id, describedBy, status, required }) => (
					<Textarea
						id={id}
						name="message"
						rows={6}
						autoResize
						maxRows={16}
						minLength={CONTACT_LIMITS.messageMin}
						maxLength={CONTACT_LIMITS.messageMax}
						aria-describedby={describedBy}
						status={status}
						required={required}
						value={model.fields.message}
						onValueChange={() => clearError(model, "message")}
						fluid
					/>
				)}
			</FormControl>
		</div>
	);
}

/** Name + reply address, side by side where the column allows. */
function SenderRow(
	props: { model: IntakeModel; emailLabel?: string; nativeRequired?: boolean; class?: string },
): JSX.Element {
	return (
		<div class={props.class ? `ctc-fields__row ${props.class}` : "ctc-fields__row"}>
			<TextField
				model={props.model}
				name="name"
				label="Your name"
				autoComplete="name"
				required
				nativeRequired={props.nativeRequired}
				maxLength={CONTACT_LIMITS.name}
			/>
			<TextField
				model={props.model}
				name="email"
				label={props.emailLabel ?? "Email"}
				type="email"
				autoComplete="email"
				required
				nativeRequired={props.nativeRequired}
				maxLength={CONTACT_LIMITS.email}
				hint="We'll reply here."
			/>
		</div>
	);
}

/** A routing note: one glyph, the sentences, and the one action it points to. */
function RouteNote(
	props: { icon: "info" | "lock" | "shield"; children: ComponentChildren },
): JSX.Element {
	return (
		<div class="ctc-route">
			<span class="ctc-route__icon" aria-hidden="true">
				<Icon name={props.icon} />
			</span>
			<div class="ctc-route__body">{props.children}</div>
		</div>
	);
}

/** The attachments block — the dropzone for a signed-in sender, the reason for anyone else. */
function Attachments(
	props: { model: IntakeModel; intent: ContactIntent; anonymous?: boolean },
): JSX.Element {
	const { model, intent, anonymous } = props;
	const error = model.errors.value.attachmentIds;
	if (anonymous) {
		return (
			<p class="ctc-note">
				Attachments are linked to an account, so an anonymous report can't carry them. Describe what
				you found in the message instead.
			</p>
		);
	}
	if (!model.signedIn) {
		return (
			<p class="ctc-note">
				Attachments need an account, because a file is stored in its sender's name.{" "}
				<a href={model.loginHref}>Sign in to attach files</a>, or describe them and we'll ask for
				them.
			</p>
		);
	}
	return (
		<div data-field="attachmentIds">
			<AttachmentDropzone
				entries={model.attachments[intent]}
				labelId={`ctc-drop-${intent}`}
				disabled={model.busy.value}
			/>
			{error && <p class="ctc-drop__why" role="alert">{error}</p>}
		</div>
	);
}

/** The form's foot: the legend for the asterisk, the privacy line and the actions. */
function Actions(
	props: { model: IntakeModel; intent: ContactIntent; aside?: ComponentChildren },
): JSX.Element {
	const { model, intent, aside } = props;
	return (
		<>
			<FieldLegend />
			<p class="ctc-note">
				We use what you send only to answer this request.{" "}
				<a href="/legal/privacy">How we handle your data</a>.
			</p>
			{
				/* Announced by the package Message itself (danger is role="alert", assertive), so it is
				   not also sent to the polite live region. */
			}
			{model.alert.value && model.activeIntent === intent && (
				<Message severity="danger" class="ctc-form__alert">{model.alert.value}</Message>
			)}
			<div class="ctc-actions">
				{aside && <div class="ctc-actions__aside">{aside}</div>}
				<Button
					type="submit"
					severity="primary"
					variant="filled"
					label={INTENT_COPY[intent].submit}
					loading={model.busy.value}
				/>
			</div>
		</>
	);
}
// #endregion

// #region The four fieldsets
function SalesFields({ model }: { model: IntakeModel }): JSX.Element {
	const reasonId = "ctc-booking-reason";
	const booking = PROJECTIVE_SALES_HANDLE
		? (
			<a
				class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md"
				href={`/@${PROJECTIVE_SALES_HANDLE}/availability`}
			>
				<span class="ui-button__label">Book a discovery call</span>
			</a>
		)
		: (
			<>
				<Button
					type="button"
					severity="neutral"
					variant="outlined"
					icon={<Icon name="calendar" />}
					label="Book a discovery call"
					aria-disabled="true"
					aria-describedby={reasonId}
					class="ctc-actions__book"
					onClick={(e: Event) => e.preventDefault()}
				/>
				<p class="ctc-actions__reason" id={reasonId}>{BOOKING_UNAVAILABLE_REASON}</p>
			</>
		);
	return (
		<>
			<SenderRow model={model} emailLabel="Work email" />
			<TextField
				model={model}
				name="company"
				label="Company"
				autoComplete="organization"
				required
				maxLength={CONTACT_LIMITS.company}
			/>
			<div class="ctc-fields__row">
				<SelectField
					model={model}
					name="companySize"
					label="Company size"
					options={CONTACT_COMPANY_SIZES}
				/>
				<SelectField model={model} name="budget" label="Budget" options={CONTACT_BUDGETS} />
			</div>
			<MessageField
				model={model}
				label="What are you looking for?"
				hint="The work, the timeline, how your team would use Projective."
			/>
			<Actions model={model} intent="sales" aside={booking} />
		</>
	);
}

function SupportFields({ model }: { model: IntakeModel }): JSX.Element {
	return (
		<>
			<SenderRow model={model} />
			<div class="ctc-fields__row">
				<TextField
					model={model}
					name="accountEmail"
					label="Account email"
					type="email"
					autoComplete="off"
					maxLength={CONTACT_LIMITS.email}
					hint="Only if your account uses a different address."
				/>
				<SelectField model={model} name="topic" label="Topic" options={CONTACT_SUPPORT_TOPICS} />
			</div>
			<MessageField
				model={model}
				label="What do you need help with?"
				hint="What you were doing, and what happened."
			/>
			<Attachments model={model} intent="support" />
			<Actions model={model} intent="support" />
		</>
	);
}

/** The engagement an option is, in meta words: `Session · Active · with Jane Doe`. */
function engagementMeta(e: ContactEngagementOption): string {
	const format = e.format === "session"
		? "Session"
		: e.format === "pipeline"
		? "Pipeline"
		: "One-off";
	const status = e.status === "on_hold" ? "On hold" : "Active";
	return [format, status, e.counterparty ? `with ${e.counterparty}` : null].filter(Boolean).join(
		" · ",
	);
}

function DisputeFields({ model }: { model: IntakeModel }): JSX.Element {
	const picked = model.engagements.find((e) => e.slug === model.fields.engagementSlug.value) ??
		null;
	const error = model.errors.value.engagementSlug;
	return (
		<>
			{model.signedIn
				? model.engagements.length > 0
					? (
						<div data-field="engagementSlug" class="ctc-group">
							<FormControl
								label="Which engagement is it about?"
								hint="Your active and on-hold engagements."
								status={error ? "invalid" : "default"}
								error={error}
								collapseHint
							>
								{({ describedBy, status, labelId }) => (
									<RadioGroup
										name="engagementSlug"
										orientation="vertical"
										aria-labelledby={labelId}
										aria-describedby={describedBy}
										status={status}
										options={model.engagements.map((e) => ({
											value: e.slug,
											label: e.title,
											description: engagementMeta(e),
										}))}
										value={model.fields.engagementSlug}
										onValueChange={() => clearError(model, "engagementSlug")}
									/>
								)}
							</FormControl>
							{picked?.format === "session" && (
								<RouteNote icon="info">
									<p>
										A missed session is claimed from the session itself, where the attendance check
										runs and the payment is held until it's decided.
									</p>
									<a
										class="ui-button ui-button--primary ui-button--link ui-button--size-md"
										href={engagementHref(picked.slug)}
									>
										<span class="ui-button__label">Open {picked.title} to report a no-show</span>
									</a>
									<p class="ctc-note">For anything else about it, describe it below.</p>
								</RouteNote>
							)}
							{picked && picked.format !== "session" && (
								<p class="ctc-note">
									Stage disputes are handled by our disputes team: this request goes to them with
									{" "}
									{picked.title} attached.
								</p>
							)}
						</div>
					)
					: (
						<p class="ctc-note">
							You have no active engagements. If it's about one that has ended, give its link or
							reference below.
						</p>
					)
				: (
					<RouteNote icon="lock">
						<p>
							Sign in to pick the engagement, so the request reaches us with its payment and its
							history.
						</p>
						<a
							class="ui-button ui-button--primary ui-button--link ui-button--size-md"
							href={model.loginHref}
						>
							<span class="ui-button__label">Sign in to continue</span>
						</a>
						<p class="ctc-note">Can't sign in? Send the details below instead.</p>
					</RouteNote>
				)}
			<SenderRow model={model} />
			<TextField
				model={model}
				name="referenceId"
				label={model.signedIn && model.engagements.length > 0
					? "Or a reference, if it isn't listed"
					: "Project link or reference"}
				maxLength={CONTACT_LIMITS.referenceId}
				hint="A project link, an invoice number or a payment reference."
			/>
			<MessageField
				model={model}
				label="What went wrong?"
				hint="What was agreed, what happened, and what you'd like to happen."
			/>
			<Attachments model={model} intent="dispute" />
			<Actions model={model} intent="dispute" />
		</>
	);
}

function SecurityFields({ model }: { model: IntakeModel }): JSX.Element {
	const anonymous = model.fields.anonymous.value;
	const reportError = model.errors.value.reportType;
	return (
		<>
			<div data-field="reportType">
				<FormControl
					label="What are you reporting?"
					required
					status={reportError ? "invalid" : "default"}
					error={reportError}
				>
					{({ describedBy, status, required, labelId }) => (
						<RadioGroup
							name="reportType"
							orientation="vertical"
							aria-labelledby={labelId}
							aria-describedby={describedBy}
							status={status}
							required={required}
							options={CONTACT_SECURITY_REPORTS.map((r) => ({
								value: r.value,
								label: r.label,
								description: r.description,
							}))}
							value={model.fields.reportType}
							onValueChange={() => clearError(model, "reportType")}
						/>
					)}
				</FormControl>
			</div>
			<div class="ctc-anon">
				<Checkbox
					name="anonymous"
					label="Report anonymously"
					aria-describedby="ctc-anon-note"
					value={model.fields.anonymous}
					onValueChange={(on) => {
						clearError(model, "name");
						clearError(model, "email");
						model.announce(
							on
								? "Anonymous report: your name and email are no longer asked for, and nothing identifies you."
								: "Name and email are asked for again, so we can reply.",
						);
					}}
				/>
				<p class="ctc-note" id="ctc-anon-note">
					{anonymous
						? "We won't ask who you are or record your account — and we won't be able to reply."
						: "Leaves out your name, email and account. We won't be able to reply."}
				</p>
			</div>
			{
				/* Hydrated, an anonymous report has no name or email fields at all. Without a script the
				   box is a plain checkbox: CSS hides the pair while it is ticked (`.ctc-sender`), so they
				   cannot carry `required`, and `submissionFromForm` drops whatever they post. */
			}
			{(!model.hydrated || !anonymous) && (
				<SenderRow
					model={model}
					class="ctc-sender"
					nativeRequired={model.hydrated ? undefined : false}
				/>
			)}
			<MessageField
				model={model}
				label="What did you find?"
				hint="Where it is, how to reproduce it, and what it exposes."
			/>
			<Attachments model={model} intent="security" anonymous={anonymous} />
			<RouteNote icon="shield">
				<p>{DISCLOSURE_NOTE}</p>
				<a href="/legal/acceptable-use">Read our acceptable use policy</a>
			</RouteNote>
			<Actions model={model} intent="security" />
		</>
	);
}

const FIELDSETS: Readonly<Record<ContactIntent, (p: { model: IntakeModel }) => JSX.Element>> = {
	sales: SalesFields,
	support: SupportFields,
	dispute: DisputeFields,
	security: SecurityFields,
};
// #endregion

/** One intent's fieldset — active (enabled, visible) or parked in the shared grid cell. */
export function IntentFieldset(
	props: { intent: ContactIntent; active: boolean; model: IntakeModel },
): JSX.Element {
	const { intent, active, model } = props;
	const Fields = FIELDSETS[intent];
	return (
		<fieldset
			class="ctc-fields"
			data-intent={intent}
			data-active={active ? "true" : "false"}
			disabled={!active}
			aria-hidden={active ? undefined : "true"}
			inert={!active}
		>
			<legend class="ctc-fields__legend">{INTENT_COPY[intent].legend}</legend>
			<Fields model={model} />
		</fieldset>
	);
}
