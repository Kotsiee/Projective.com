import { assertEquals } from "@std/assert";
import { isAutomatedAgent } from "./automated-agent.ts";

const PEOPLE = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
	"Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
];

const AUTOMATION = [
	"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
	"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
	"Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
	"facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
	"Twitterbot/1.0",
	"Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
	"WhatsApp/2.23.20.0",
	"curl/8.4.0",
	"python-requests/2.31.0",
	"Go-http-client/2.0",
	"Deno/2.1.4",
];

Deno.test("a person's browser is not automation", () => {
	for (const ua of PEOPLE) assertEquals(isAutomatedAgent(ua), false, ua);
});

Deno.test("crawlers, unfurlers, headless browsers and HTTP clients are", () => {
	for (const ua of AUTOMATION) assertEquals(isAutomatedAgent(ua), true, ua);
});

Deno.test("a request with no User-Agent is automation", () => {
	for (const ua of [null, undefined, "", "   "]) assertEquals(isAutomatedAgent(ua), true);
});
