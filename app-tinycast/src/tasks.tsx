import {
	Action,
	ActionPanel,
	Alert,
	Cache,
	Color,
	confirmAlert,
	Icon,
	List,
	open,
	openExtensionPreferences,
	showToast,
	Toast,
	type Image,
} from '@raycast/api';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { completedToast, dayHeading, postponeOptions, reopenedToast } from 'shared/format.ts';
import { parseQuickAdd } from 'shared/quick-add.ts';
import { search } from 'shared/search.ts';
import { descendantsOf } from 'shared/subtasks.ts';
import type { AgentTask, SpaceView } from 'shared/sharing.ts';
import { projectsInOrder, type TaskPatch } from 'shared/store.ts';
import { toDateKey, toTimeOfDay, type DateKey, type Due, type Priority, type Task } from 'shared/task.ts';
import { dueDays, inboxTasks, labelViewTasks, projectGroups, todayTasks, type DueDays } from 'shared/views.ts';
import { agentClient, failureOf, showFailure, webUrl, type Failure } from './api.ts';
import {
	addedMessage,
	dueColor,
	firstLink,
	LABEL_TINTS,
	plainTitle,
	PRIORITY_TINTS,
	todayKey,
	whenText,
} from './format.ts';

type ListId = 'today' | 'inbox' | 'tomorrow' | 'this-week' | 'no-date' | `project:${string}` | `label:${string}`;
type Group = { title: string; tasks: readonly Task[] };

const LISTS: { id: ListId; title: string; icon: Image.ImageLike }[] = [
	{ id: 'today', title: 'Today', icon: Icon.Calendar },
	{ id: 'inbox', title: 'Inbox', icon: Icon.Tray },
	{ id: 'tomorrow', title: 'Tomorrow', icon: Icon.Sunrise },
	{ id: 'this-week', title: 'This week', icon: Icon.Clock },
	{ id: 'no-date', title: 'No date', icon: Icon.CircleEllipsis },
];

/** The last view, shown at once on launch while the fresh one loads, so the list never opens empty. */
const cache = new Cache();
const VIEW_KEY = 'view';

function cachedView(): SpaceView | null {
	const raw = cache.get(VIEW_KEY);
	return raw ? (JSON.parse(raw) as SpaceView) : null;
}

function dayGroups(days: DueDays, today: DateKey): Group[] {
	return [
		{ title: 'Overdue', tasks: days.overdue },
		{ title: 'Today', tasks: days.today },
		...days.days.map(day => ({ title: dayHeading(day.date, today), tasks: day.tasks })),
	];
}

function groupsOf(list: ListId, view: SpaceView, today: DateKey): Group[] {
	const tasks = view.tasks;
	if (list.startsWith('project:')) {
		const id = list.slice('project:'.length);
		return projectGroups(tasks, view.sections, id).map(group => ({
			title: group.section?.name ?? '',
			tasks: group.tasks,
		}));
	}
	if (list.startsWith('label:')) {
		const label = view.labels.find(l => `label:${l.id}` === list);
		return label ? [{ title: '', tasks: labelViewTasks(tasks, label) }] : [];
	}
	switch (list) {
		case 'today': {
			const { overdue, today: due } = todayTasks(tasks, today);
			return [
				{ title: 'Overdue', tasks: overdue },
				{ title: 'Today', tasks: due },
			];
		}
		case 'inbox':
			return [
				...dayGroups(dueDays(tasks, today, 'inbox'), today),
				{ title: 'No date', tasks: inboxTasks(tasks, today) },
			];
		case 'tomorrow':
		case 'this-week':
			return dayGroups(dueDays(tasks, today, list), today);
		case 'no-date':
			return [{ title: '', tasks: inboxTasks(tasks, today) }];
		default:
			return [];
	}
}

/** What a new task gets from the list it is typed into, as quick add's list defaults do in the app. */
function listDefaults(list: ListId, today: DateKey): { projectId?: string; labelIds?: string[]; due?: Due } {
	if (list.startsWith('project:')) return { projectId: list.slice('project:'.length) };
	if (list.startsWith('label:')) return { labelIds: [list.slice('label:'.length)] };
	if (list === 'today') return { due: { date: today, time: null } };
	if (list === 'tomorrow') {
		const date = new Date();
		date.setDate(date.getDate() + 1);
		return { due: { date: toDateKey(date), time: null } };
	}
	return {};
}

export default function Tasks() {
	const [view, setView] = useState<SpaceView | null>(cachedView);
	const [loading, setLoading] = useState(true);
	/** Why the last load failed, so an empty list says so instead of `All clear`. */
	const [loadFailure, setLoadFailure] = useState<Failure | null>(null);
	const [list, setList] = useState<ListId>('today');
	const [query, setQuery] = useState('');
	const today = todayKey();

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const fresh = await agentClient().view({ query: {} });
			cache.set(VIEW_KEY, JSON.stringify(fresh));
			setView(fresh);
			setLoadFailure(null);
		} catch (error) {
			setLoadFailure(failureOf(error, 'Could not load your tasks'));
			await showFailure(error, 'Could not load your tasks');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	/**
	 * Shows the change at once, then keeps the server's copy of the task, or reloads when the server refused it.
	 * Completing, reopening, and deleting also change subtasks on the server, which answers with the task alone, so
	 * those reload the view (`subtree`) instead.
	 */
	const change = useCallback(
		async (
			local: (tasks: AgentTask[]) => AgentTask[],
			request: () => Promise<AgentTask | 'subtree'>,
			failure: string,
		) => {
			setView(current => current && { ...current, tasks: local(current.tasks) });
			try {
				const saved = await request();
				if (saved === 'subtree') await reload();
				else setView(current => current && { ...current, tasks: replace(current.tasks, saved) });
			} catch (error) {
				await showFailure(error, failure);
				await reload();
			}
		},
		[reload],
	);

	const projects = useMemo(() => (view ? projectsInOrder(view.projects) : []), [view]);
	const projectName = useMemo(() => new Map(view?.projects.map(p => [p.id, p.name])), [view]);
	const readOnly = useMemo(() => new Set(view?.readOnly), [view]);

	const trimmed = query.trim();
	const draft = useMemo(() => {
		if (!view || !trimmed) return null;
		const defaults = listDefaults(list, today);
		return parseQuickAdd(trimmed, {
			now: new Date(),
			projects: view.projects,
			sections: view.sections,
			labels: view.labels,
			projectId: defaults.projectId ?? null,
			due: defaults.due ?? null,
		});
	}, [view, trimmed, list, today]);

	const groups: Group[] = useMemo(() => {
		if (!view) return [];
		if (!trimmed) return groupsOf(list, view, today);
		const hits = search(trimmed, view.tasks, { projects: view.projects, labels: view.labels });
		return [{ title: 'Matching tasks', tasks: hits.open.map(hit => hit.task) }];
	}, [view, trimmed, list, today]);

	async function add() {
		if (!draft || !view) return;
		const defaults = listDefaults(list, today);
		const toast = await showToast({ style: Toast.Style.Animated, title: 'Adding task…' });
		try {
			const api = agentClient();
			let task = await api.tasks.create({
				query: {},
				body: {
					text: trimmed,
					// Explicit fields win over parsed ones, so the list's own project and label go only where the text named none.
					...(defaults.projectId && !draft.projectId ? { projectId: defaults.projectId } : {}),
					...(defaults.labelIds ? { labelIds: [...new Set([...draft.labelIds, ...defaults.labelIds])] } : {}),
				},
			});
			// The create route takes no list date, so the server reads `5pm` or `every week` from today. The preview read
			// them from the list's day, as the app's quick add does, so its date and repeat are the ones to keep.
			const scheduled = {
				due: draft.due ?? (draft.recurrence ? null : (defaults.due ?? null)),
				recurrence: draft.recurrence,
			};
			if (!task.event && JSON.stringify(scheduled) !== JSON.stringify({ due: task.due, recurrence: task.recurrence }))
				task = await api.tasks.update({ query: { id: task.id }, body: scheduled });
			setView(current => current && { ...current, tasks: [...current.tasks, task] });
			setQuery('');
			toast.style = Toast.Style.Success;
			toast.title = addedMessage(task);
		} catch (error) {
			await toast.hide();
			await showFailure(error, 'Could not add the task');
		}
	}

	function complete(task: Task) {
		void change(
			tasks => tasks.map(t => (t.id === task.id && !t.recurrence ? { ...t, completedAt: Date.now() } : t)),
			async () => {
				const saved = await agentClient().tasks.complete({ query: { id: task.id } });
				// A recurring task rolls to its next date instead of closing, and reopening would not move it back.
				const rolled = saved.completedAt === null ? saved.due : null;
				await showToast({
					style: Toast.Style.Success,
					title: completedToast(plainTitle(task.title), rolled, today),
					primaryAction: rolled ? undefined : { title: 'Undo', onAction: () => reopen(task) },
				});
				return 'subtree';
			},
			'Could not complete the task',
		);
	}

	function reopen(task: Task) {
		void change(
			tasks => tasks.map(t => (t.id === task.id ? { ...t, completedAt: null } : t)),
			async () => {
				await agentClient().tasks.reopen({ query: { id: task.id } });
				await showToast({ style: Toast.Style.Success, title: reopenedToast(plainTitle(task.title)) });
				return 'subtree';
			},
			'Could not reopen the task',
		);
	}

	function edit(task: Task, patch: TaskPatch, done: string) {
		void change(
			tasks => tasks.map(t => (t.id === task.id ? { ...t, ...patch } : t)),
			async () => {
				const saved = await agentClient().tasks.update({ query: { id: task.id }, body: patch });
				await showToast({ style: Toast.Style.Success, title: done });
				return saved;
			},
			'Could not change the task',
		);
	}

	function setDate(task: Task, date: DateKey | null, time = task.due?.time ?? null) {
		const due = date ? { date, time } : null;
		edit(
			task,
			{ due },
			due
				? `Moved “${plainTitle(task.title)}” to ${whenText({ due, recurrence: null }, today)}`
				: `Cleared the date of “${plainTitle(task.title)}”`,
		);
	}

	async function remove(task: Task) {
		const confirmed = await confirmAlert({
			title: `Delete “${plainTitle(task.title)}”?`,
			message: 'Its subtasks go too.',
			primaryAction: { title: 'Delete', style: Alert.ActionStyle.Destructive },
		});
		if (!confirmed) return;
		void change(
			tasks => {
				const gone = new Set([task.id, ...descendantsOf(tasks, task.id).map(t => t.id)]);
				return tasks.filter(t => !gone.has(t.id));
			},
			async () => {
				await agentClient().tasks.delete({ query: { id: task.id } });
				await showToast({ style: Toast.Style.Success, title: `Deleted “${plainTitle(task.title)}”` });
				return 'subtree';
			},
			'Could not delete the task',
		);
	}

	const listPicker = (
		<List.Dropdown tooltip='List' onChange={value => setList(value as ListId)} storeValue>
			<List.Dropdown.Section>
				{LISTS.map(entry => (
					<List.Dropdown.Item key={entry.id} value={entry.id} title={entry.title} icon={entry.icon} />
				))}
			</List.Dropdown.Section>
			<List.Dropdown.Section title='Projects'>
				{projects.map(project => (
					<List.Dropdown.Item
						key={project.id}
						value={`project:${project.id}`}
						title={project.name}
						icon={Icon.Hashtag}
					/>
				))}
			</List.Dropdown.Section>
			<List.Dropdown.Section title='Labels'>
				{view?.labels
					.filter(label => label.place === null)
					.toSorted((a, b) => a.name.localeCompare(b.name))
					.map(label => (
						<List.Dropdown.Item
							key={label.id}
							value={`label:${label.id}`}
							title={label.name}
							icon={{ source: Icon.Tag, tintColor: LABEL_TINTS[label.color] }}
						/>
					))}
			</List.Dropdown.Section>
		</List.Dropdown>
	);

	const refresh = (
		<Action
			title='Refresh'
			icon={Icon.ArrowClockwise}
			shortcut={{ modifiers: ['cmd'], key: 'r' }}
			onAction={() => void reload()}
		/>
	);

	return (
		<List
			isLoading={loading}
			filtering={false}
			searchText={query}
			onSearchTextChange={setQuery}
			searchBarPlaceholder='Search, or type a task: Call the plumber tomorrow 5pm #Home p1'
			searchBarAccessory={listPicker}
		>
			{draft && draft.title && (
				<List.Section title='New task'>
					<List.Item
						icon={{ source: Icon.PlusCircle, tintColor: Color.Blue }}
						title={plainTitle(draft.title)}
						subtitle={draft.projectId ? projectName.get(draft.projectId) : undefined}
						accessories={[
							...(draft.priority && draft.priority < 4
								? [{ icon: { source: Icon.Flag, tintColor: PRIORITY_TINTS[draft.priority] } }]
								: []),
							{ text: whenText({ due: draft.due, recurrence: draft.recurrence }, today) ?? 'No date' },
						]}
						actions={
							<ActionPanel>
								<Action title='Add Task' icon={Icon.Plus} onAction={() => void add()} />
								{refresh}
							</ActionPanel>
						}
					/>
				</List.Section>
			)}
			{groups.map((group, index) => (
				<List.Section key={`${group.title}-${index}`} title={group.title} subtitle={countOf(group.tasks)}>
					{group.tasks.map(task => (
						<TaskItem
							key={task.id}
							task={task}
							today={today}
							project={list.startsWith('project:') ? undefined : projectName.get(task.projectId ?? '')}
							labels={view?.labels ?? []}
							editable={!readOnly.has(task.id)}
							onComplete={() => complete(task)}
							onDate={(date, time) => setDate(task, date, time)}
							onPriority={priority =>
								edit(task, { priority }, `Set “${plainTitle(task.title)}” to priority ${priority}`)
							}
							onDelete={() => void remove(task)}
							refresh={refresh}
						/>
					))}
				</List.Section>
			))}
			{!loading &&
				groups.every(group => group.tasks.length === 0) &&
				!draft?.title &&
				(loadFailure ? (
					<List.EmptyView
						icon={Icon.ExclamationMark}
						title={loadFailure.title}
						description={loadFailure.message}
						actions={
							<ActionPanel>
								{loadFailure.refused && (
									<Action title='Open Preferences' onAction={() => void openExtensionPreferences()} />
								)}
								<Action title='Try Again' icon={Icon.ArrowClockwise} onAction={() => void reload()} />
							</ActionPanel>
						}
					/>
				) : (
					<List.EmptyView icon={Icon.CheckCircle} title={trimmed ? 'No matching tasks' : 'All clear'} />
				))}
		</List>
	);
}

function TaskItem(props: {
	task: Task;
	today: DateKey;
	project: string | undefined;
	labels: SpaceView['labels'];
	editable: boolean;
	onComplete: () => void;
	onDate: (date: DateKey | null, time?: Due['time']) => void;
	onPriority: (priority: Priority) => void;
	onDelete: () => void;
	refresh: ReactNode;
}) {
	const { task, today } = props;
	const when = whenText(task, today);
	const link = firstLink(task.title);
	const labels = props.labels.filter(label => task.labelIds.includes(label.id) && label.place === null);
	return (
		<List.Item
			icon={{ source: Icon.Circle, tintColor: PRIORITY_TINTS[task.priority] }}
			title={plainTitle(task.title)}
			subtitle={props.project}
			keywords={labels.map(label => label.name)}
			accessories={[
				...labels.map(label => ({ tag: { value: label.name, color: LABEL_TINTS[label.color] } })),
				...(when ? [{ text: { value: when, color: dueColor(task, today) } }] : []),
			]}
			actions={
				<ActionPanel>
					{props.editable && <Action title='Complete Task' icon={Icon.CheckCircle} onAction={props.onComplete} />}
					<Action
						title='Open in ProcrastiMate'
						icon={Icon.AppWindow}
						shortcut={{ modifiers: ['cmd'], key: 'o' }}
						onAction={() => void open(webUrl(`/?task=${task.id}`))}
					/>
					{props.editable && (
						<>
							{!task.event && (
								<ActionPanel.Submenu title='Set Date' icon={Icon.Calendar} shortcut={{ modifiers: ['cmd'], key: 'd' }}>
									{postponeOptions(task.due, today).map(option => (
										<Action key={option.date} title={option.label} onAction={() => props.onDate(option.date)} />
									))}
									<Action.PickDate
										title='Pick Date…'
										type={Action.PickDate.Type.DateTime}
										onChange={date => {
											if (!date) return;
											// Tinycast has no `isFullDay`, and a picked midnight almost always means the day alone.
											const midnight = date.getHours() === 0 && date.getMinutes() === 0;
											props.onDate(toDateKey(date), midnight ? null : toTimeOfDay(date.getHours(), date.getMinutes()));
										}}
									/>
									{task.due && !task.recurrence && (
										<Action title='No Date' icon={Icon.XMarkCircle} onAction={() => props.onDate(null)} />
									)}
								</ActionPanel.Submenu>
							)}
							<ActionPanel.Submenu title='Set Priority' icon={Icon.Flag} shortcut={{ modifiers: ['cmd'], key: 'p' }}>
								{([1, 2, 3, 4] as const).map(priority => (
									<Action
										key={priority}
										title={`Priority ${priority}`}
										icon={{ source: Icon.Flag, tintColor: PRIORITY_TINTS[priority] }}
										onAction={() => props.onPriority(priority)}
									/>
								))}
							</ActionPanel.Submenu>
						</>
					)}
					{link && <Action.OpenInBrowser title='Open Link' url={link} shortcut={{ modifiers: ['cmd'], key: 'l' }} />}
					<Action.CopyToClipboard
						title='Copy Title'
						content={plainTitle(task.title)}
						shortcut={{ modifiers: ['cmd'], key: 'c' }}
					/>
					{props.refresh}
					{props.editable && (
						<Action
							title='Delete Task'
							icon={Icon.Trash}
							style={Action.Style.Destructive}
							shortcut={{ modifiers: ['ctrl'], key: 'x' }}
							onAction={props.onDelete}
						/>
					)}
				</ActionPanel>
			}
		/>
	);
}

const countOf = (tasks: readonly Task[]) => (tasks.length ? String(tasks.length) : undefined);

function replace(tasks: AgentTask[], saved: AgentTask): AgentTask[] {
	return tasks.some(t => t.id === saved.id) ? tasks.map(t => (t.id === saved.id ? saved : t)) : [...tasks, saved];
}
