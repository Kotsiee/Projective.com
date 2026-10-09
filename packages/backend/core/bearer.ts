/**
 * Whether an `Authorization` header carries exactly `Bearer <secret>`, compared in constant time. A
 * secret shorter than 32 characters (or absent) authorises nothing, so an unset scheduler secret
 * leaves its endpoint closed rather than open.
 */
export function isBearerAuthorised(
	authorization: string | null,
	secret: string | undefined,
): boolean {
	const expected = secret?.trim() ?? "";
	if (expected.length < 32) return false;
	const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
	const a = new TextEncoder().encode(token);
	const b = new TextEncoder().encode(expected);
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}
