import { define } from "@web/utils/state.ts";
import { fieldErrors, JoinSchema } from "@features/auth/core/schema.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";
import type { EmployeeScale } from "@projective/types/org";

/** Pull the Supabase access token off the request cookies (present for an OAuth completion). */
function readAccessToken(req: Request): string | undefined {
	const cookie = req.headers.get("cookie");
	if (!cookie) return undefined;
	for (const part of cookie.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === "sb-access-token") return decodeURIComponent(rest.join("="));
	}
	return undefined;
}

/**
 * `POST /api/auth/join` — thin route: parse + Zod-validate the individual OR organisation payload,
 * then delegate to the fat {@link AuthBackendService}, which enforces eligibility (age-gate, password
 * rule) and provisions. Islands are dumb: they POST here and act on the result.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) {
			return Response.json({ ok: false, message: "Invalid request body." }, { status: 400 });
		}

		const parsed = JoinSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json({ ok: false, errors: fieldErrors(parsed.error) }, { status: 422 });
		}

		const data = parsed.data;
		const redirectTo = safeRedirect(data.redirectTo);

		if (data.type === "individual") {
			return toAuthResponse(
				await AuthBackendService.provisionAccount({
					type: "individual",
					email: data.email,
					password: data.password,
					oauth: data.oauth,
					accessToken: readAccessToken(ctx.req),
					firstName: data.firstName,
					lastName: data.lastName,
					username: data.username,
					dob: data.dob,
					intent: data.intent,
					skills: data.skills,
					interests: data.purpose,
					redirectTo,
				}),
			);
		}

		return toAuthResponse(
			await AuthBackendService.provisionAccount({
				type: "organization",
				corporateEmail: data.corporateEmail,
				password: data.password,
				organisation: {
					legalName: data.legalName,
					tradingName: data.tradingName,
					handle: data.handle,
					registrationNumber: data.registrationNumber,
					corporateEmail: data.corporateEmail,
					corporatePhone: data.phone,
					website: data.website,
					addressLine1: data.address.street,
					addressCity: data.address.city,
					addressPostcode: data.address.postcode,
					addressCountry: data.address.country,
					// Post-Zod-validated against the same enum values as EmployeeScale.
					employeeScale: data.employeeTier as EmployeeScale,
					primaryIndustry: data.industry,
					industryOther: data.industryOther,
					departments: data.departments,
					purpose: data.purpose,
				},
				redirectTo,
			}),
		);
	},
});
