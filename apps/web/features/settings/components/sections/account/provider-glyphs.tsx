import type { JSX } from "preact";
import type { SignInProvider } from "@projective/types/auth";
import { Icon } from "@projective/ui/icons";
import {
	AmazonMark,
	AppleSignInMark,
	FacebookSignInMark,
	GoogleMark,
	LinkedInSignInMark,
	MicrosoftMark,
} from "@features/shell/components/brand-marks.tsx";

/** The name each sign-in provider is known by. */
export const PROVIDER_LABEL: Readonly<Record<SignInProvider, string>> = {
	email: "Email & password",
	google: "Google",
	apple: "Apple",
	facebook: "Facebook",
	linkedin_oidc: "LinkedIn",
	azure: "Microsoft",
	amazon: "Amazon",
};

/**
 * A provider's mark — the brand's own colours (`brand-marks.tsx`), because a sign-in button is
 * recognised by its mark; Apple's is drawn in the current ink, as Apple asks. Decorative: the
 * provider's name is always beside it.
 */
export function ProviderGlyph({ provider }: { provider: SignInProvider }): JSX.Element {
	switch (provider) {
		case "google":
			return <GoogleMark class="stg-provider__glyph" />;
		case "apple":
			return <AppleSignInMark class="stg-provider__glyph" />;
		case "facebook":
			return <FacebookSignInMark class="stg-provider__glyph" />;
		case "linkedin_oidc":
			return <LinkedInSignInMark class="stg-provider__glyph" />;
		case "azure":
			return <MicrosoftMark class="stg-provider__glyph" />;
		case "amazon":
			return <AmazonMark class="stg-provider__glyph" />;
		default:
			return <Icon name="mail" size="md" class="stg-provider__glyph" />;
	}
}
