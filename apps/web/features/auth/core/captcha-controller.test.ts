import { assertEquals } from "@std/assert";
import { createCaptchaController } from "./captcha-controller.ts";

Deno.test("with no widget, take answers at once with no token", async () => {
	const captcha = createCaptchaController();
	assertEquals(await captcha.take(), undefined);
});

Deno.test("take returns a token already held", async () => {
	const captcha = createCaptchaController();
	captcha.phase.value = "ready";
	captcha.token.value = "tok-1";
	assertEquals(await captcha.take(), "tok-1");
});

Deno.test("take waits for the running check to yield a token", async () => {
	const captcha = createCaptchaController();
	captcha.phase.value = "loading";
	const pending = captcha.take(1_000);
	setTimeout(() => {
		captcha.token.value = "tok-2";
		captcha.phase.value = "ready";
	}, 10);
	assertEquals(await pending, "tok-2");
});

Deno.test("take gives up on a failed check, or after its timeout", async () => {
	const failing = createCaptchaController();
	failing.phase.value = "loading";
	const pending = failing.take(1_000);
	setTimeout(() => (failing.phase.value = "failed"), 10);
	assertEquals(await pending, undefined);

	const stuck = createCaptchaController();
	stuck.phase.value = "interactive";
	assertEquals(await stuck.take(20), undefined);
});

Deno.test("reset spends the token, conceals the frame and reruns the widget", () => {
	const captcha = createCaptchaController();
	let widgetResets = 0;
	captcha.bindReset(() => widgetResets++);
	captcha.phase.value = "ready";
	captcha.token.value = "tok-3";
	captcha.revealed.value = true;
	captcha.reset();
	assertEquals(captcha.token.value, null);
	assertEquals(captcha.revealed.value, false);
	assertEquals(captcha.phase.value, "loading");
	assertEquals(widgetResets, 1);

	captcha.bindReset(null);
	captcha.phase.value = "off";
	captcha.reset();
	assertEquals(captcha.phase.value, "off");
	assertEquals(widgetResets, 1);
});
