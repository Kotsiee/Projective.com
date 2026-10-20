import type { HelpCentreArticle } from "@projective/types/editorial";
import { helpArticle } from "./define.ts";

/** The `account-and-security` category's articles, in reading order. */

/**
 * Signing in. Grounded in PRODUCT_SPEC §Account Creation → Authentication surfaces (one identifier —
 * email or @handle; never says which half was wrong; Keep me signed in for 30 days — Decision #201;
 * the 6-digit email code at /verify — Decision #185) and §Settings → Connected accounts and Email
 * addresses. The reset flow is read from `ForgotPasswordForm` (a 6-digit code by email).
 */
const signingIn = helpArticle({
	slug: "signing-in",
	category: "account-and-security",
	position: 0,
	title: "Signing in and staying signed in",
	summary:
		"Sign in with your email or @handle and your password, or with Google; Keep me signed in keeps you signed in on that device for 30 days, and a forgotten password is reset with a 6-digit code sent by email.",
	roles: ["client", "freelancer", "team", "business"],
	related: [
		"change-your-handle-or-close-your-account",
		"contact-details-in-messages",
		"age-requirements",
	],
	sections: [
		{
			id: "signing-in",
			heading: "Signing in",
			body: [
				{
					type: "p",
					content:
						"On the sign-in page, enter either your email address or your @handle, then your password. If either is wrong, the message doesn't say which — that stops anyone using the form to find out whether an account exists.",
				},
				{
					type: "p",
					content: [
						{ type: "strong", text: "Keep me signed in" },
						" is on by default and keeps you signed in on that device for 30 days between visits. Untick it on a shared computer: you're then signed out when the browser closes.",
					],
				},
			],
		},
		{
			id: "other-ways-in",
			heading: "Other ways in",
			body: [
				{
					type: "p",
					content: [
						"You can sign in with Google, and connect other accounts in ",
						{ type: "link", href: "/settings/account", text: "Settings → Account" },
						" where they are available. You can disconnect a sign-in method as long as another one remains.",
					],
				},
			],
		},
		{
			id: "forgotten-password",
			heading: "A forgotten password",
			body: [
				{
					type: "list",
					ordered: true,
					items: [
						"Choose Forgot password on the sign-in page and enter your email.",
						"We email you a 6-digit code. The page looks the same whether or not the address has an account.",
						"Enter the code and your new password, then sign in.",
					],
				},
				{
					type: "p",
					content:
						"New accounts confirm their email the same way, with a 6-digit code — or with the link in the email.",
				},
			],
		},
	],
});

/**
 * Age rules. Grounded in PRODUCT_SPEC §Age guardrails (Decision #208: under 13 blocked with nothing
 * kept; 13–17 one restricted rule set — no money, selling, workspaces or strangers, mutual-follow DMs,
 * never public, hidden rather than refused, "Limited account"; 18+ full; personal projects for every
 * account; birthdays on the person's own time zone).
 */
const ageRequirements = helpArticle({
	slug: "age-requirements",
	category: "account-and-security",
	position: 1,
	title: "Age requirements and limited accounts",
	summary:
		"You must be at least 13 to have an account. From 13 to 17 you have a limited account — explore, build a private profile and run personal projects, but no buying, selling or payments — and everything unlocks on your 18th birthday.",
	roles: ["client", "freelancer"],
	related: ["signing-in", "contact-details-in-messages", "create-a-project"],
	sections: [
		{
			id: "the-three-ages",
			heading: "The three age groups",
			body: [
				{
					type: "table",
					head: ["Age", "Account", "What it means"],
					rowHeaders: true,
					rows: [
						[
							"Under 13",
							"Not allowed",
							"No account is created, and nothing about the attempt is kept.",
						],
						[
							"13 to 17",
							"Limited account",
							"Explore, read articles, build a private profile and portfolio, and run personal projects.",
						],
						["18 and over", "Full account", "Everything, subject to the usual identity checks."],
					],
				},
			],
		},
		{
			id: "limited-accounts",
			heading: "What a limited account can't do",
			body: [
				{
					type: "list",
					items: [
						"Buy, sell, book calls or sessions, fund or claim paid work, or publish listings.",
						"Have a wallet or a payout account.",
						"Create or join a team, business or enterprise.",
						"Have a public profile, or show its location and local time to others.",
						"Message people who don't follow it back.",
					],
				},
				{
					type: "p",
					content:
						"Instead of showing these and refusing, Projective leaves them out, and Settings → Account shows the account as a Limited account. A limited account isn't tracked for personalised discovery, and its searches are logged anonymously.",
				},
			],
		},
		{
			id: "birthdays",
			heading: "Birthdays",
			body: [
				{
					type: "p",
					content:
						"Your age changes automatically on your birthday, in your own time zone. A personal project you created while under 18 stays personal; start a new project when you want to hire.",
				},
			],
		},
	],
});

/**
 * Contact details in messages. Grounded in PRODUCT_SPEC §Messaging, Collaboration & Connections →
 * 1. Platform Integrity (the protected phase and the Projective Unlock), §3. The "Handover" State
 * (masking in stage messages and related DMs) and Decision #147 (the shipped database tier; public
 * copy never unlocked — whose check is not yet enforced, so the article states the rule, not a refusal).
 */
const contactDetailsInMessages = helpArticle({
	slug: "contact-details-in-messages",
	category: "account-and-security",
	position: 2,
	title: "Why contact details are hidden in messages",
	summary:
		"While a project is under way, new messages in it have email addresses, phone numbers, known payment links and payment handles replaced with placeholders such as [email hidden] as they are sent; the restriction lifts once the project's final payment is released.",
	roles: ["client", "freelancer", "team", "business"],
	related: ["what-is-escrow", "signing-in", "how-disputes-are-decided"],
	sections: [
		{
			id: "what-is-hidden",
			heading: "What is hidden, and where",
			body: [
				{
					type: "p",
					content:
						"From the first proposal until the project's final payment is released, messages in its rooms — and direct messages between people negotiating or working on it — are checked as they are sent. Anything that looks like contact or payment details is replaced:",
				},
				{
					type: "list",
					items: [
						{ content: [{ type: "code", text: "[email hidden]" }, " — an email address"] },
						{ content: [{ type: "code", text: "[phone hidden]" }, " — a phone number"] },
						{
							content: [
								{ type: "code", text: "[link hidden]" },
								" — a payment or messaging link, such as PayPal or WhatsApp",
							],
						},
						{
							content: [
								{ type: "code", text: "[handle hidden]" },
								" — a payment handle, such as a $cashtag",
							],
						},
					],
				},
				{
					type: "p",
					content:
						"Nobody can switch this off for a project, because it protects both sides: work and payment stay where escrow can protect them.",
				},
			],
		},
		{
			id: "the-unlock",
			heading: "When it lifts",
			body: [
				{
					type: "p",
					content:
						"When a project's final payment is released, the restriction lifts for that project's conversations. Swapping details then is welcome — many good working relationships start here.",
				},
				{
					type: "callout",
					tone: "warning",
					title: "Public pages never unlock",
					body: [
						{
							type: "p",
							content:
								"Your profile, service and product listings and public project briefs must never include bank or card details, payment links or direct contact details — at any time.",
						},
					],
				},
			],
		},
	],
});

/**
 * Handle and account closure. Grounded in PRODUCT_SPEC §Settings (Decision #156: a handle may change
 * twice within three days, then locks for 90 days, and a given-up handle is held for 90 days; switching
 * freelancer → client erases the freelancer profile after 90 days; deleting the account hides the
 * profile at once and erases personal data after 30 days, blocked while money, work or owned entities
 * remain; both behind a typed CONFIRM).
 */
const changeYourHandleOrCloseYourAccount = helpArticle({
	slug: "change-your-handle-or-close-your-account",
	category: "account-and-security",
	position: 3,
	title: "Change your handle or close your account",
	summary:
		"You can change your @handle twice within three days before it locks for 90 days; closing your account hides your profile at once and erases your personal data after 30 days, unless you cancel.",
	roles: ["client", "freelancer", "team", "business"],
	related: ["signing-in", "withdraw-your-earnings", "age-requirements"],
	sections: [
		{
			id: "your-handle",
			heading: "Your @handle",
			body: [
				{
					type: "p",
					content:
						"Change it in Settings → Account. You can change it twice within three days — enough to fix a typo — and after the second change it is locked for 90 days. Settings tells you how many changes are left and, once locked, when it unlocks.",
				},
				{
					type: "p",
					content:
						"A handle you give up is kept for you for 90 days: nobody else can take it, and you can take it back.",
				},
			],
		},
		{
			id: "stop-freelancing",
			heading: "Going back to hiring only",
			body: [
				{
					type: "p",
					content:
						"A freelancer can switch to client only, after typing CONFIRM. Selling stops at once and your listings are taken down; your freelancer profile is erased after 90 days, and becoming a freelancer again within those 90 days restores everything. Reviews and money records are kept, because other people rely on them.",
				},
			],
		},
		{
			id: "close-your-account",
			heading: "Closing your account",
			body: [
				{
					type: "p",
					content:
						"Delete your account from Settings → Account, after typing CONFIRM. Your profile is hidden straight away and your personal data is erased after 30 days; until then you can cancel from Settings. Records of money that moved are kept, anonymised, for as long as the law requires.",
				},
				{
					type: "callout",
					tone: "note",
					title: "Finish up first",
					body: [
						{
							type: "p",
							content:
								"You can't close your account, or stop freelancing, while money is held in escrow for you, you have live work, or your wallet still holds money. Closing your account also waits until no project you own is running and you no longer own a team, business or enterprise.",
						},
					],
				},
			],
		},
	],
});

/** Every `account-and-security` article. */
export const ACCOUNT_AND_SECURITY_ARTICLES: readonly HelpCentreArticle[] = [
	signingIn,
	ageRequirements,
	contactDetailsInMessages,
	changeYourHandleOrCloseYourAccount,
];
