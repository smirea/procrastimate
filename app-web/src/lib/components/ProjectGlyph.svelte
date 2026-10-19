<script lang="ts">
	import type { IconComponentProps } from 'phosphor-svelte';
	import type { Project } from 'shared/model.ts';
	import { projectIcon } from '../project-icon.ts';

	let { project, ...rest }: { project: Pick<Project, 'icon'> | null | undefined } & IconComponentProps = $props();

	const Icon = $derived(projectIcon(project));
</script>

<Icon data-icon={project?.icon ?? 'none'} aria-hidden="true" {...rest} />
