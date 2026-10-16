import { define } from "@web/utils/state.ts";
import { fieldErrors, JoinSchema } from "@features/auth/core/schema.ts";
import { safeRedirect } from "@features/auth/core/redirect.ts";
import { toAuthResponse } from "@features/auth/core/respond.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";
import type { EmployeeScale } from "@projective/types/org";
import { JOIN_AGE_LOCK_COOKIE, UNDER_MINIMUM_REASON, UNDER_MINIMUM_REFUSAL } from "@projective/types/auth";
import { fail, type ServiceResult } from "@server/services/ServiceResult.ts";
import { isSecureRequest, readCookies, sessionClearCookies } from "@web/utils/auth-cookies.ts";

/**
 * Answer an individual join, and when it was refused for an under-13 date of birth, lock this browser
 * session against another attempt (Decision #208) and — if the OAuth identity was discarded — clear
 * the session cookies that pointed at it. The lock cookie carries no data.
 */
function withAgeLock<T extends object>(req: Request, result: ServiceResult<T>): Response {
	const res = toAuthResponse(req, result);
	if (result.details?.reason !== UNDER_MINIMUM_REASON) return res;
	const secure = isSecureRequest(req) ? "; Secure" : "";
	res.headers.append("set-cookie", `${JOIN_AGE_LOCK_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax${secure}`);
	if (result.details.discarded === true) {
		for (const cookie of sessionClearCookies(req)) res.headers.append("set-cookie", cookie);
	}
	return res;
}

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
 * `POST /api/auth/join` — thin route: parse + Zod-validate the individual OR enterprise payload,
 * then delegate to the fat {@link AuthBackendService}, which enforces eligibility (age-gate, password
 * rule) and provisions. Islands are dumb: they POST here and act on the result.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null);
		if (!body) {
			return Response.json({ ok: false, message: "Invalid request body." }, { status: 400 });
		}

		const individual = typeof body === "object" && body.type === "individual";
		if (individual && readCookies(ctx.req)[JOIN_AGE_LOCK_COOKIE] === "1") {
			return toAuthResponse(ctx.req, fail(422, { errors: { dob: UNDER_MINIMUM_REFUSAL } }));
		}

		const parsed = JoinSchema.safeParse(body);
		if (individual && !parsed.success && fieldErrors(parsed.error).dob === UNDER_MINIMUM_REFUSAL) {
			return withAgeLock(
				ctx.req,
				await AuthBackendService.refuseUnderMinimum({
					oauth: body.oauth === true,
					accessToken: readAccessToken(ctx.req),
					dob: String(body.dob),
					timeZone: typeof body.timeZone === "string" ? body.timeZone : undefined,
				}),
			);
		}
		if (!parsed.success) {
			return Response.json({ ok: false, errors: fieldErrors(parsed.error) }, { status: 422 });
		}

		const data = parsed.data;
		const redirectTo = safeRedirect(data.redirectTo);

		if (data.type === "individual") {
			return withAgeLock(
				ctx.req,
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
					timeZone: data.timeZone,
					intent: data.intent,
					skills: data.skills,
					interests: data.purpose,
					locale: data.locale,
					displayCurrency: data.displayCurrency,
					redirectTo,
				}),
			);
		}

		return toAuthResponse(
			ctx.req,
			await AuthBackendService.provisionAccount({
				type: "enterprise",
				corporateEmail: data.corporateEmail,
				password: data.password,
				locale: data.locale,
				displayCurrency: data.displayCurrency,
				enterprise: {
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
