import type * as THREE from "three";
import type { ThreeRuntime } from "../../../core/three-loader.ts";

/**
 * model-animation — plays one of the file's animation clips at a time on an `AnimationMixer`, with
 * pause, speed and scrubbing. The canvas calls {@link Animator.advance} from its frame loop.
 */

/** Drives the model's animation clips. */
export interface Animator {
	/** Select a clip by index (`null` stops and rests the model in its bind pose). */
	select(index: number | null): void;
	setPlaying(playing: boolean): void;
	setSpeed(speed: number): void;
	seek(seconds: number): void;
	/** Step the mixer; returns whether another frame is needed. */
	advance(deltaSeconds: number): boolean;
	time(): number;
	duration(): number;
	dispose(): void;
}

/** Bind the clips to the model root. */
export function createAnimator(
	rt: ThreeRuntime,
	root: THREE.Object3D,
	clips: readonly THREE.AnimationClip[],
): Animator {
	const mixer = new rt.THREE.AnimationMixer(root);
	let action: THREE.AnimationAction | null = null;
	let playing = false;

	return {
		select(index: number | null): void {
			mixer.stopAllAction();
			action = null;
			const clip = index === null ? undefined : clips[index];
			if (!clip) {
				mixer.setTime(0);
				return;
			}
			action = mixer.clipAction(clip);
			action.reset();
			action.paused = !playing;
			action.play();
			mixer.update(0);
		},
		setPlaying(next: boolean): void {
			playing = next;
			if (action) action.paused = !next;
		},
		setSpeed(speed: number): void {
			mixer.timeScale = speed;
		},
		seek(seconds: number): void {
			if (!action) return;
			const span = action.getClip().duration;
			action.time = Math.max(0, Math.min(span, seconds));
			mixer.update(0);
		},
		advance(deltaSeconds: number): boolean {
			if (!action || !playing) return false;
			mixer.update(deltaSeconds);
			return true;
		},
		time(): number {
			return action ? action.time : 0;
		},
		duration(): number {
			return action ? action.getClip().duration : 0;
		},
		dispose(): void {
			mixer.stopAllAction();
			for (const clip of clips) mixer.uncacheClip(clip);
			mixer.uncacheRoot(root);
		},
	};
}
