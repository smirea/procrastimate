/**
 * `./sim test <file.swift>... [--only Class/test] [--keep] [--no-build] [--timeout seconds]` runs throwaway XCUITests
 * against the worktree's app. The repo has no XCUITest target by decision, so this generates a host app and a UI test
 * bundle under the git-ignored app-ios/DerivedData/uitest, which teardown removes with the worktree. Tests drive the
 * installed app through `launchApp(...)` from the generated Support.swift. AXe taps and CGEvent clicks do not reach
 * the simulator on this Mac; XCUITest does.
 */
import { spawnSync } from 'node:child_process';
import {
	closeSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Device, devices, shutdown } from './simulators';
import { run as runCommand } from './lib';

const bundle = 'com.stefan.procrastimate';

function xcodegen(): string {
	const installed = Bun.which('xcodegen');
	if (installed) return installed;
	const cache = join(homedir(), '.cache/procrastimate');
	const binary = join(cache, 'xcodegen/bin/xcodegen');
	if (existsSync(binary)) return binary;
	console.log('Downloading XcodeGen (Homebrew is blocked here)…');
	const download = join(tmpdir(), `xcodegen-${process.pid}`);
	runCommand(['gh', 'release', 'download', '--repo', 'yonaskolb/XcodeGen', '-p', 'xcodegen.zip', '-D', download]);
	runCommand(['unzip', '-q', '-o', join(download, 'xcodegen.zip'), '-d', download]);
	mkdirSync(cache, { recursive: true });
	try {
		renameSync(join(download, 'xcodegen'), join(cache, 'xcodegen'));
	} catch (error) {
		if (!existsSync(binary)) throw error;
	}
	rmSync(download, { recursive: true, force: true });
	return binary;
}

function scaffold(dir: string, files: string[]) {
	const tests = join(dir, 'UITests');
	rmSync(tests, { recursive: true, force: true });
	mkdirSync(tests, { recursive: true });
	mkdirSync(join(dir, 'Host'), { recursive: true });
	mkdirSync(join(dir, 'shots'), { recursive: true });
	for (const file of files) copyFileSync(file, join(tests, basename(file)));
	writeFileSync(
		join(dir, 'Host/App.swift'),
		'import SwiftUI\n\n@main struct HostApp: App {\n    var body: some Scene { WindowGroup { Text("host") } }\n}\n',
	);
	writeFileSync(
		join(tests, 'Support.swift'),
		`import XCTest

/// Launches the ProcrastiMate debug build that \`./sim test\` installed, signed in without a Keychain session.
/// \`demo\` is PROCRASTIMATE_DEMO, for example "seed details:Buy+oat+milk"; \`reset\` wipes the store first.
@discardableResult
func launchApp(demo: String? = nil, reset: Bool = false, environment: [String: String] = [:]) -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: "${bundle}")
    var env = ["PROCRASTIMATE_SIGNED_IN": "1"]
    if let demo { env["PROCRASTIMATE_DEMO"] = demo }
    if reset { env["PROCRASTIMATE_RESET"] = "1" }
    app.launchEnvironment = env.merging(environment) { $1 }
    app.launch()
    return app
}

/// Writes the simulator screen to app-ios/DerivedData/uitest/shots/<name>.png.
func shot(_ name: String) {
    try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "${join(dir, 'shots')}/\\(name).png"))
}
`,
	);
	const target = (type: string, sources: string, id: string, extra = '') =>
		`  ${sources}:\n    type: ${type}\n    platform: iOS\n    sources: [${sources}]\n${extra}    settings:\n      PRODUCT_BUNDLE_IDENTIFIER: ${id}\n      CODE_SIGN_IDENTITY: "-"\n      GENERATE_INFOPLIST_FILE: YES\n`;
	writeFileSync(
		join(dir, 'project.yml'),
		`name: UITest
options:
  deploymentTarget:
    iOS: "27.0"
targets:
${target('application', 'Host', 'com.stefan.procrastimate.uitest-host')}${target(
			'bundle.ui-testing',
			'UITests',
			'com.stefan.procrastimate.uitests',
			'    dependencies:\n      - target: Host\n',
		)}      TEST_TARGET_NAME: Host
schemes:
  UITests:
    build:
      targets:
        Host: all
        UITests: [test]
    test:
      targets: [UITests]
`,
	);
}

/** Streams a child to a log file and the interesting lines to stdout, killing it at the deadline. */
async function run(cmd: string[], log: string, deadline: number): Promise<number | 'timeout'> {
	const fd = openSync(log, 'w');
	const child = Bun.spawn(cmd, { stdout: 'pipe', stderr: fd });
	let timedOut = false;
	const timer = setTimeout(
		() => {
			timedOut = true;
			child.kill('SIGTERM');
		},
		Math.max(0, deadline - Date.now()),
	);
	void child.exited.then(() => clearTimeout(timer));
	const interesting = /Test Case .*(passed|failed)|error:|: error|XCTAssert|\*\* (TEST|BUILD) /;
	let pending = '';
	for await (const chunk of child.stdout) {
		writeFileSync(fd, chunk);
		pending += new TextDecoder().decode(chunk);
		const lines = pending.split('\n');
		pending = lines.pop()!;
		for (const line of lines) if (interesting.test(line)) console.log(line);
	}
	const code = await child.exited;
	closeSync(fd);
	return timedOut ? 'timeout' : code;
}

export async function runUITests(device: Device, root: string, argv: string[]): Promise<number> {
	const started = Date.now();
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			only: { type: 'string', multiple: true },
			keep: { type: 'boolean' },
			'no-build': { type: 'boolean' },
			timeout: { type: 'string', default: '540' },
		},
	});
	const files = positionals.map(file => resolve(file));
	if (!files.length)
		throw new Error('Usage: ./sim test <file.swift>... [--only Class/test] [--keep] [--no-build] [--timeout s]');
	for (const file of files) if (!existsSync(file)) throw new Error(`No test file at ${file}.`);
	const deadline = started + Number(values.timeout) * 1000;
	const dir = join(root, 'app-ios/DerivedData/uitest');
	const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
	mkdirSync(join(dir, 'logs'), { recursive: true });

	try {
		if (values['no-build']) {
			spawnSync('xcrun', ['simctl', 'bootstatus', device.udid, '-b'], { stdio: 'ignore' });
			if (spawnSync('xcrun', ['simctl', 'get_app_container', device.udid, bundle]).status !== 0) {
				throw new Error(`The app is not installed on ${device.name}. Drop --no-build.`);
			}
		} else {
			console.log(`Building and installing the app on ${device.name}…`);
			const log = join(dir, 'logs', `${stamp}-app.log`);
			const app = await run(
				['bun', 'app-ios/scripts/run', '-t', device.udid, '--no-watch', '--headless', '--no-sentry'],
				log,
				deadline,
			);
			if (app !== 0) {
				console.error(readFileSync(log, 'utf8').split('\n').slice(-30).join('\n'));
				console.error(
					app === 'timeout'
						? `Timed out building the app. Rerun; the build is incremental.`
						: `App build failed. See ${log}.`,
				);
				return 1;
			}
		}

		scaffold(dir, files);
		const generate = spawnSync(xcodegen(), ['generate', '--quiet', '--spec', join(dir, 'project.yml')], {
			cwd: dir,
			encoding: 'utf8',
		});
		if (generate.status !== 0) throw new Error(`xcodegen failed\n${generate.stderr}${generate.stdout}`);

		const log = join(dir, 'logs', `${stamp}.log`);
		const result = join(dir, 'results', `${stamp}.xcresult`);
		console.log(`Running UI tests on ${device.name}. Log ${log}`);
		const code = await run(
			[
				'xcodebuild',
				'test',
				'-project',
				join(dir, 'UITest.xcodeproj'),
				'-scheme',
				'UITests',
				'-destination',
				`id=${device.udid}`,
				'-derivedDataPath',
				join(dir, 'dd'),
				'-resultBundlePath',
				result,
				...(values.only ?? []).map(test => `-only-testing:UITests/${test}`),
			],
			log,
			deadline,
		);
		if (code === 'timeout') {
			console.error(`Timed out after ${values.timeout}s. Raise --timeout, or narrow the run with --only. Log ${log}`);
			return 124;
		}
		console.log(
			`${code === 0 ? 'UI tests passed' : 'UI tests failed'} in ${Math.round((Date.now() - started) / 1000)}s. Result ${result}, screenshots ${join(dir, 'shots')}`,
		);
		return code;
	} finally {
		if (!values.keep) {
			const current = devices().find(entry => entry.udid === device.udid);
			if (current) shutdown(current);
		}
	}
}
