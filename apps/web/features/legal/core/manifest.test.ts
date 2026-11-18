/**
 * The server's sign-up legal manifest (`@projective/types/legal`, Decision #446) against the content
 * modules it mirrors: every version a person can read on `/legal/<slug>` is listed in the manifest
 * with the same effective date, in the same order, so the version a sign-up records is always the
 * version `/legal/<slug>` shows as current.
 */
import { assertEquals } from "@std/assert";
import {
	currentLegalVersion,
	LEGAL_VERSIONS,
	SIGNUP_LEGAL_SLUGS,
	type SignupLegalSlug,
	utcToday,
} from "@projective/types/legal";
import type { LegalDoc } from "@projective/types/content";
import { TERMS_VERSIONS } from "./content/terms.ts";
import { PRIVACY_VERSIONS } from "./content/privacy.ts";
import { ACCEPTABLE_USE_VERSIONS } from "./content/acceptable-use.ts";
import { versionStatuses } from "./versions.ts";

const CONTENT: Readonly<Record<SignupLegalSlug, readonly LegalDoc[]>> = {
	terms: TERMS_VERSIONS,
	"acceptable-use": ACCEPTABLE_USE_VERSIONS,
	privacy: PRIVACY_VERSIONS,
};

for (const slug of SIGNUP_LEGAL_SLUGS) {
	const versions = CONTENT[slug];
	Deno.test(`the ${slug} manifest lists every content version, newest first`, () => {
		assertEquals(
			LEGAL_VERSIONS[slug].map((v) => [v.version, v.effectiveDate]),
			versions.map((v) => [v.version, v.effectiveDate]),
		);
	});

	Deno.test(`the ${slug} version recorded today is the one /legal/${slug} shows as current`, () => {
		const today = utcToday();
		const current = versionStatuses(versions, today).find((v) => v.status === "current");
		assertEquals(currentLegalVersion(slug, today), current?.version);
	});
}
