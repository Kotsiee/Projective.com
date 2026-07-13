import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { unsplash } from "../core/landing-data.ts";

/**
 * Testimonials — a continuously moving marquee of alternating client & freelancer success stories.
 * Two rows drift in opposite directions for depth; the track is duplicated so the loop is seamless
 * (pure CSS animation, no JS measurement). Pauses on hover/focus; reduced-motion freezes it into a
 * static, scrollable strip. Zero client JS.
 */
type Voice = "client" | "freelancer";
interface Quote {
	quote: string;
	name: string;
	role: string;
	voice: Voice;
	avatar: string;
}

const QUOTES: Quote[] = [
	{
		quote:
			"We put together a five-person team in a day and finished our rebrand in three easy steps. Paying safely made it painless.",
		name: "Dana Whitfield",
		role: "Founder, Helia",
		voice: "client",
		avatar: unsplash("1544005313-94ddf0286df2", 120, 120),
	},
	{
		quote:
			"Getting paid a bit at a time changed everything. I focus on the work, not on chasing people for money.",
		name: "Ren Koda",
		role: "3D Designer",
		voice: "freelancer",
		avatar: unsplash("1507003211169-0a1dd7228f2d", 120, 120),
	},
	{
		quote:
			"It felt like hiring one reliable team, except we got to pick every person ourselves.",
		name: "Marcus Lee",
		role: "Head of Product, Atlas",
		voice: "client",
		avatar: unsplash("1500648767791-00dcc994a43e", 120, 120),
	},
	{
		quote:
			"The step-by-step board keeps everyone on the same page. Sign-off is instant and I get paid automatically.",
		name: "Juno Park",
		role: "Frontend Engineer",
		voice: "freelancer",
		avatar: unsplash("1519085360753-af0119f7cbe7", 120, 120),
	},
	{
		quote:
			"We set the money aside in minutes and watched the work show up right on the board. Total peace of mind.",
		name: "Priya Nair",
		role: "COO, Verdant",
		voice: "client",
		avatar: unsplash("1573496359142-b8d87734a5a2", 120, 120),
	},
	{
		quote:
			"Bringing my little team together here doubled the projects we can take on side by side.",
		name: "Atelier Nova",
		role: "Studio Lead",
		voice: "freelancer",
		avatar: unsplash("1600880292203-757bb62b4baf", 120, 120),
	},
];

function Row({ items, reverse }: { items: Quote[]; reverse?: boolean }): JSX.Element {
	// Duplicate the sequence so the -50% keyframe wraps seamlessly.
	const loop = [...items, ...items];
	return (
		<div class={`lp-quotes__row${reverse ? " lp-quotes__row--rev" : ""}`}>
			<div class="lp-quotes__track">
				{loop.map((q, i) => (
					<figure class={`lp-quote lp-quote--${q.voice}`} key={i} aria-hidden={i >= items.length}>
						<span class="lp-quote__tag">{q.voice === "client" ? "Customer" : "Helper"}</span>
						<blockquote class="lp-quote__text">{q.quote}</blockquote>
						<figcaption class="lp-quote__who">
							<Avatar image={q.avatar} alt="" size="md" />
							<span class="lp-quote__id">
								<span class="lp-quote__name">{q.name}</span>
								<span class="lp-quote__role">{q.role}</span>
							</span>
						</figcaption>
					</figure>
				))}
			</div>
		</div>
	);
}

export function Testimonials(): JSX.Element {
	return (
		<section class="lp-section lp-quotes" aria-labelledby="lp-quotes-title">
			<div class="lp-section__container">
				<header class="lp-section__head">
					<div class="lp-section__headmain">
						<span class="lp-eyebrow">Loved by both sides</span>
						<h2 class="lp-section__title" id="lp-quotes-title">
							<span class="lp-section__title-thin">Happy stories from</span>
							<span class="lp-section__title-strong">customers & helpers</span>
						</h2>
					</div>
				</header>
			</div>
			<div class="lp-quotes__marquee">
				<Row items={QUOTES} />
				<Row items={[...QUOTES].reverse()} reverse />
			</div>
		</section>
	);
}
