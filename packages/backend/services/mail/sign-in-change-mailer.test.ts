import { assert, assertEquals } from "@std/assert";
import {
	maskAddress,
	sendSignInChangedNotice,
	signInChangedMessage,
} from "./sign-in-change-mailer.ts";

Deno.test("maskAddress — keeps the first letter and the domain", () => {
	assertEquals(maskAddress("jane.doe@example.com"), "j•••@example.com");
	assertEquals(maskAddress("a@b.io"), "a•••@b.io");
	assertEquals(maskAddress("no-at-sign"), "•••");
	assertEquals(maskAddress("@example.com"), "•••");
});

Deno.test("the notice goes to the OLD address and never spells out the new one", () => {
	const message = signInChangedMessage(
		"ada@work.example",
		"ada.lovelace@home.example",
		"https://app.example/",
	);
	assertEquals(message.to, "ada@work.example");
	assertEquals(message.text.includes("ada.lovelace@home.example"), false);
	assert(message.text.includes("a•••@home.example"));
	assert(message.text.includes("https://app.example/contact"));
	assertEquals(/https?:\/\/\S*token/i.test(message.text), false);
});

Deno.test("sendSignInChangedNotice — logged in development, unavailable in production", async () => {
	const lines: string[] = [];
	const dev = await sendSignInChangedNotice(
		{ to: "ada@work.example", newAddress: "ada@home.example", appUrl: "http://localhost" },
		{ appEnv: "development", transport: null, info: (l) => lines.push(l), warn: () => {} },
	);
	assertEquals(dev, "logged");
	assert(lines[0].includes("ada@work.example"));
	const prod = await sendSignInChangedNotice(
		{ to: "ada@work.example", newAddress: "ada@home.example", appUrl: "https://app.example" },
		{ appEnv: "production", transport: null, info: () => {}, warn: () => {} },
	);
	assertEquals(prod, "unavailable");
});
