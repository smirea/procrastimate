<script lang="ts">
	import File from 'phosphor-svelte/lib/File';
	import FileArchive from 'phosphor-svelte/lib/FileArchive';
	import FileAudio from 'phosphor-svelte/lib/FileAudio';
	import FileCode from 'phosphor-svelte/lib/FileCode';
	import FileDoc from 'phosphor-svelte/lib/FileDoc';
	import FileImage from 'phosphor-svelte/lib/FileImage';
	import FilePdf from 'phosphor-svelte/lib/FilePdf';
	import FilePpt from 'phosphor-svelte/lib/FilePpt';
	import FileText from 'phosphor-svelte/lib/FileText';
	import FileVideo from 'phosphor-svelte/lib/FileVideo';
	import FileXls from 'phosphor-svelte/lib/FileXls';
	import { FILE_KIND_COLORS, fileKind, type FileKind } from 'shared/images.ts';

	let { name, type, size = 24 }: { name: string; type: string; size?: number } = $props();

	const ICONS = {
		pdf: FilePdf,
		document: FileDoc,
		spreadsheet: FileXls,
		presentation: FilePpt,
		archive: FileArchive,
		audio: FileAudio,
		video: FileVideo,
		image: FileImage,
		code: FileCode,
		text: FileText,
		other: File,
	} satisfies Record<FileKind, unknown>;

	const kind = $derived(fileKind({ name, type }));
	const Icon = $derived(ICONS[kind]);
</script>

<span class="grid shrink-0 place-items-center" style:color={`var(--label-${FILE_KIND_COLORS[kind]})`} data-kind={kind}>
	<Icon {size} weight="duotone" />
</span>
