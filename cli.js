#!/usr/bin/env node
import path from 'path';
import util from 'util';

import arg from 'arg';
import chalk from 'chalk';
import diff from 'diff';
import globby from 'globby';
import stripAnsi from 'strip-ansi';

// https://regex101.com/r/BjSw9u/2
const MASK_PATTERN = /^(-)?([^/-][^/]*(?:\/[^/]+)*)$/;

const args = arg({
	'--help': Boolean,

	'--include': [String],
	'-I': '--include',

	'--verbose': Boolean,
	'-v': '--verbose',

	'--import': [String],
	'-i': '--import'
});

if (args['--help']) {
	console.error(chalk`
  {bold.cyanBright best}

  A dead simple test runner.

  - Export your functions and they're evaluated
  - Function names become test names
  - Exported functions are awaited upon

  {bold USAGE}

    {bold.cyanBright best} --help
    {bold.cyanBright best} [-I {underline /dir/or/file} [-I ...]] [-T] [{underline test_name}...]

    {underline test_names}'s correspond to the name of the exported functions within test sources,
    and are prefixed with the path of the source file (sans extension) in which it was defined.

    For example, the following test function inside {bold test/foo.js}:

        {cyan exports}.my_example_test {dim =} {bold.cyanBright async} () {dim =>} ${'{'}
            assert(foo {dim ===} bar);
        ${'}'};

    would translate to the {underline test_name}:

        {bold test/foo/my_example_test}

    Specify one or more (optional) {underline test_name}'s to only run certain tests (or prefix
    with {bold -} to skip the named test).

  {bold OPTIONS}

    --help                          Shows this help message

    -v, --verbose                   Shows more verbose test results

    -I, --include {underline /dir/or/file}      Uses one or more directories/files as test sources.
                                    Defaults to {bold ./test/**/*.js} if no include directives
                                    are specified

    -i, --import {underline module-name}       Imports a module or a script prior to running tests
`);

	process.exit(2);
}

function error(msg) {
	console.error(chalk`{bold.cyanBright best:} {bold.red error:}`, msg);
}

const warningLabel = chalk`{bold.cyanBright best:} {bold.yellow warning:}`;
function warning(msg) {
	console.error(warningLabel, msg);
}

let whitelistMode = false;
const masks = [];

if (args._.length > 0) {
	const invalid = args._.filter(pattern => {
		pattern = pattern.replace(/^\/+|\/+$/g, '');

		const match = pattern.match(MASK_PATTERN);
		if (!match) {
			return true;
		}

		// group 1 preset = - = negate
		whitelistMode = whitelistMode || !Boolean(match[1]);
		masks.push({
			// https://stackoverflow.com/a/2593661/510036
			mask: new RegExp(`^${match[2].replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&')}(\\/|$)`),
			negate: Boolean(match[1])
		});
	});

	if (invalid.length > 0) {
		invalid.forEach(pattern => error(`invalid mask: ${pattern}`));
		process.exit(2);
	}
}

function stringifyReplacer(_, v) {
	switch (true) {
	case v instanceof RegExp: return v.toString();
	case v instanceof Error: return v.stack;
	default: return v;
	}
}

function indent(s) {
	return s.replace(/(^|\r?\n)/g, '$1    ');
}

function inspect(o) {
	return util.inspect(o, {depth: Number(process.env.BEST_DEPTH || 3)});
}

function coloredDiff(expected, actual) {
	// Special case for non-object argument(s);
	// otherwise, they look strange (issue #2)
	if (expected === null || typeof expected !== 'object' || actual === null || typeof actual !== 'object') {
		return chalk`{greenBright {bold expected:}

${indent(inspect(expected))}}

{redBright {bold actual:}

${indent(inspect(actual))}}`;
	}

	const d = diff.diffJson(expected, actual, {stringifyReplacer});

	const colored = d.map(od => {
		const color = od.removed
			? chalk.greenBright
			: (od.added
				? chalk.redBright
				: chalk.grey);

		return color(od.value);
	});

	return colored.join('');
}

function leftPad(padding, str) {
	const padstr = ' '.repeat(padding);
	return padstr + str
		.split(/\r?\n/g)
		.join(`\n${padstr}`)
		.replace(/ +$/, '');
}

function errorMessage(err) {
	if (err.stack) {
		const stackLines = err.stack
			.split(/\r?\n/g)
			.filter(line => /^\s{3,}at\s+/.test(line));

		const firstLines = stackLines
			.slice(0, 2)
			.map(line => line.trim())
			.join('\n');

		if (firstLines) {
			return chalk`{redBright ${firstLines}}\n\n`;
		}
	}

	return '';
}

function diffMessage(err) {
	if ('actual' in err && 'expected' in err) {
		return coloredDiff(err.expected, err.actual);
	}

	return '';
}

async function runTest(name, fn) {
	let errResult = null;
	try {
		await fn();
	} catch (err) {
		errResult = err;
	}

	// We evaluate these each time a test is run, as the
	// number of columns might have changed if the user
	// resized their window. We should be aware of that,
	// especially since this is cheap.
	//
	// If there is no TTY, we just output everything
	const columns = process.stdout.columns || Infinity;
	const verbose = args['--verbose'];

	let message = '';

	if (!verbose) {
		message = `\r${' '.repeat(Number(process.stdout.columns))}\r`;
	}

	if (errResult) {
		// Failed
		message += chalk`{red.bold FAIL} {whiteBright ${name.substring(0, columns - 5)}}\n`;

		// We put into `details` so that we can leftPad() if we're in verbose mode.
		message += errorMessage(errResult);

		let details = `${diffMessage(errResult)}\n`;

		if (verbose) {
			details += chalk`\n{red ${stripAnsi(errResult.stack || errResult.toString())}}\n\n`;
			details = leftPad(6, details);
		}

		message += details;

		if (!verbose) {
			message += '\n\n';
		}
	} else {
		message += chalk`{green.bold PASS} {whiteBright ${name.substring(0, columns - 5)}}`;

		if (verbose) {
			message += '\n';
		}
	}

	process.stdout.write(message);
	return !Boolean(errResult);
}

async function main() {
	// Perform requirements
	for (const requirement of (args['--import'] || [])) {
		if (args['--verbose']) {
			console.error(chalk`importing {bold ${requirement}}`);
		}
		await import(requirement);
	}

	// Get file listing
	const allowedExtensions = ['.mjs', '.cjs', '.node', '.js'];

	const filePaths = (((args['--include'] || []).length > 0) ? args['--include'] : ['test']);
	const files = (await globby(filePaths, {
		expandDirectories: {
			extensions: allowedExtensions.map(s => s.replace(/^\.+/, ''))
		}
	})).filter(filepath => {
		if (!allowedExtensions.includes(path.extname(filepath))) {
			warning(`ignoring file (not a script): ${filepath}`);
			return false;
		}

		return true;
	});

	if (files.length === 0) {
		warning(`no test files specified`);
		return;
	}

	// Build up test suite
	const suite = [];
	for (const filepath of files) {
		const module = await import(path.resolve(filepath));
		const moduleKeys = Object.getOwnPropertyNames(module);
		let validTests = moduleKeys.length;
		const tests = moduleKeys
			.map(key => [key, `${filepath.slice(0, -3)}/${key}`])
			.filter(([key, testPath]) => {
				if (typeof module[key] !== 'function') {
					warning(`skipping non-function test: ${testPath}`);
					--validTests;
					return false;
				}

				return true;
			})
			.filter(([, testPath]) => {
				let allowed = !whitelistMode;
				for (const {mask, negate} of masks) {
					if (mask.test(testPath)) {
						allowed = whitelistMode && !negate;
					}
				}
				return allowed;
			})
			.map(([key, testPath]) => [testPath, module[key]]);

		if (validTests === 0 && args['--verbose']) {
			warning(`test file has no valid tests: ${filepath}`);
		}

		suite.push(...tests);
	}

	if (suite.length === 0) {
		warning('no tests to run');
		return;
	}

	let failures = 0;
	for (const [testName, fn] of suite) {
		const testSuccess = await runTest(testName, fn);
		failures += Number(!testSuccess);
	}

	process.stdout.write('\n');

	if (failures === 0) {
		console.error(chalk`{inverse.greenBright ALL TESTS PASSED}`);
	} else {
		console.error(chalk`{inverse.redBright ${failures} TESTS FAILED}`);
		process.exit(1);
	}
}

main().catch(err => {
	console.error(err.stack);
	process.exit(1);
});
