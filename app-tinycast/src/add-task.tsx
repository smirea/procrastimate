import { showHUD, showToast, Toast, type LaunchProps } from '@raycast/api';
import { agentClient, showFailure } from './api.ts';
import { addedMessage } from './format.ts';

export default async function AddTask(props: LaunchProps<{ arguments: { text: string } }>) {
	const text = props.arguments.text.trim();
	if (!text) return;
	const toast = await showToast({ style: Toast.Style.Animated, title: 'Adding task…' });
	try {
		const task = await agentClient().tasks.create({ query: {}, body: { text } });
		await toast.hide();
		await showHUD(addedMessage(task));
	} catch (error) {
		await showFailure(error, 'Could not add the task');
	}
}
