import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { dsConfig } from "@projective/ui/system";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { profileHref } from "@features/explore/core/routing.ts";
import "../styles/profile.css";
import { ProfileMetrics } from "../components/ProfileMetrics.tsx";
import { ProfileShowcase } from "../components/ProfileShowcase.tsx";
import { ENTITY_META, TIER_META } from "../components/profile-glyphs.tsx";
import { ctaFor } from "../core/profile-model.ts";
import {
	editedAvatar,
	editedShowcase,
	following,
	quickMessageOpen,
} from "../core/profile-state.ts";
import type {
	ProfileShowcase as ProfileShowcaseMedia,
	ProfileView,
} from "../types/profile-types.ts";
import ProfileMessagePopover from "./ProfileMessagePopover.island.tsx";

/**
 * ProfileHero — the split hero of the `/[handle]` profile: the identity column (72px avatar · name +
 * trust crest · `@handle` and entity kind · the Message ⁄ Follow rig · the inline metrics strip)
 * beside the showcase frame, which is simply absent — no placeholder — when the profile has no
 * showreel or cover.
 *
 * It is an island because it owns the visitor's Message ⁄ Follow state and the owner's image
 * pickers. An owner changes the avatar or the showcase in place through the Asset Picker (one key
 * for both targets, the target held locally — the picker is a modal, so only one can be open);
 * the edit lands in the shared `edited*` signals so any other island drawing the same image agrees.
 * Optimistic and session-local, pending the profile write path.
 *
 * SSR renders a playing showreel. Under either reduced-motion channel — the OS media query or the
 * in-app `dsConfig.reducedMotion` — the island withdraws `autoplay` and pauses the element back to
 * its poster, so a viewer who asked for no motion never sees a frame move after hydration.
 */
export interface ProfileHeroProps {
	profile: ProfileView;
	/** Whether the viewer owns this profile (swaps the rig for Settings ⁄ Share + the image pickers). */
	canEdit: boolean;
}

const PICKER_ID = "profile-image";
const STATUS_TTL_MS = 2500;

type ImageTarget = "avatar" | "showcase";

function resolveShowcase(
	base: ProfileShowcaseMedia | null,
	edited: string | null,
	name: string,
): ProfileShowcaseMedia | null {
	if (edited) return { kind: "image", src: edited, alt: base?.alt ?? `${name} — showcase` };
	return base;
}

function isAbort(err: unknown): boolean {
	return err instanceof DOMException && err.name === "AbortError";
}

export default function ProfileHero({ profile, canEdit }: ProfileHeroProps): JSX.Element {
	const avatar = editedAvatar.value ?? profile.avatar;
	const showcase = resolveShowcase(profile.showcase, editedShowcase.value, profile.name);
	const target = useSignal<ImageTarget>("avatar");
	const envReduced = useSignal(false);
	const status = useSignal("");
	const video = useRef<HTMLVideoElement>(null);
	const statusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const reduced = envReduced.value || dsConfig.value.reducedMotion;

	useEffect(() => {
		const mql = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
		const sync = () => {
			envReduced.value = (mql?.matches ?? false) ||
				document.documentElement.dataset.motion === "reduced";
		};
		sync();
		mql?.addEventListener("change", sync);
		return () => mql?.removeEventListener("change", sync);
	}, []);

	useEffect(() => {
		const el = video.current;
		if (!el || !reduced) return;
		el.pause();
		el.load();
	}, [reduced]);

	useEffect(() => () => clearTimeout(statusTimer.current), []);

	function announce(text: string): void {
		status.value = text;
		clearTimeout(statusTimer.current);
		statusTimer.current = setTimeout(() => {
			status.value = "";
		}, STATUS_TTL_MS);
	}

	function choose(which: ImageTarget): void {
		target.value = which;
		openPicker({
			requesterId: PICKER_ID,
			title: which === "showcase" ? "Choose a showcase image" : "Choose a profile picture",
			kinds: ["image"],
			multiple: false,
		});
	}

	function apply(assets: AssetItem[]): void {
		const picked = assets[0];
		if (!picked) return;
		if (target.value === "showcase") editedShowcase.value = picked.url;
		else editedAvatar.value = picked.thumbnailUrl ?? picked.url;
	}

	async function share(): Promise<void> {
		const url = new URL(profileHref(profile.handle), globalThis.location.origin).href;
		if (typeof navigator.share === "function") {
			try {
				await navigator.share({ title: profile.name, url });
				return;
			} catch (err) {
				if (isAbort(err)) return;
			}
		}
		try {
			await navigator.clipboard.writeText(url);
			announce("Link copied");
		} catch {
			announce("Couldn't copy the link — copy it from the address bar");
		}
	}

	const cta = ctaFor(profile.kind);
	const isFollowing = following.value;
	const tier = TIER_META[profile.tier];

	return (
		<>
			<header class="pf-hero" data-showcase={showcase ? "true" : "false"}>
				<div class="pf-hero__id">
					<div class="pf-hero__avatarwrap">
						<Avatar
							image={avatar}
							label={profile.name}
							size={72}
							shape="circle"
							class="pf-hero__avatar"
						/>
						{canEdit && (
							<span class="pf-hero__imgslot">
								<Tooltip content="Change profile picture" placement="bottom">
									<button
										type="button"
										class="pf-hero__imgbtn"
										aria-label="Change profile picture"
										onClick={() => choose("avatar")}
									>
										<Icon name="image" size="xs" />
									</button>
								</Tooltip>
							</span>
						)}
					</div>

					<h1 class="pf-hero__name">
						<span class="pf-hero__nametext">{profile.name}</span>
						{profile.verified && (
							<Tooltip content={tier.title} placement="top">
								<Icon
									name="verified"
									filled
									size="md"
									class="pf-hero__crest"
									title={tier.title}
								/>
							</Tooltip>
						)}
					</h1>

					<p class="pf-hero__meta">
						<span class="pf-hero__handle">{profile.handle}</span>
						<span class="pf-hero__dot" aria-hidden="true">·</span>
						<span>{ENTITY_META[profile.kind].label}</span>
					</p>

					<div class="pf-hero__actions">
						{canEdit
							? (
								<>
									<a
										class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded pf-hero__cta pf-hero__cta--primary"
										href="/settings"
									>
										<span class="ui-button__label">Settings</span>
									</a>
									<Button
										rounded
										size="md"
										variant="outlined"
										class="pf-hero__cta pf-hero__cta--secondary"
										onClick={() => void share()}
									>
										Share
									</Button>
									<p
										class={status.value ? "pf-hero__status" : "pf-hero__status ui-visually-hidden"}
										role="status"
										aria-live="polite"
									>
										{status.value}
									</p>
								</>
							)
							: (
								<>
									<Button
										rounded
										size="md"
										class="pf-hero__cta pf-hero__cta--primary"
										onClick={() => {
											quickMessageOpen.value = true;
										}}
									>
										{cta.primary}
									</Button>
									<Button
										rounded
										size="md"
										variant="outlined"
										class="pf-hero__cta pf-hero__cta--secondary"
										aria-pressed={isFollowing}
										onClick={() => {
											following.value = !isFollowing;
										}}
									>
										{isFollowing ? "Following" : cta.secondary}
									</Button>
								</>
							)}
					</div>

					<ProfileMetrics profile={profile} />
				</div>

				{showcase && (
					<div class="pf-hero__showcase">
						<ProfileShowcase showcase={showcase} autoplay={!reduced} mediaRef={video} />
						{canEdit && (
							<span class="pf-hero__imgslot pf-hero__imgslot--showcase">
								<Tooltip content="Change showcase image" placement="left">
									<button
										type="button"
										class="pf-hero__imgbtn"
										aria-label="Change showcase image"
										onClick={() => choose("showcase")}
									>
										<Icon name="image" size="xs" />
									</button>
								</Tooltip>
							</span>
						)}
					</div>
				)}
			</header>

			{!canEdit && <ProfileMessagePopover profile={profile} />}
			<AssetPicker requesterId={PICKER_ID} onPick={apply} />
		</>
	);
}
