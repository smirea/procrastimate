import { describe, expect, test } from 'bun:test';
import { label, project, section, task } from 'shared/testing.ts';
import { emptyData, homes, merged, sharedSpace, type SharedSpace } from './spaces.ts';

const spaces: Record<string, SharedSpace> = {
	ann: {
		owner: 'ann',
		readOnly: new Set(),
		access: [],
		data: {
			...emptyData(),
			tasks: [task('shared-task', { projectId: 'groceries', createdAt: 5 })],
			projects: [project('groceries')],
			sections: [section('aisle', 'groceries')],
			labels: [label('errands')],
		},
	},
};
const own = {
	...emptyData(),
	tasks: [task('mine', { createdAt: 3 })],
	projects: [project('work')],
	sections: [section('later', 'work')],
	labels: [label('home')],
};

test('merged lists own data first and keeps tasks in creation order', () => {
	const view = merged({ ...own, tasks: [...own.tasks, task('late', { createdAt: 9 })] }, spaces);
	expect(view.tasks.map(t => t.id)).toEqual(['mine', 'shared-task', 'late']);
	expect(view.projects.map(p => p.id)).toEqual(['work', 'groceries']);
	expect(view.sections.map(s => s.id)).toEqual(['later', 'aisle']);
	expect(homes(spaces).aisle).toBe('ann');
	expect(view.labels.map(l => l.id)).toEqual(['home', 'errands']);
});

test('sharedSpace marks the tasks whose access row says view as read only', () => {
	const access = [
		{ id: 'me:task:hers', grantee: 'me', owner: 'ann', kind: 'task', entityId: 'hers', role: 'view' },
		{ id: 'me:task:ours', grantee: 'me', owner: 'ann', kind: 'task', entityId: 'ours', role: 'edit' },
		{ id: 'me:project:p', grantee: 'me', owner: 'ann', kind: 'project', entityId: 'p', role: 'view' },
	] as const;
	const space = sharedSpace('ann', { data: emptyData(), access: [...access] });
	expect([...space.readOnly]).toEqual(['hers']);
});
