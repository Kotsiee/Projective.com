import { assertEquals } from "@std/assert";
import {
	avatarTierFor,
	oauthAvatarFromMetadata,
	resolveAvatarUrl,
	safeOAuthAvatarUrl,
} from "./avatar.ts";

const UPLOADED = "https://db.example.co/storage/v1/object/public/avatars/u1/sm.webp";
const GOOGLE = "https://lh3.googleusercontent.com/a/abc=s96-c";

Deno.test("resolveAvatarUrl: uploaded photo wins over the OAuth picture", () => {
	assertEquals(resolveAvatarUrl({ uploaded: UPLOADED, oauth: GOOGLE }), UPLOADED);
});

Deno.test("resolveAvatarUrl: falls back to the OAuth picture, then null", () => {
	assertEquals(resolveAvatarUrl({ uploaded: null, oauth: GOOGLE }), GOOGLE);
	assertEquals(resolveAvatarUrl({ uploaded: "  ", oauth: GOOGLE }), GOOGLE);
	assertEquals(resolveAvatarUrl({}), null);
});

Deno.test("resolveAvatarUrl: an unsafe OAuth picture is dropped, never rendered", () => {
	assertEquals(resolveAvatarUrl({ oauth: "https://evil.example/x.png" }), null);
	assertEquals(resolveAvatarUrl({ oauth: "http://lh3.googleusercontent.com/a" }), null);
	assertEquals(resolveAvatarUrl({ oauth: "javascript:alert(1)" }), null);
});

Deno.test("resolveAvatarUrl: an over-long candidate is skipped, not truncated", () => {
	const long = `${UPLOADED}?${"x".repeat(500)}`;
	assertEquals(resolveAvatarUrl({ uploaded: long, oauth: GOOGLE }, 400), GOOGLE);
	assertEquals(resolveAvatarUrl({ uploaded: long }, 400), null);
});

Deno.test("safeOAuthAvatarUrl: provider subdomains pass, look-alikes do not", () => {
	assertEquals(safeOAuthAvatarUrl(GOOGLE), GOOGLE);
	assertEquals(safeOAuthAvatarUrl("https://googleusercontent.com.evil.io/a"), undefined);
	assertEquals(safeOAuthAvatarUrl(""), undefined);
});

Deno.test("oauthAvatarFromMetadata: avatar_url first, picture second", () => {
	assertEquals(oauthAvatarFromMetadata({ avatar_url: GOOGLE, picture: "https://x.io/p" }), GOOGLE);
	assertEquals(oauthAvatarFromMetadata({ picture: GOOGLE }), GOOGLE);
	assertEquals(oauthAvatarFromMetadata({ avatar_url: 42 }), undefined);
	assertEquals(oauthAvatarFromMetadata(null), undefined);
});

Deno.test("avatarTierFor: the tier plan's ranges", () => {
	assertEquals(avatarTierFor("sm"), "sm");
	assertEquals(avatarTierFor("lg"), "md");
	assertEquals(avatarTierFor("xl"), "md");
	assertEquals(avatarTierFor(40), "sm");
	assertEquals(avatarTierFor(48), "sm");
	assertEquals(avatarTierFor(96), "md");
	assertEquals(avatarTierFor(320), "lg");
});
