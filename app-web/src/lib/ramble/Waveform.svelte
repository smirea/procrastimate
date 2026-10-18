<script lang="ts" module>
	/** Written by the capture at audio rate and read once per frame, so a loud mic never re-renders the drawer. */
	export type LevelMeter = { level: number };
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { waveHeights } from './wave.ts';

	let { meter, active }: { meter: LevelMeter; active: boolean } = $props();

	let canvas: HTMLCanvasElement;
	/** The frame loop reads a copy, since the prop goes stale while the drawer animates out. */
	let listening = false;
	let frame = 0;
	let start = () => {};
	/** The loop stops once the bars have settled flat, and starts again when listening resumes. */
	$effect(() => {
		listening = active;
		if (active) start();
	});

	onMount(() => {
		const context = canvas.getContext('2d')!;
		const history = new Float32Array(48);
		let smoothed = 0;
		let presence = 0;
		let color = '';
		let tick = 0;

		const draw = () => {
			const ratio = devicePixelRatio || 1;
			const width = canvas.clientWidth;
			const height = canvas.clientHeight;
			if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
			if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
			if (tick++ % 30 === 0) color = getComputedStyle(canvas).color;

			const target = listening ? meter.level : 0;
			smoothed += (target - smoothed) * (target > smoothed ? 0.45 : 0.12);
			presence += ((listening ? 1 : 0) - presence) * 0.08;
			history.copyWithin(0, 1);
			history[history.length - 1] = smoothed;

			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			context.clearRect(0, 0, width, height);
			context.fillStyle = color;
			const heights = waveHeights(history, { bars: Math.min(41, Math.floor(width / 9) | 1), height, presence });
			const step = width / heights.length;
			heights.forEach(({ size, alpha }, i) => {
				context.globalAlpha = alpha;
				context.beginPath();
				context.roundRect(i * step + step / 2 - 2, (height - size) / 2, 4, size, 2);
				context.fill();
			});
			const settled = !listening && presence < 0.005 && smoothed < 0.001;
			frame = settled ? 0 : requestAnimationFrame(draw);
		};
		start = () => {
			if (!frame) frame = requestAnimationFrame(draw);
		};
		start();
		return () => {
			cancelAnimationFrame(frame);
			frame = 0;
		};
	});
</script>

<canvas bind:this={canvas} class="block h-full w-full text-accent" aria-hidden="true"></canvas>
