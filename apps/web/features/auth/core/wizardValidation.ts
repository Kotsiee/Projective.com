import type { JoinStore, StepId } from "./wizardStore.ts";
import { AGE_MESSAGES, bracketFromDob } from "./age.ts";
import {
	confirmError,
	emailError,
	passwordError,
	phoneError,
	requiredError,
	usernameError,
	websiteError,
} from "./validate.ts";

/**
 * Per-step validation and payload assembly for the onboarding wizard. Each step validates only the
 * fields it renders (so a partial wizard never reports errors for steps the user hasn't reached),
 * and the same six step slots carry either Individual or Organization field sets.
 */
export function validateStep(store: JoinStore, id: StepId): Record<string, string | null> {
	const org = store.isOrg.value;
	switch (id) {
		case "account":
			return {};
		case "intent":
			return { intent: store.intent.value ? null : "Choose how you'll use Projective." };
		case "purpose":
			// Individual: optional. Organization: this slot carries the required scale baselines.
			return org
				? {
					employeeTier: store.employeeTier.value ? null : "Select a headcount range.",
					industry: store.industry.value ? null : "Select an industry.",
					website: websiteError(store.website.value),
				}
				: {};
		case "specialize":
			// Individual: skills are optional. Organization: registered address is required.
			return org
				? {
					street: requiredError(store.street.value, "Street"),
					city: requiredError(store.city.value, "City"),
					postcode: requiredError(store.postcode.value, "Postcode / ZIP"),
					country: store.country.value ? null : "Select a country.",
				}
				: {};
		case "identity":
			return org
				? {
					legalName: requiredError(store.legalName.value, "Legal company name"),
					handle: usernameError(store.handle.value),
				}
				: {
					firstName: requiredError(store.firstName.value, "First name"),
					lastName: requiredError(store.lastName.value, "Last name"),
					username: usernameError(store.username.value),
				};
		case "credentials":
			if (org) {
				return {
					corpEmail: emailError(store.corpEmail.value),
					phone: phoneError(store.phone.value),
					password: passwordError(store.password.value),
					confirm: confirmError(store.password.value, store.confirm.value),
				};
			}
			return {
				email: emailError(store.email.value),
				dob: store.dob.value
					? (bracketFromDob(store.dob.value) === "blocked" ? AGE_MESSAGES.blocked : null)
					: "Date of birth is required.",
				password: store.isOAuth ? null : passwordError(store.password.value),
				confirm: store.isOAuth ? null : confirmError(store.password.value, store.confirm.value),
			};
	}
}

/** True if an errors map has any non-null message. */
export function hasErrors(errors: Record<string, string | null>): boolean {
	return Object.values(errors).some(Boolean);
}

/** Assemble the API payload from the completed wizard state. */
export function buildPayload(store: JoinStore): Record<string, unknown> {
	if (store.isOrg.value) {
		return {
			type: "organization",
			// Organizations are buyers on Projective — the client persona is implicit, never a choice.
			intent: "client",
			legalName: store.legalName.value.trim(),
			tradingName: store.tradingName.value.trim(),
			handle: store.handle.value.trim(),
			registrationNumber: store.crn.value.trim(),
			website: store.website.value.trim(),
			corporateEmail: store.corpEmail.value.trim(),
			phone: store.phone.value.trim(),
			address: {
				street: store.street.value.trim(),
				city: store.city.value.trim(),
				postcode: store.postcode.value.trim(),
				country: store.country.value,
			},
			employeeTier: store.employeeTier.value,
			industry: store.industry.value,
			departments: store.departments.value,
			purpose: store.purpose.value,
			password: store.password.value,
			redirectTo: store.redirectTo,
		};
	}
	return {
		type: "individual",
		intent: store.intent.value,
		firstName: store.firstName.value.trim(),
		lastName: store.lastName.value.trim(),
		username: store.username.value.trim(),
		email: store.email.value.trim(),
		dob: store.dob.value,
		password: store.isOAuth ? undefined : store.password.value,
		oauth: store.isOAuth,
		purpose: store.purpose.value,
		skills: store.skills.value,
		restricted: bracketFromDob(store.dob.value) === "restricted",
		redirectTo: store.redirectTo,
	};
}
