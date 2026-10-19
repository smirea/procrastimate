declare module 'virtual:database-worker' {
	/** Every file of the built database worker, as absolute paths; empty outside the service worker's build. */
	const files: string[];
	export default files;
}
