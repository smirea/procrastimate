import { expect, test } from 'bun:test';
import { parseCsv } from './csv.ts';

test('drops a byte order mark before the header', () => {
	expect(parseCsv('\uFEFFTYPE,CONTENT\ntask,Milk\n')).toEqual([
		['TYPE', 'CONTENT'],
		['task', 'Milk'],
	]);
});

test('keeps commas, doubled quotes, and line breaks inside quoted fields', () => {
	expect(parseCsv('task,"Buy eggs, milk","Say ""hi""\nthen leave"\n')).toEqual([
		['task', 'Buy eggs, milk', 'Say "hi"\nthen leave'],
	]);
});

test('reads CRLF line endings, empty fields, and a last row without a newline', () => {
	expect(parseCsv('a,,c\r\n,,\r\n"x\r\ny",z')).toEqual([
		['a', '', 'c'],
		['', '', ''],
		['x\ny', 'z'],
	]);
});

test('a quote inside an unquoted field is literal', () => {
	expect(parseCsv('say 5" nails,ok')).toEqual([['say 5" nails', 'ok']]);
});
