import { describe, expect, test } from 'bun:test';
import type { RambleTask } from 'shared/ramble.ts';
import type { RambleOutline } from 'shared/ramble/outline.ts';
import { Outliner, smartTasks } from './outliner.ts';

const outlineOf = (transcript: string): RambleOutline => ({
	tasks: [{ title: transcript, when: '', reminder: '', priority: 0, project: '', labels: [], notes: '', subtasks: [] }],
});

/** A fake Gemini whose answers the test releases by hand. */
function fakeServer() {
	const calls: Array<{ transcript: string; signal: AbortSignal; answer: (ok?: boolean) => void }> = [];
	const request = (transcript: string, signal: AbortSignal) =>
		new Promise<RambleOutline>((resolve, reject) => {
			calls.push({
				transcript,
				signal,
				answer: (ok = true) => (ok ? resolve(outlineOf(transcript)) : reject(new Error('502'))),
			});
		});
	return { calls, request };
}

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

describe('Outliner', () => {
	test('sends once the words settle, one request at a time, then the newest transcript', async () => {
		const server = fakeServer();
		const seen: string[] = [];
		const outliner = new Outliner(server.request, outlined => seen.push(outlined.transcript), 5);
		outliner.update('buy');
		outliner.update('buy milk');
		await tick(10);
		expect(server.calls.map(call => call.transcript)).toEqual(['buy milk']);
		outliner.update('buy milk and');
		outliner.update('buy milk and eggs');
		await tick(10);
		expect(server.calls).toHaveLength(1);
		server.calls[0]!.answer();
		await tick();
		expect(seen).toEqual(['buy milk']);
		expect(server.calls.map(call => call.transcript)).toEqual(['buy milk', 'buy milk and eggs']);
	});

	test('stopping on a transcript already outlined answers at once', async () => {
		const server = fakeServer();
		const outliner = new Outliner(server.request, () => {}, 1);
		outliner.update('call mom');
		await tick(5);
		server.calls[0]!.answer();
		await tick();
		expect(await outliner.settle('call mom', 1000)).toEqual(outlineOf('call mom'));
		expect(server.calls).toHaveLength(1);
	});

	test('stopping on newer words aborts the stale request and asks for the final transcript', async () => {
		const server = fakeServer();
		const outliner = new Outliner(server.request, () => {}, 1);
		outliner.update('call mom');
		await tick(5);
		const settled = outliner.settle('call mom tomorrow', 1000);
		expect(server.calls[0]!.signal.aborted).toBe(true);
		expect(server.calls[1]!.transcript).toBe('call mom tomorrow');
		server.calls[1]!.answer();
		expect(await settled).toEqual(outlineOf('call mom tomorrow'));
	});

	test('a failure turns it off for the session, and a slow answer times out to null', async () => {
		const server = fakeServer();
		const outliner = new Outliner(server.request, () => {}, 1);
		const slow = outliner.settle('pay rent', 5);
		expect(await slow).toBe(null);
		server.calls[0]!.answer(false);
		await tick();
		expect(outliner.off).toBe(true);
		outliner.update('pay rent friday');
		await tick(5);
		expect(server.calls).toHaveLength(1);
		expect(await outliner.settle('pay rent friday', 5)).toBe(null);
	});
});

describe('smartTasks', () => {
	const task = (title: string) => ({ title }) as RambleTask;
	const parse = (text: string) => [task(`grammar:${text.trim()}`)];
	const resolve = (outline: RambleOutline) => outline.tasks.map(t => task(`outline:${t.title}`));

	test('the outline, then the grammar for the words after it', () => {
		const latest = { transcript: 'call mom', outline: outlineOf('call mom') };
		expect(smartTasks('call mom. buy milk', latest, parse, resolve).map(t => t.title)).toEqual([
			'outline:call mom',
			'grammar:. buy milk',
		]);
		expect(smartTasks('call mom', latest, parse, resolve).map(t => t.title)).toEqual(['outline:call mom']);
		expect(smartTasks('call my mom', latest, parse, resolve).map(t => t.title)).toEqual(['outline:call mom']);
		expect(smartTasks('call mom', null, parse, resolve).map(t => t.title)).toEqual(['grammar:call mom']);
	});
});
