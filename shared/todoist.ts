import { parseCsv } from './csv.ts';
import { parseQuickAdd } from './quick-add.ts';
import { nextSiblingOrder } from './subtasks.ts';
import {
	DEFAULT_PRIORITY,
	toDateKey,
	toTimeOfDay,
	type DateKey,
	type Due,
	type Label,
	type Priority,
	type Project,
	type Recurrence,
	type Reminder,
	type Task,
} from './task.ts';

/** One file from a Todoist backup zip, with its path inside the zip. */
export type BackupFile = { name: string; text: string };

export type BackupProject = { sourceKey: string; name: string; inbox: boolean };

export type BackupTask = Pick<Task, 'title' | 'notes' | 'due' | 'recurrence' | 'priority' | 'reminders'> & {
	sourceKey: string;
	/** The source key of the task one indent up, for a subtask. */
	parentKey: string | null;
	projectKey: string;
	labels: string[];
};

/** What a backup holds, read without touching the store. */
export type TodoistBackup = { projects: BackupProject[]; tasks: BackupTask[]; warnings: string[] };

export type ImportState = { tasks: Task[]; projects: Project[]; labels: Label[] };

export type ImportSummary = { projects: number; labels: number; tasks: number; skipped: number; warnings: string[] };

/** `Long Term [6Crcv8Fq].csv`: the project name, then its Todoist id. */
const FILE_NAME = /^(?<name>.+?) \[(?<id>[^\]]+)\]\.csv$/i;
/** Todoist writes a task's labels into its content as `@name`. */
const LABEL = /(?<!\S)@([\p{L}\p{N}_-]+)(?!\S)/gu;
const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

type Timing = { due: Due; recurrence: Recurrence | null };

/** A Todoist date string, read by the quick add parser, which must account for all of it. */
export function readTodoistDate(text: string, now: Date): Timing | null {
	const iso = ISO.exec(text);
	if (iso) {
		if (!iso[2]) return { due: { date: iso[1] as DateKey, time: null }, recurrence: null };
		const at = new Date(iso[4] ? text : `${iso[1]}T${iso[2]}:${iso[3]}`);
		if (Number.isNaN(at.getTime())) return null;
		return { due: { date: toDateKey(at), time: toTimeOfDay(at.getHours(), at.getMinutes()) }, recurrence: null };
	}
	const parsed = parseQuickAdd(text, { now });
	const whole = parsed.title === '' && parsed.priority === null && parsed.reminders.length === 0;
	return whole && parsed.due ? { due: parsed.due, recurrence: parsed.recurrence } : null;
}

function splitLabels(content: string): { title: string; labels: string[] } {
	const labels = [...content.matchAll(LABEL)].map(m => m[1]!);
	if (labels.length === 0) return { title: content, labels };
	const title = content
		.replaceAll(LABEL, '')
		.replaceAll(/[ \t]+/g, ' ')
		.trim();
	const unique = new Map(labels.map(name => [name.toLowerCase(), name]));
	return { title: title || content, labels: [...unique.values()] };
}

function readPriority(text: string): Priority {
	const level = Number(text);
	return level === 1 || level === 2 || level === 3 || level === 4 ? level : DEFAULT_PRIORITY;
}

type Draft = { task: Omit<BackupTask, 'notes'>; notes: string[]; extras: string[] };

function readProject(file: BackupFile, now: Date, backup: TodoistBackup) {
	const base = file.name.split('/').pop()!;
	const named = FILE_NAME.exec(base)?.groups;
	const name = named?.name ?? base.replace(/\.csv$/i, '');
	const id = named?.id ?? name;
	const [header = [], ...rows] = parseCsv(file.text);
	const columns = new Map(header.map((column, i) => [column.trim(), i]));
	if (!columns.has('TYPE') || !columns.has('CONTENT')) {
		backup.warnings.push(`${base} is not a Todoist project file, skipped`);
		return;
	}
	const get = (row: string[], column: string) => row[columns.get(column) ?? -1]?.trim() ?? '';
	const warn = (message: string) => backup.warnings.push(`${name}: ${message}`);
	const projectKey = `todoist:project:${id}`;
	backup.projects.push({ sourceKey: projectKey, name, inbox: name === 'Inbox' });

	const drafts: Draft[] = [];
	const sections: string[] = [];
	const ancestors: Array<{ indent: number; content: string; sourceKey: string }> = [];
	const seen = new Map<string, number>();

	const readTask = (row: string[], content: string): Draft => {
		const indent = Math.max(1, Number.parseInt(get(row, 'INDENT'), 10) || 1);
		while (ancestors.length > 0 && ancestors.at(-1)!.indent >= indent) ancestors.pop();
		const parentKey = ancestors.at(-1)?.sourceKey ?? null;
		const path = [...ancestors.map(a => a.content), content].join(' › ');
		const occurrence = (seen.get(path) ?? 0) + 1;
		seen.set(path, occurrence);
		const sourceKey = `todoist:task:${id}:${path}${occurrence > 1 ? `#${occurrence}` : ''}`;
		ancestors.push({ indent, content, sourceKey });

		const { title, labels } = splitLabels(content);
		const extras: string[] = [];
		let timing: Timing | null = null;
		const dateText = get(row, 'DATE');
		const lang = get(row, 'DATE_LANG');
		if (dateText) {
			timing = !lang || lang === 'en' ? readTodoistDate(dateText, now) : null;
			if (!timing) {
				extras.push(`Todoist date: ${dateText}`);
				warn(`could not read the date "${dateText}" on "${title}", kept it in notes`);
			}
		}
		const duration = get(row, 'DURATION');
		if (duration)
			extras.push(`Duration: ${duration} ${get(row, 'DURATION_UNIT') || 'minute'}${duration === '1' ? '' : 's'}`);
		const deadline = get(row, 'DEADLINE');
		if (deadline) extras.push(`Deadline: ${deadline}`);
		return {
			task: {
				sourceKey,
				parentKey,
				projectKey,
				title,
				labels,
				due: timing?.due ?? null,
				recurrence: timing?.recurrence ?? null,
				priority: readPriority(get(row, 'PRIORITY')),
				reminders: [],
			},
			notes: [get(row, 'DESCRIPTION')],
			extras,
		};
	};

	const readReminder = (row: string[]): Reminder | null => {
		const type = get(row, 'REMINDER_TYPE');
		if (type === 'relative') {
			const minutes = Number(get(row, 'REMINDER_OFFSET'));
			return Number.isInteger(minutes) && minutes >= 0 ? { kind: 'before', minutes } : null;
		}
		if (type === 'absolute') {
			const at = readTodoistDate(get(row, 'REMINDER_DATE'), now)?.due;
			return at?.time ? { kind: 'at', date: at.date, time: at.time } : null;
		}
		return null;
	};

	for (const row of rows) {
		const type = get(row, 'TYPE');
		const content = get(row, 'CONTENT');
		const current = drafts.at(-1);
		switch (type) {
			case '':
			case 'meta':
				break;
			case 'section':
				sections.push(content);
				break;
			case 'task':
				drafts.push(readTask(row, content));
				break;
			case 'note':
				if (current) current.notes.push(content);
				else warn(`skipped a comment with no task above it`);
				break;
			case 'reminder': {
				const reminder = readReminder(row);
				if (current && reminder) current.task.reminders.push(reminder);
				else if (current) {
					const text = [get(row, 'REMINDER_TYPE'), get(row, 'REMINDER_OFFSET'), get(row, 'REMINDER_DATE')]
						.filter(Boolean)
						.join(' ');
					current.extras.push(`Todoist reminder: ${text}`);
					warn(`could not read a reminder on "${current.task.title}", kept it in notes`);
				} else warn(`skipped a reminder with no task above it`);
				break;
			}
			default:
				warn(`skipped a row of unknown type "${type}"`);
		}
	}

	if (sections.length > 0) warn(`sections are not imported: ${sections.join(', ')}`);
	for (const { task, notes, extras } of drafts) {
		backup.tasks.push({ ...task, notes: [...notes, ...extras].filter(Boolean).join('\n\n') });
	}
}

/** Reads every project CSV in a Todoist backup. Other files, such as macOS metadata, are ignored. */
export function readTodoistBackup(files: readonly BackupFile[], now: Date): TodoistBackup {
	const backup: TodoistBackup = { projects: [], tasks: [], warnings: [] };
	for (const file of files) {
		const base = file.name.split('/').pop()!;
		if (!/\.csv$/i.test(base) || base.startsWith('.') || file.name.includes('__MACOSX/')) continue;
		readProject(file, now, backup);
	}
	return backup;
}

/**
 * Adds a backup's projects, labels, and tasks to the store's state. A task whose source key is already
 * stored is skipped, so importing the same backup twice changes nothing. A project matches by source key,
 * then by name, and Inbox maps to our Inbox. Labels match by name, ignoring case. A subtask lands as its
 * parent's last subtask, in the parent's project, so adding rows in source order reproduces Todoist's outline.
 */
export function mergeBackup(
	state: ImportState,
	backup: TodoistBackup,
	{ newId, now }: { newId: () => string; now: number },
): { state: ImportState; summary: ImportSummary } {
	const projects = [...state.projects];
	const labels = [...state.labels];
	const tasks = [...state.tasks];
	const summary: ImportSummary = { projects: 0, labels: 0, tasks: 0, skipped: 0, warnings: backup.warnings };
	const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

	const projectIds = new Map<string, string | null>();
	for (const source of backup.projects) {
		if (source.inbox) {
			projectIds.set(source.sourceKey, null);
			continue;
		}
		const index = projects.findIndex(p => p.sourceKey === source.sourceKey);
		const match = index === -1 ? projects.findIndex(p => !p.sourceKey && sameName(p.name, source.name)) : index;
		if (match !== -1) {
			projects[match] = { ...projects[match]!, sourceKey: source.sourceKey };
			projectIds.set(source.sourceKey, projects[match]!.id);
			continue;
		}
		const project: Project = { id: newId(), name: source.name, createdAt: now, sourceKey: source.sourceKey };
		projects.push(project);
		projectIds.set(source.sourceKey, project.id);
		summary.projects++;
	}

	const labelId = (name: string) => {
		const existing = labels.find(l => sameName(l.name, name));
		if (existing) return existing.id;
		const label: Label = { id: newId(), name, createdAt: now };
		labels.push(label);
		summary.labels++;
		return label.id;
	};

	const imported = new Map(tasks.flatMap(t => (t.sourceKey ? [[t.sourceKey, t] as const] : [])));
	for (const [i, source] of backup.tasks.entries()) {
		if (imported.has(source.sourceKey)) {
			summary.skipped++;
			continue;
		}
		const parent = source.parentKey ? imported.get(source.parentKey) : undefined;
		const task: Task = {
			id: newId(),
			parentId: parent?.id ?? null,
			order: parent ? nextSiblingOrder(tasks, parent.id) : 0,
			title: source.title,
			notes: source.notes,
			projectId: parent ? parent.projectId : (projectIds.get(source.projectKey) ?? null),
			labelIds: source.labels.map(labelId),
			due: source.due,
			recurrence: source.recurrence,
			priority: source.priority,
			reminders: source.reminders,
			// Views order equal priorities by creation, so each task is a millisecond apart to keep Todoist's order.
			createdAt: now + i,
			completedAt: null,
			sourceKey: source.sourceKey,
		};
		tasks.push(task);
		imported.set(task.sourceKey!, task);
		summary.tasks++;
	}
	return { state: { tasks, projects, labels }, summary };
}
