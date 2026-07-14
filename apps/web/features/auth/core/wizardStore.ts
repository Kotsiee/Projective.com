import { computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";
import type { AccountType, UserIntent } from "../types/mod.ts";
import type { OAuthPrefill } from "./oauth.ts";

/**
 * The onboarding wizard's shared state. A single store instance is created per JoinExperience mount
 * and handed to BOTH columns — the step form (right) writes into these signals, the summary panel
 * (left) reads them — so the live "passport" card and dynamic copy update in real time with zero
 * prop threading. Everything is signal-first (DESIGN_SYSTEM.md §C.2).
 */

/** The six onboarding step slots (kept identical for Individual & Organization to sync routing/state). */
export type StepId = "account" | "intent" | "purpose" | "specialize" | "identity" | "credentials";

export interface StepMeta {
	id: StepId;
	/** Design label, e.g. "1.2". */
	tag: string;
	/** Short human label for the progress strip. */
	label: string;
	optional: boolean;
}

export interface JoinInit {
	redirectTo: string;
	accountType: AccountType;
	intent: UserIntent | "";
	prefill: OAuthPrefill | null;
}

export interface JoinStore {
	readonly redirectTo: string;
	readonly prefill: OAuthPrefill | null;
	/** True when arriving from an SSO/OAuth identity — password setup is skipped. */
	readonly isOAuth: boolean;

	// selections
	accountType: Signal<AccountType>;
	/**
	 * Whether the person has *consciously* picked an account type yet. The first step opens neutral
	 * (neither card highlighted); this flips true on the first explicit choice and unlocks
	 * auto-advance. OAuth arrivals are individuals, so it starts true for them.
	 */
	accountChosen: Signal<boolean>;
	intent: Signal<UserIntent | "">;
	purpose: Signal<string[]>;
	skills: Signal<string[]>;

	// individual identity
	firstName: Signal<string>;
	lastName: Signal<string>;
	username: Signal<string>;

	// organization identity
	legalName: Signal<string>;
	tradingName: Signal<string>;
	handle: Signal<string>;
	crn: Signal<string>;
	/** Corporate web footprint — official website / domain (organization only). */
	website: Signal<string>;

	// scale / structure (organization)
	employeeTier: Signal<string>;
	industry: Signal<string>;
	/** Free-text sector, required only when {@link industry} is the `"other"` catch-all. */
	industryOther: Signal<string>;
	departments: Signal<string[]>;
	street: Signal<string>;
	city: Signal<string>;
	postcode: Signal<string>;
	country: Signal<string>;

	// credentials / contact
	email: Signal<string>;
	dob: Signal<string>;
	password: Signal<string>;
	confirm: Signal<string>;
	corpEmail: Signal<string>;
	phone: Signal<string>;

	// navigation & submission
	stepIndex: Signal<number>;
	direction: Signal<1 | -1>;
	errors: Signal<Record<string, string | null>>;
	formError: Signal<string | null>;
	submitting: Signal<boolean>;

	// derived
	steps: ReadonlySignal<StepMeta[]>;
	current: ReadonlySignal<StepMeta>;
	stepCount: ReadonlySignal<number>;
	progress: ReadonlySignal<number>;
	isOrg: ReadonlySignal<boolean>;
	displayName: ReadonlySignal<string>;
	displayHandle: ReadonlySignal<string>;
	displayEmail: ReadonlySignal<string>;
	initials: ReadonlySignal<string>;
}

/**
 * Build the (reactive) list of visible steps for the current selections.
 *
 * Organizations follow a **client-only** path (PRODUCT_SPEC.md — an org registers to buy/hire, not
 * to provide services), so their flow skips the individual "intent" (hire vs. work) branch entirely
 * and never surfaces the freelancer-only "skills" step.
 */
function buildSteps(
	accountType: Signal<AccountType>,
	intent: Signal<UserIntent | "">,
	isOAuth: boolean,
): StepMeta[] {
	const org = accountType.value === "organization";
	const steps: StepMeta[] = [];
	// OAuth arrivals already have a verified provider identity AND are individuals by definition, so
	// the account-type choice step is skipped entirely — they land straight on "intent".
	if (!isOAuth) steps.push({ id: "account", tag: "1", label: "Account", optional: false });
	// Individuals choose hire vs. work; organizations are buyers by definition, so no branch.
	if (!org) steps.push({ id: "intent", tag: "1.2", label: "You", optional: false });
	steps.push({ id: "purpose", tag: "1.3", label: org ? "Scale" : "Purpose", optional: !org });
	const showSpecialize = org || intent.value === "freelancer";
	if (showSpecialize) {
		steps.push({
			id: "specialize",
			tag: "1.4",
			label: org ? "Structure" : "Skills",
			optional: !org,
		});
	}
	steps.push({ id: "identity", tag: "1.5", label: org ? "Company" : "Profile", optional: false });
	// The credentials step (email + password) is redundant for OAuth: the provider already
	// authenticated them, so the only remaining detail — date of birth — folds up into identity (1.5),
	// which then carries the "Create account" submission.
	if (!isOAuth) steps.push({ id: "credentials", tag: "1.6", label: "Finish", optional: false });
	return steps;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Create a fresh wizard store seeded from the route's server-parsed props. */
export function createJoinStore(init: JoinInit): JoinStore {
	const prefill = init.prefill;
	const isOAuth = !!prefill;
	// OAuth sign-up is individual-only (Google onboarding never provisions an organisation), so pin
	// the account type to "individual" regardless of any stray `?type=` param on the return URL.
	const accountType = signal<AccountType>(isOAuth ? "individual" : init.accountType);
	const intent = signal<UserIntent | "">(init.intent);

	const firstName = signal(prefill?.firstName ?? "");
	const lastName = signal(prefill?.lastName ?? "");
	const email = signal(prefill?.email ?? "");

	const steps = computed(() => buildSteps(accountType, intent, isOAuth));
	const stepIndex = signal(0);
	const current = computed(() => steps.value[clamp(stepIndex.value, 0, steps.value.length - 1)]);
	const stepCount = computed(() => steps.value.length);
	const progress = computed(() =>
		steps.value.length <= 1 ? 1 : (stepIndex.value + 1) / steps.value.length
	);
	const isOrg = computed(() => accountType.value === "organization");

	const firstNameS = firstName;
	const lastNameS = lastName;
	const legalName = signal("");
	const username = signal("");
	const handle = signal("");

	const displayName = computed(() => {
		if (accountType.value === "organization") return legalName.value.trim();
		return `${firstNameS.value} ${lastNameS.value}`.trim();
	});
	const displayHandle = computed(() =>
		accountType.value === "organization" ? handle.value.trim() : username.value.trim()
	);
	const corpEmail = signal("");
	const displayEmail = computed(() =>
		accountType.value === "organization" ? corpEmail.value.trim() : email.value.trim()
	);
	const initials = computed(() => {
		const src = displayName.value;
		if (src) {
			return src.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
		}
		return accountType.value === "organization" ? "◆" : "?";
	});

	return {
		redirectTo: init.redirectTo,
		prefill,
		isOAuth,
		accountType,
		// OAuth arrivals are always individuals mid-flow, so their choice is already made.
		accountChosen: signal<boolean>(isOAuth),
		intent,
		purpose: signal<string[]>([]),
		skills: signal<string[]>([]),
		firstName,
		lastName,
		username,
		legalName,
		tradingName: signal(""),
		handle,
		crn: signal(""),
		website: signal(""),
		employeeTier: signal(""),
		industry: signal(""),
		industryOther: signal(""),
		departments: signal<string[]>([]),
		street: signal(""),
		city: signal(""),
		postcode: signal(""),
		country: signal(""),
		email,
		dob: signal(""),
		password: signal(""),
		confirm: signal(""),
		corpEmail,
		phone: signal(""),
		stepIndex,
		direction: signal<1 | -1>(1),
		errors: signal<Record<string, string | null>>({}),
		formError: signal<string | null>(null),
		submitting: signal(false),
		steps,
		current,
		stepCount,
		progress,
		isOrg,
		displayName,
		displayHandle,
		displayEmail,
		initials,
	};
}
