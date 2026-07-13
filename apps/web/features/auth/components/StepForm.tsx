import { type Signal, useSignal } from "@preact/signals";
import type { ComponentChildren, JSX } from "preact";
import {
	Button,
	DatePicker,
	type DateValue,
	FormControl,
	InputText,
	MultiSelect,
	Password,
	Select,
} from "@projective/ui/fields";
import { OAuthButtons } from "./OAuthButtons.tsx";
import { ChoiceArt, type ChoiceArtKind } from "./JoinArt.tsx";
import { TagSelect } from "./TagSelect.tsx";
import { GoogleGlyph, InfoIcon, WarnIcon } from "./icons.tsx";
import type { JoinStore } from "../core/wizardStore.ts";
import { buildPayload, hasErrors, validateStep } from "../core/wizardValidation.ts";
import { AGE_MESSAGES, bracketFromDob } from "../core/age.ts";
import { COUNTRIES, EMPLOYEE_TIERS, INDUSTRIES } from "../core/options.ts";
import { PURPOSES, SKILLS } from "../core/onboarding-data.ts";
import { postAuth } from "../core/api.ts";
import { safeRedirect, withRedirect } from "../core/redirect.ts";

/**
 * StepForm — the right column of the onboarding experience: the active step's controls (built from
 * `@projective/ui` field components), the step's navigation, and submission. It reads/writes the
 * shared wizard store, so every keystroke is reflected live in the summary on the left. Steps
 * slide/fade on change (keyed remount + `data-dir`), and choice-only steps **auto-advance** the
 * instant a card is picked. Individual and Organization render different field sets into the same
 * step slots (organizations follow a client-only path — no "intent" branch, no skills step).
 */
type Err = Record<string, string | null>;

/** Max interactive tags a person can pick per cluster (purpose / skills). */
const MAX_TAGS = 5;
/** How long the picked card's active state lingers before the auto-advance slide (feels deliberate). */
const AUTO_ADVANCE_MS = 240;

function toISO(d: Date): string {
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

// #region Small field wrappers (FormControl + @projective/ui control)
function TextRow(props: {
	label: string;
	value: Signal<string>;
	error?: string | null;
	required?: boolean;
	type?: string;
	autoComplete?: string;
	placeholder?: string;
	readOnly?: boolean;
}): JSX.Element {
	const status = props.error ? "invalid" : "default";
	return (
		<FormControl
			label={props.label}
			error={props.error ?? undefined}
			status={status}
			required={props.required}
		>
			{({ id, describedBy }) => (
				<InputText
					id={id}
					aria-describedby={describedBy}
					value={props.value}
					type={props.type ?? "text"}
					placeholder={props.placeholder}
					autoComplete={props.autoComplete}
					readOnly={props.readOnly}
					status={status}
					variant="filled"
					fluid
				/>
			)}
		</FormControl>
	);
}

function PassRow(props: {
	label: string;
	value: Signal<string>;
	error?: string | null;
	feedback?: boolean;
}): JSX.Element {
	const status = props.error ? "invalid" : "default";
	return (
		<FormControl label={props.label} error={props.error ?? undefined} status={status} required>
			{({ id, describedBy }) => (
				<Password
					id={id}
					aria-describedby={describedBy}
					value={props.value}
					toggleMask
					feedback={props.feedback}
					autoComplete="new-password"
					status={status}
					variant="filled"
					fluid
				/>
			)}
		</FormControl>
	);
}

function PickRow(props: {
	label: string;
	value: Signal<string>;
	options: readonly { value: string; label: string }[];
	error?: string | null;
	placeholder?: string;
}): JSX.Element {
	const status = props.error ? "invalid" : "default";
	return (
		<FormControl label={props.label} error={props.error ?? undefined} status={status} required>
			{({ id, describedBy }) => (
				<Select
					id={id}
					aria-describedby={describedBy}
					value={props.value}
					options={props.options as { value: string; label: string }[]}
					placeholder={props.placeholder ?? "Select…"}
					status={status}
					fluid
				/>
			)}
		</FormControl>
	);
}
// #endregion

/**
 * A large, illustration-led choice card. The SVG is the focal point (no boxed icon); the whole card
 * is the hit target and picking it fires `onSelect` (which, for choice-only steps, auto-advances).
 * `neutral` renders the initial un-chosen state where nothing is highlighted.
 */
function ChoiceCard(props: {
	name: string;
	value: string;
	active: boolean;
	neutral?: boolean;
	art: ChoiceArtKind;
	title: string;
	desc: string;
	onSelect: () => void;
}): JSX.Element {
	return (
		<label
			class={`auth-choice${props.active ? " is-active" : ""}${props.neutral ? " is-neutral" : ""}`}
		>
			<input
				class="auth-choice__native"
				type="radio"
				name={props.name}
				value={props.value}
				checked={props.active}
				onChange={props.onSelect}
			/>
			<span class="auth-choice__art" aria-hidden="true">
				<ChoiceArt kind={props.art} />
			</span>
			<span class="auth-choice__title">{props.title}</span>
			<span class="auth-choice__desc">{props.desc}</span>
		</label>
	);
}

function Row({ children }: { children: ComponentChildren }): JSX.Element {
	return <div class="auth-field-row">{children}</div>;
}

/** Render the fields for one step slot, branching Individual vs Organization. */
function StepFields(
	{ store, dobDate, onChoose }: {
		store: JoinStore;
		dobDate: Signal<DateValue>;
		/** Called after a choice-only pick so the wizard can auto-advance. */
		onChoose: () => void;
	},
): JSX.Element {
	const e = store.errors.value as Err;
	const org = store.isOrg.value;
	const chosen = store.accountChosen.value;
	const id = store.current.value.id;

	if (id === "account") {
		return (
			<>
				<div class="auth-choices auth-choices--2">
					<ChoiceCard
						name="accountType"
						value="individual"
						active={chosen && !org}
						neutral={!chosen}
						art="individual"
						title="Individual"
						desc="Freelancer or client — one personal account."
						onSelect={() => {
							store.accountType.value = "individual";
							store.accountChosen.value = true;
							onChoose();
						}}
					/>
					<ChoiceCard
						name="accountType"
						value="organization"
						active={chosen && org}
						neutral={!chosen}
						art="organization"
						title="Organisation"
						desc="A company workspace that hires talent."
						onSelect={() => {
							store.accountType.value = "organization";
							store.accountChosen.value = true;
							// Organizations are buyers only — pin the client persona, no intent branch.
							store.intent.value = "client";
							onChoose();
						}}
					/>
				</div>
				<div class="auth-divider">
					<span>or</span>
				</div>
				<OAuthButtons redirectTo={store.redirectTo} label="Sign up" />
			</>
		);
	}

	if (id === "intent") {
		// Individual-only step (organizations skip straight past — they're always the client).
		return (
			<>
				<div class="auth-choices auth-choices--2">
					<ChoiceCard
						name="intent"
						value="client"
						active={store.intent.value === "client"}
						neutral={store.intent.value === ""}
						art="client"
						title="I want to hire"
						desc="Post work and bring on brilliant talent."
						onSelect={() => {
							store.intent.value = "client";
							onChoose();
						}}
					/>
					<ChoiceCard
						name="intent"
						value="freelancer"
						active={store.intent.value === "freelancer"}
						neutral={store.intent.value === ""}
						art="freelancer"
						title="I want to work"
						desc="Offer your services and get hired."
						onSelect={() => {
							store.intent.value = "freelancer";
							onChoose();
						}}
					/>
				</div>
				{e.intent ? <p class="auth-fielderror">{e.intent}</p> : null}
			</>
		);
	}

	if (id === "purpose") {
		return org
			? (
				<>
					<Row>
						<PickRow
							label="Estimated number of employees"
							value={store.employeeTier}
							options={EMPLOYEE_TIERS}
							error={e.employeeTier}
							placeholder="Select a range…"
						/>
					</Row>
					<Row>
						<PickRow
							label="Primary industry / sector"
							value={store.industry}
							options={INDUSTRIES}
							error={e.industry}
							placeholder="Select an industry…"
						/>
					</Row>
					<Row>
						<TextRow
							label="Website / corporate domain"
							value={store.website}
							error={e.website}
							type="url"
							autoComplete="url"
							placeholder="acme.com"
						/>
					</Row>
				</>
			)
			: (
				<Row>
					<FormControl
						label="What are you here to do?"
						hint={`Optional — pick up to ${MAX_TAGS}, or add your own.`}
					>
						{() => (
							<TagSelect
								value={store.purpose}
								options={PURPOSES}
								max={MAX_TAGS}
								placeholder="Add a goal…"
								inputLabel="Add a goal"
							/>
						)}
					</FormControl>
				</Row>
			);
	}

	if (id === "specialize") {
		return org
			? (
				<>
					<Row>
						<TextRow
							label="Registered address"
							value={store.street}
							error={e.street}
							placeholder="Street address"
							required
						/>
					</Row>
					<div class="auth-form__grid">
						<TextRow label="City" value={store.city} error={e.city} required />
						<TextRow label="Postcode / ZIP" value={store.postcode} error={e.postcode} required />
					</div>
					<Row>
						<PickRow
							label="Country"
							value={store.country}
							options={COUNTRIES}
							error={e.country}
							placeholder="Select a country…"
						/>
					</Row>
					<Row>
						<FormControl label="Initial departments" hint="Optional — add your top-level teams.">
							{({ id: fid, describedBy }) => (
								<MultiSelect
									id={fid}
									aria-describedby={describedBy}
									value={store.departments}
									options={DEPARTMENT_SUGGESTIONS}
									display="chip"
									filter
									placeholder="e.g. Engineering, Finance…"
									fluid
								/>
							)}
						</FormControl>
					</Row>
				</>
			)
			: (
				<Row>
					<FormControl
						label="Skills & interests"
						hint={`Optional — pick up to ${MAX_TAGS} so the right clients find you.`}
					>
						{() => (
							<TagSelect
								value={store.skills}
								options={SKILLS}
								max={MAX_TAGS}
								placeholder="Add a skill…"
								inputLabel="Add a skill"
							/>
						)}
					</FormControl>
				</Row>
			);
	}

	if (id === "identity") {
		return org
			? (
				<>
					<Row>
						<TextRow
							label="Legal company name"
							value={store.legalName}
							error={e.legalName}
							autoComplete="organization"
							required
						/>
					</Row>
					<Row>
						<TextRow
							label="Trading / brand name"
							value={store.tradingName}
							placeholder="If different from legal name"
						/>
					</Row>
					<div class="auth-form__grid">
						<TextRow
							label="Handle"
							value={store.handle}
							error={e.handle}
							placeholder="yourcompany"
							required
						/>
						<TextRow label="Reg. no. / Tax ID" value={store.crn} placeholder="CRN, EIN, VAT…" />
					</div>
				</>
			)
			: (
				<>
					<div class="auth-form__grid">
						<TextRow
							label="First name"
							value={store.firstName}
							error={e.firstName}
							autoComplete="given-name"
							required
						/>
						<TextRow
							label="Last name"
							value={store.lastName}
							error={e.lastName}
							autoComplete="family-name"
							required
						/>
					</div>
					<Row>
						<TextRow
							label="Username"
							value={store.username}
							error={e.username}
							placeholder="yourhandle"
							autoComplete="username"
							required
						/>
					</Row>
				</>
			);
	}

	// credentials
	if (org) {
		return (
			<>
				<Row>
					<TextRow
						label="Corporate email"
						value={store.corpEmail}
						error={e.corpEmail}
						type="email"
						autoComplete="email"
						required
					/>
				</Row>
				<Row>
					<TextRow
						label="Corporate phone"
						value={store.phone}
						error={e.phone}
						type="tel"
						autoComplete="tel"
						required
					/>
				</Row>
				<div class="auth-form__grid">
					<PassRow label="Admin password" value={store.password} error={e.password} feedback />
					<PassRow label="Confirm password" value={store.confirm} error={e.confirm} />
				</div>
			</>
		);
	}

	const bracket = bracketFromDob(store.dob.value);
	return (
		<>
			<Row>
				<TextRow
					label="Email"
					value={store.email}
					error={e.email}
					type="email"
					autoComplete="email"
					placeholder="you@example.com"
					readOnly={store.isOAuth}
				/>
			</Row>
			<Row>
				<FormControl
					label="Date of birth"
					error={e.dob ?? undefined}
					status={e.dob ? "invalid" : "default"}
					required
				>
					{({ id: fid, describedBy }) => (
						<DatePicker
							id={fid}
							aria-describedby={describedBy}
							value={dobDate}
							selectionMode="single"
							maxDate={new Date()}
							dateFormat="dd M yy"
							showIcon
							status={e.dob ? "invalid" : "default"}
							fluid
							onValueChange={(v) => {
								store.dob.value = v instanceof Date ? toISO(v) : "";
							}}
						/>
					)}
				</FormControl>
			</Row>
			{store.dob.value && bracket === "restricted"
				? (
					<div class="auth-agenote auth-agenote--restricted" role="status">
						<span class="auth-agenote__icon">{InfoIcon()}</span>
						<span>{AGE_MESSAGES.restricted}</span>
					</div>
				)
				: null}
			{store.dob.value && bracket === "blocked"
				? (
					<div class="auth-agenote auth-agenote--blocked" role="alert">
						<span class="auth-agenote__icon">{WarnIcon()}</span>
						<span>{AGE_MESSAGES.blocked}</span>
					</div>
				)
				: null}
			{store.isOAuth ? null : (
				<div class="auth-form__grid">
					<PassRow label="Password" value={store.password} error={e.password} feedback />
					<PassRow label="Confirm password" value={store.confirm} error={e.confirm} />
				</div>
			)}
		</>
	);
}

const DEPARTMENT_SUGGESTIONS = [
	{ value: "Engineering", label: "Engineering" },
	{ value: "Design", label: "Design" },
	{ value: "Product", label: "Product" },
	{ value: "Marketing", label: "Marketing" },
	{ value: "Sales", label: "Sales" },
	{ value: "Finance", label: "Finance" },
	{ value: "People / HR", label: "People / HR" },
	{ value: "Operations", label: "Operations" },
	{ value: "Legal", label: "Legal" },
	{ value: "Support", label: "Support" },
];

export function StepForm({ store }: { store: JoinStore }): JSX.Element {
	const dobDate = useSignal<DateValue>(null);
	/** Guards the auto-advance timer so a rapid double-click can't skip a step. */
	const advancing = useSignal(false);
	const step = store.current.value;
	const last = store.stepIndex.value === store.stepCount.value - 1;
	const submitting = store.submitting.value;

	function commitStep(index: number, dir: 1 | -1) {
		store.direction.value = dir;
		store.stepIndex.value = index;
	}

	function goNext() {
		store.formError.value = null;
		const errs = validateStep(store, step.id);
		store.errors.value = errs;
		if (hasErrors(errs)) return;
		if (!last) commitStep(store.stepIndex.value + 1, 1);
		else void submit();
	}

	function goPrev() {
		store.formError.value = null;
		store.errors.value = {};
		if (store.stepIndex.value > 0) commitStep(store.stepIndex.value - 1, -1);
	}

	function skip() {
		store.formError.value = null;
		store.errors.value = {};
		if (!last) commitStep(store.stepIndex.value + 1, 1);
	}

	async function submit() {
		store.formError.value = null;
		const steps = store.steps.value;
		for (let i = 0; i < steps.length; i++) {
			const errs = validateStep(store, steps[i].id);
			if (hasErrors(errs)) {
				store.errors.value = errs;
				commitStep(i, i < store.stepIndex.value ? -1 : 1);
				return;
			}
		}
		store.submitting.value = true;
		const result = await postAuth("/api/auth/join", buildPayload(store));
		store.submitting.value = false;
		if (!result.ok) {
			if (result.errors) store.errors.value = { ...store.errors.value, ...result.errors };
			store.formError.value = result.message ??
				"We couldn't complete sign-up. Please review your details and retry.";
			return;
		}
		const dest = safeRedirect(result.redirectTo, store.redirectTo);
		const email = store.isOrg.value ? store.corpEmail.value.trim() : store.email.value.trim();
		globalThis.location.href = store.isOAuth
			? dest
			: result.requiresVerification
			? withRedirect(`/verify?email=${encodeURIComponent(email)}`, dest)
			: dest;
	}

	/**
	 * Auto-advance for choice-only steps: after a short, deliberate pause (so the picked card's active
	 * state is *seen*), validate and slide to the next step. Idempotent per pick via the guard signal.
	 */
	function autoAdvance() {
		if (advancing.value) return;
		advancing.value = true;
		setTimeout(() => {
			advancing.value = false;
			goNext();
		}, AUTO_ADVANCE_MS);
	}

	const continueLabel = last
		? (store.isOrg.value ? "Create organisation" : "Create account")
		: "Continue";

	// Choice-only steps carry no manual "Continue" — picking a card moves the wizard forward.
	const choiceStep = step.id === "account" || step.id === "intent";
	// Individuals can reach for Google at any step; org sign-up is corporate-credential based.
	const showInlineOAuth = !store.isOrg.value && !store.isOAuth && step.id !== "account";
	const oauthHref = withRedirect("/api/auth/oauth/google", store.redirectTo);

	return (
		<div class="auth-wizard">
			<div class="auth-crumbs" aria-hidden="true">
				{store.steps.value.map((s, i) => (
					<span
						key={s.id}
						class={`auth-crumbs__tick${i === store.stepIndex.value ? " is-active" : ""}${
							i < store.stepIndex.value ? " is-done" : ""
						}`}
					/>
				))}
				{step.optional ? <span class="auth-crumbs__optional">Optional</span> : null}
			</div>

			<div class="auth-step" data-dir={store.direction.value} key={step.id}>
				<StepFields store={store} dobDate={dobDate} onChoose={autoAdvance} />
			</div>

			{store.formError.value
				? (
					<div class="auth-banner auth-banner--error" role="alert">
						<span class="auth-banner__icon">{WarnIcon()}</span>
						<span>{store.formError.value}</span>
					</div>
				)
				: null}

			{showInlineOAuth
				? (
					<a class="auth-oauth-inline" href={oauthHref} data-provider="google">
						<GoogleGlyph class="auth-oauth-inline__glyph" />
						<span>Prefer Google? Continue with it — we'll keep your place.</span>
					</a>
				)
				: null}

			<div class="auth-actions auth-actions--between">
				{store.stepIndex.value > 0
					? <Button variant="text" label="Back" onClick={goPrev} />
					: <span />}
				<span class="auth-actions__spacer" />
				{step.optional
					? <button type="button" class="auth-skip" onClick={skip}>Skip for now</button>
					: null}
				{choiceStep ? null : <Button label={continueLabel} loading={submitting} onClick={goNext} />}
			</div>

			{store.stepIndex.value === 0
				? (
					<p class="auth-alt">
						Already have an account?{" "}
						<a class="auth-link" href={withRedirect("/login", store.redirectTo)}>Sign in</a>
					</p>
				)
				: null}
		</div>
	);
}
