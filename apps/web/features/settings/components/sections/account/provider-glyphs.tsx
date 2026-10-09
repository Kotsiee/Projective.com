import type { JSX } from "preact";
import type { SignInProvider } from "@projective/types/auth";
import { Icon } from "@projective/ui/icons";
import { GoogleGlyph } from "@features/auth/components/icons.tsx";

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
 * A provider's mark — the brand's own colours, like `GoogleGlyph`, because a sign-in button is
 * recognised by its mark; Apple's is drawn in the current ink, as Apple asks. Decorative: the
 * provider's name is always beside it.
 */
export function ProviderGlyph({ provider }: { provider: SignInProvider }): JSX.Element {
	switch (provider) {
		case "google":
			return <GoogleGlyph class="stg-provider__glyph" />;
		case "apple":
			return (
				<svg class="stg-provider__glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
					<path
						fill="currentColor"
						d="M12.2 9.6c0-1.6 1.3-2.4 1.4-2.4-.8-1.1-2-1.3-2.4-1.3-1-.1-2 .6-2.5.6s-1.3-.6-2.2-.6c-1.1 0-2.2.7-2.8 1.7-1.2 2.1-.3 5.2.9 6.9.6.8 1.2 1.7 2.1 1.7.8 0 1.2-.5 2.2-.5s1.3.5 2.2.5c.9 0 1.5-.9 2-1.7.6-.9.9-1.8.9-1.8s-1.8-.7-1.8-2.8zM10.6 4.6c.4-.6.8-1.3.7-2.1-.7 0-1.5.5-2 1-.4.5-.8 1.3-.7 2.1.8.1 1.5-.4 2-1z"
					/>
				</svg>
			);
		case "facebook":
			return (
				<svg class="stg-provider__glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
					<circle cx="9" cy="9" r="9" fill="#1877F2" />
					<path
						fill="#FFFFFF"
						d="M12.5 11.6l.4-2.6h-2.5V7.3c0-.7.3-1.4 1.5-1.4h1.1V3.7s-1-.2-2-.2c-2.1 0-3.4 1.2-3.4 3.5V9H5.3v2.6h2.3V18h2.8v-6.4h2.1z"
					/>
				</svg>
			);
		case "linkedin_oidc":
			return (
				<svg class="stg-provider__glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
					<rect width="18" height="18" rx="3" fill="#0A66C2" />
					<path
						fill="#FFFFFF"
						d="M5.3 7.1H3V15h2.3V7.1zM4.2 3.3C3.4 3.3 2.8 3.9 2.8 4.6S3.4 6 4.2 6s1.3-.6 1.3-1.4-.6-1.3-1.3-1.3zM15.2 10.5c0-2.2-1.2-3.5-3-3.5-1 0-1.7.5-2 1.1V7.1H7.9V15h2.3v-4.1c0-1.1.2-2 1.5-2s1.3 1.2 1.3 2.1v4h2.3l-.1-4.5z"
					/>
				</svg>
			);
		case "azure":
			return (
				<svg class="stg-provider__glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
					<rect x="1" y="1" width="7.5" height="7.5" fill="#F25022" />
					<rect x="9.5" y="1" width="7.5" height="7.5" fill="#7FBA00" />
					<rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF" />
					<rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900" />
				</svg>
			);
		case "amazon":
			return (
				<svg class="stg-provider__glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
					<rect width="18" height="18" rx="3" fill="#232F3E" />
					<path
						fill="none"
						stroke="#FF9900"
						stroke-width="1.4"
						stroke-linecap="round"
						d="M4 11.5c3 2 7 2 10 0M12.6 10.6l1.6.8-.6 1.6"
					/>
				</svg>
			);
		default:
			return <Icon name="mail" size="md" class="stg-provider__glyph" />;
	}
}
