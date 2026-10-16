import { expect, test } from 'bun:test';
import { staleCitations } from './feature-map-citations';

test('every test, spec, and screenshot the feature maps cite exists', () => {
	const stale = staleCitations().map(({ map, line, cited, reason }) => `${map}:${line} \`${cited}\`: ${reason}`);
	if (stale.length)
		console.error(
			[
				'The feature maps cite tests that do not exist. For each line below, point the citation at the real test',
				'(exact title, file under app-web/e2e, or Swift test in app-ios/Tests), write the missing test, or delete the',
				'citation and leave the step as a manual recipe. Rerun with `bun scripts/feature-map-citations.ts`.',
				...stale,
			].join('\n'),
		);
	expect(stale).toEqual([]);
});
