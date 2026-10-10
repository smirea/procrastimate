/**
 * Rows of an RFC 4180 CSV document. Quoted fields hold commas, doubled quotes, and line breaks. Line
 * endings become `\n`, inside fields too, and a leading byte order mark is dropped.
 */
export function parseCsv(text: string): string[][] {
	const input = text.replace(/^\uFEFF/, '').replaceAll(/\r\n?/g, '\n');
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < input.length; i++) {
		const char = input[i]!;
		if (quoted) {
			if (char !== '"') field += char;
			else if (input[i + 1] === '"') {
				field += '"';
				i++;
			} else quoted = false;
		} else if (char === '"' && field === '') quoted = true;
		else if (char === ',') {
			row.push(field);
			field = '';
		} else if (char === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += char;
	}
	if (field !== '' || row.length > 0) rows.push([...row, field]);
	return rows;
}
