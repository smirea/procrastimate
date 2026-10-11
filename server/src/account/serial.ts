/**
 * One user's Turso load and flush must not overlap. The Durable Object yields while libSQL is in flight, and the
 * Bun server is concurrent, so each user gets a queue: the next piece of work starts only after the previous one
 * has flushed. A rejection does not jam the queue.
 */
export function serialQueue() {
	let tail: Promise<unknown> = Promise.resolve();
	return function run<T>(task: () => Promise<T>): Promise<T> {
		const result = tail.then(task, task);
		tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};
}
