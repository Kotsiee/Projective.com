import { assert, assertEquals } from "@std/assert";
import {
	type MailMessage,
	sendEmailVerification,
	verificationLink,
} from "./verification-mailer.ts";

const TOKEN = "ab".repeat(32);

function recorder() {
	const lines: string[] = [];
	return { lines, log: (line: string) => lines.push(line) };
}

Deno.test("verificationLink — absolute, on the verify route, token encoded", () => {
	assertEquals(
		verificationLink("http://localhost:3000/", TOKEN),
		`http://localhost:3000/api/user/emails/verify?token=${TOKEN}`,
	);
	assertEquals(
		verificationLink("https://x.test", "a b"),
		"https://x.test/api/user/emails/verify?token=a%20b",
	);
});

Deno.test("sendEmailVerification — no transport, development: the link is logged under [dev mail]", async () => {
	const info = recorder();
	const warn = recorder();
	const outcome = await sendEmailVerification(
		{ to: "me@example.com", token: TOKEN, appUrl: "http://localhost:3000" },
		{ appEnv: "development", transport: null, info: info.log, warn: warn.log },
	);
	assertEquals(outcome, "logged");
	assertEquals(info.lines.length, 1);
	assert(info.lines[0].startsWith("[dev mail]"));
	assert(info.lines[0].includes(TOKEN));
	assertEquals(warn.lines, []);
});

Deno.test("sendEmailVerification — no transport, production: unavailable, and the token is never logged", async () => {
	const info = recorder();
	const warn = recorder();
	const outcome = await sendEmailVerification(
		{ to: "me@example.com", token: TOKEN, appUrl: "https://projective.example" },
		{ appEnv: "production", transport: null, info: info.log, warn: warn.log },
	);
	assertEquals(outcome, "unavailable");
	assertEquals(info.lines, []);
	assertEquals(warn.lines.length, 1);
	assertEquals(warn.lines[0].includes(TOKEN), false);
	assertEquals(warn.lines[0].includes("me@example.com"), false);
});

Deno.test("sendEmailVerification — a transport sends the link; a failing one is unavailable", async () => {
	const sent: MailMessage[] = [];
	const outcome = await sendEmailVerification(
		{ to: "me@example.com", token: TOKEN, appUrl: "https://projective.example" },
		{ appEnv: "production", transport: { send: (m) => Promise.resolve(void sent.push(m)) } },
	);
	assertEquals(outcome, "sent");
	assertEquals(sent[0].to, "me@example.com");
	assert(sent[0].text.includes(`https://projective.example/api/user/emails/verify?token=${TOKEN}`));

	const warn = recorder();
	const failed = await sendEmailVerification(
		{ to: "me@example.com", token: TOKEN, appUrl: "https://projective.example" },
		{
			appEnv: "production",
			transport: { send: () => Promise.reject(new Error("smtp down")) },
			warn: warn.log,
		},
	);
	assertEquals(failed, "unavailable");
	assertEquals(warn.lines[0].includes(TOKEN), false);
});
