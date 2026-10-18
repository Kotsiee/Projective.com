import type { JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { type Signal, signal, useSignal } from "@preact/signals";
import "../styles/contact.css";
import { SelectButton } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import {
	CONTACT_INTENTS,
	type ContactEngagementOption,
	type ContactIntent,
	parseContactIntent,
} from "@projective/types/contact";
import { intentOptions, type ReceiptReply } from "../core/contact-copy.ts";
import { type ContactFormError, contactHref } from "../core/contact-url.ts";
import {
	type AttachmentEntry,
	attachmentsInFlight,
	checkSubmission,
	type ContactFormState,
	EMPTY_CONTACT_FORM,
	firstErrorField,
	readyAttachmentIds,
	submissionInput,
} from "../core/contact-model.ts";
import { ContactService } from "../core/ContactService.ts";
import {
	type FieldSignals,
	type IntakeModel,
	IntentFieldset,
} from "../components/IntentFieldsets.tsx";
import { ContactReceiptPanel } from "../components/ContactReceiptPanel.tsx";

/**
 * ContactIntake — `/contact`'s intake column (Decision #276; DESIGN_SYSTEM §C.1): the intent switcher,
 * the four intents' forms, and the confirmation that replaces them. The page's one island, and the
 * carrier of `contact.css` for the whole page (header and rail included).
 *
 * **URL state.** The intent is `?intent=` (default `support`). The switcher is the package
 * `SelectButton` with descriptions and `hrefFor`: server-rendered it is a row of links, so without
 * JavaScript each intent is its own page; hydrated it is a radiogroup that switches in place and
 * keeps the address bar in step with `history.replaceState`, so every variant stays shareable.
 *
 * **No height jump.** All four fieldsets share one grid cell; only the active one is enabled,
 * visible and in the accessibility tree, and it cross-fades in on `--dur-fast` (opacity only).
 *
 * **Without JavaScript** the same markup is a plain `POST /api/contact` form; the route answers with a
 * 303 back here — `?sent=1` with the receipt in a short-lived cookie (passed in as `receipt`), or
 * `?error=` with the fields to mark (`formError`).
 *
 * **With it**, a submission is pre-checked against the shared Zod schema (the first invalid field is
 * focused and every message is wired by `aria-describedby`), sent as JSON, and answered by the
 * confirmation panel: focus moves to its heading and the polite live region says the same thing, so
 * the outcome never depends on seeing it.
 */

/** Props for {@link ContactIntake}. */
export interface ContactIntakeProps {
	/** The intent the URL asked for. */
	intent: ContactIntent;
	/** Whether a reader is signed in (attachments and the engagement picker need an account). */
	signedIn: boolean;
	/** A signed-in reader's open engagements, for the dispute intent. */
	engagements: ContactEngagementOption[];
	/** Where a guest signs in and comes back to the dispute form. */
	loginHref: string;
	/** A no-JS submission's receipt (from the route's cookie), shown instead of the form. */
	receipt: { reference: string; intent: ContactIntent; anonymous: boolean } | null;
	/** A no-JS submission's refusal and the fields it named. */
	formError: { error: ContactFormError; fields: string[] } | null;
}

/** What a no-JS refusal says, by kind. */
const FORM_ERROR_TEXT: Readonly<Record<ContactFormError, string>> = {
	invalid: "Some of what you sent needs another look — the fields are marked below.",
	rate_limited:
		"That's a lot of requests in a short time. Please wait a few minutes and try again.",
	sign_in: "Sign in to attach files or to name one of your engagements.",
	unavailable: "We couldn't send your request just now. Please try again shortly.",
};

/** The message a field gets when a no-JS refusal named it (the route carries names, not sentences). */
const NO_JS_FIELD_TEXT = "Check this field.";

const FIELD_KEYS = Object.keys(EMPTY_CONTACT_FORM) as Array<keyof ContactFormState>;

function freshFields(): FieldSignals {
	const out = {} as Record<string, unknown>;
	for (const key of FIELD_KEYS) out[key] = signal(EMPTY_CONTACT_FORM[key]);
	return out as FieldSignals;
}

function readFields(fields: FieldSignals): ContactFormState {
	const out = {} as Record<string, unknown>;
	for (const key of FIELD_KEYS) out[key] = fields[key].value;
	return out as unknown as ContactFormState;
}

export default function ContactIntake(props: ContactIntakeProps): JSX.Element {
	const intent = useSignal<ContactIntent>(props.intent);
	const fields = useMemo(freshFields, []);
	const attachments = useMemo(
		() =>
			Object.fromEntries(
				CONTACT_INTENTS.map((i) => [i, signal<Record<string, AttachmentEntry>>({})]),
			) as Record<
				ContactIntent,
				Signal<Record<string, AttachmentEntry>>
			>,
		[],
	);
	const errors = useSignal<Record<string, string>>(
		props.formError
			? Object.fromEntries(props.formError.fields.map((f) => [f, NO_JS_FIELD_TEXT]))
			: {},
	);
	const alert = useSignal<string | null>(
		props.formError ? FORM_ERROR_TEXT[props.formError.error] : null,
	);
	const busy = useSignal(false);
	const announcement = useSignal("");
	const receipt = useSignal<
		{ reference: string; intent: ContactIntent; reply: ReceiptReply } | null
	>(
		props.receipt
			? {
				reference: props.receipt.reference,
				intent: props.receipt.intent,
				reply: props.receipt.anonymous ? { kind: "none" } : { kind: "given" },
			}
			: null,
	);
	const hydrated = useSignal(false);
	const formRef = useRef<HTMLFormElement>(null);
	const receiptHeading = useRef<HTMLHeadingElement>(null);

	useEffect(() => {
		hydrated.value = true;
	}, []);

	// The confirmation is the outcome: focus lands on its heading whenever it appears.
	useEffect(() => {
		if (receipt.value) receiptHeading.current?.focus();
	}, [receipt.value]);

	const announce = (text: string) => {
		// Re-set through an empty string so the same sentence twice is announced twice.
		announcement.value = "";
		queueMicrotask(() => (announcement.value = text));
	};

	const model: IntakeModel = {
		fields,
		errors,
		busy,
		signedIn: props.signedIn,
		hydrated: hydrated.value,
		engagements: props.engagements,
		attachments,
		loginHref: props.loginHref,
		announce,
	};

	function switchIntent(next: ContactIntent): void {
		if (next === intent.value) return;
		intent.value = next;
		errors.value = {};
		alert.value = null;
		try {
			globalThis.history?.replaceState(globalThis.history.state, "", contactHref(next));
		} catch { /* a sandboxed frame without history: the in-place switch still stands */ }
	}

	function focusField(name: string | null): void {
		const scope = formRef.current?.querySelector(`.ctc-fields[data-intent="${intent.value}"]`);
		const target = name ? scope?.querySelector<HTMLElement>(`[data-field="${name}"]`) : null;
		const control = target?.querySelector<HTMLElement>(
			"input:not([type=hidden]), textarea, button, [tabindex]",
		) ??
			null;
		control?.focus();
	}

	async function onSubmit(e: JSX.TargetedEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
		e.preventDefault();
		if (busy.value) return;
		alert.value = null;
		const current = intent.value;
		const files = attachments[current].value;
		if (attachmentsInFlight(files) > 0) {
			alert.value = "Wait for your attachments to finish checking, then send.";
			announce(alert.value);
			return;
		}
		const form = readFields(fields);
		const body = submissionInput(current, form, readyAttachmentIds(files));
		const check = checkSubmission(body);
		if (!check.ok) {
			errors.value = check.errors;
			announce("Check the highlighted fields.");
			focusField(firstErrorField(current, check.errors));
			return;
		}

		busy.value = true;
		const res = await ContactService.submit(body, props.signedIn);
		busy.value = false;
		if (res.ok && res.data) {
			const anonymous = current === "security" && form.anonymous;
			receipt.value = {
				reference: res.data.reference,
				intent: parseContactIntent(res.data.intent),
				reply: anonymous
					? { kind: "none" }
					: { kind: "address", email: form.email.trim().toLowerCase() },
			};
			errors.value = {};
			announce(`Request sent. Your reference is ${res.data.reference}.`);
			return;
		}
		errors.value = res.errors ?? {};
		alert.value = res.message ?? FORM_ERROR_TEXT.unavailable;
		announce(alert.value);
		const first = firstErrorField(current, errors.value);
		if (first) focusField(first);
	}

	function startAnother(): void {
		const keep = { name: fields.name.value, email: fields.email.value };
		for (const key of FIELD_KEYS) {
			(fields[key] as { value: unknown }).value = EMPTY_CONTACT_FORM[key];
		}
		fields.name.value = keep.name;
		fields.email.value = keep.email;
		for (const i of CONTACT_INTENTS) attachments[i].value = {};
		errors.value = {};
		alert.value = null;
		receipt.value = null;
		try {
			globalThis.history?.replaceState(globalThis.history.state, "", contactHref(intent.value));
		} catch { /* see switchIntent */ }
		announce("Ready for a new request.");
	}

	const done = receipt.value;
	return (
		<section class="ctc-intake" aria-labelledby={done ? "ctc-receipt-title" : "ctc-intake-label"}>
			<p class="ui-visually-hidden" role="status" aria-live="polite">{announcement.value}</p>
			{done
				? (
					<ContactReceiptPanel
						reference={done.reference}
						intent={done.intent}
						reply={done.reply}
						headingRef={receiptHeading}
						onAnother={startAnother}
					/>
				)
				: (
					<>
						<div class="ctc-intake__switch">
							<h2 class="ctc-intake__label" id="ctc-intake-label">What is this about?</h2>
							<SelectButton
								aria-label="What is this about?"
								options={intentOptions()}
								value={intent.value}
								hrefFor={(value) => contactHref(value as ContactIntent)}
								onValueChange={(value) =>
									switchIntent(parseContactIntent(String(value)))}
								fluid
							/>
						</div>
						<form
							ref={formRef}
							class="ctc-form"
							method="post"
							action="/api/contact"
							noValidate={hydrated.value}
							aria-labelledby="ctc-intake-label"
							onSubmit={onSubmit}
						>
							<input type="hidden" name="intent" value={intent.value} />
							<div class="ctc-honeypot" aria-hidden="true">
								<label>
									Leave this field empty
									<input
										type="text"
										name="website"
										tabIndex={-1}
										autoComplete="off"
										value={fields.website.value}
										onInput={(e) => (fields.website.value = e.currentTarget.value)}
									/>
								</label>
							</div>
							{alert.value && (
								<Message severity="danger" class="ctc-form__alert">{alert.value}</Message>
							)}
							<div class="ctc-form__stack">
								{CONTACT_INTENTS.map((i) => (
									<IntentFieldset key={i} intent={i} active={i === intent.value} model={model} />
								))}
							</div>
						</form>
					</>
				)}
		</section>
	);
}
