#!/usr/bin/env node

const http = require('http');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const bonjour = require('bonjour')();
const nanoid = require('nanoid');
const Gauge = require('gauge');
const ON_DEATH = require('death');
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

// Noinspection BadExpressionStatementJS
require('yargs') // eslint-disable-line no-unused-expressions
	.usage(`Usage: $0 <command> [options]`)
	.version(require('./package').version)
	.alias('version', 'V')
	.help('help')
	.alias('help', 'h')
	.showHelpOnFail(true, 'whoops, something went wrong! run with --help')
	.demandCommand(1)
	.command('send', 'send a file', yargs => {
		yargs.option('port', {
			describe: 'port to bind on. default is random between 1024 and 65534',
			default: Math.floor((Math.random() * (65534 - 1024 + 1)) + 1024)
		});
		yargs.option('file', {
			describe: 'File to send',
			alias: 'f'
		});
	}, argv => {
		if (argv.file) {
			send(parseInt(argv.port, 10), path.resolve(argv.file));
		} else {
			console.info('Not sending anything, because you didn\'t specify a --file');
			process.exit(1);
		}
	})
	.command('accept', 'accept a file', yargs => {
		yargs.option('id', {
			describe: 'id from the sender',
			default: null,
			alias: 'i'
		});
		yargs.option('out', {
			describe: 'out file',
			default: null,
			alias: 'o'
		});
		yargs.option('ip', {
			describe: 'IP (if bonjour does not work)',
			default: null,
			alias: 'a'
		});
		yargs.option('port', {
			describe: 'Port (if bonjour does not work)',
			default: null,
			alias: 'p'
		});
	}, argv => {
		if (argv.ip && argv.i && argv.out) {
			accept(argv.i, argv.out, argv.ip, argv.port)
		}
		if (argv.i && argv.out) {
			accept(argv.i, argv.out);
		} else if (!argv.out && !argv.i) {
			console.log('You need to add --out <file> and --id <id>');
			process.exit(1);
		} else if (!argv.out) {
			console.log('You need to add --out <file>');
			process.exit(1);
		} else if (!argv.i) {
			console.log('You need the ID from the other person.');
			process.exit(1);
		}
	})
	.option('verbose', {
		alias: 'v',
		default: false
	})
	.argv;

/**
 * @description Accept a file
 * @param {any} id NanoID of the sender
 * @param {any} out Out file
 * @param {any} ip IP address of the sender
 * @param {any} port Port # of the sender
 */
async function accept(id, out, ip, port) {
	if (fs.existsSync(path.resolve(out))) {
		const promptInput = await readLineAsync('Output file already exists. Are you sure you want to do this? y/n\n');
		// console.log(promptInput);
		if (promptInput !== 'y') {
			console.log('Not overwriting. Exiting.')
			process.exit(0);
		} else {
			rl.close();
		}
	}
	if (ip && port) {
		download(ip, port, out);
		return;
	}
	bonjour.find({
		type: 'http'
	}, service => {
		if (!service) {
			return;
		}
		if (service.name === `Local File Transfer: ${id}`) {
			console.log(`Found the right server. Downloading file.`);
			if (service.addresses && service.addresses.length > 0 && service.port) {
				download(service.addresses[0], service.port, out);
			}
		}
	});
}

/**
 * Downlaod a file.
 * @param {String} ip - IP Address of the server
 * @param {Number} port - Port of the server
 * @param {String} out - Out file.
 */
function download(ip, port, out) {
	const request = require('request');
	const progress = require('request-progress');
	const gauge = new Gauge();
	const req = request(`http://${ip}:${port}`);
	progress(req)
		.on('progress', state => {
			gauge.show(`${state.percent * 100}% downloaded, ${state.time.remaining || 'unknown'} seconds left`, state.percent);
		})
		.on('error', err => {
			console.log(err);
			process.exit(1);
		})
		.on('end', () => {
			gauge.disable();
			console.log('\n');
			console.log('File received. Exiting');
			bonjour.destroy();
			process.exit(0);
		})
		.pipe(fs.createWriteStream(path.resolve(out)));
}

/**
 * Send a file
 * @param {Number} port - Port number
 * @param {String} file - Path to file
 */
function send(port, file) {
	if (!file) {
		return null;
	}
	if (!fs.existsSync(path.resolve(file))) {
		console.log(`${file} doesn't exist. Exiting.`);
		process.exit(0);
	}
	const mime = require('mime');
	const id = nanoid(5);
	const service = bonjour.publish({
		name: `Local File Transfer: ${id}`,
		type: 'http',
		port
	});
	const stats = fs.statSync(file);
	const parsed = path.parse(file);
	const filename = parsed.base;
	const server = http.createServer((req, res) => {
		res.writeHead(200, {
			'Content-Type': mime.getType(file),
			'Content-Length': stats.size,
			'X-File-Name': filename
		});
		const readStream = fs.createReadStream(file);
		readStream.pipe(res);
		res.on('finish', () => {
			console.log('File received. Shutting down server');
			server.close();
			service.stop();
			bonjour.destroy();
			process.exit(0);
		});
	});
	server.listen(port);
	ON_DEATH(function (signal, err) {
		if (service && service.destroy) {
			service.destroy();
		}
		if (server && server.listening) {
			server.close();
		}
		if (bonjour && bonjour.destroy) {
			bonjour.destroy();
		}
		process.exit(0);
	});

	console.log('Bonjour published. try to transfer');
	console.log(`If bonjour does not work, the server is listening on ${require('os').networkInterfaces().eth0.find(elm=>elm.family=='IPv4').address}:${port}`)
	console.log(`ID is: ${id}`);
	console.log(`Example command: wifi-transfer accept -i ${id} --out ${filename}`);
	console.log(`Example command without bonjour: wifi-transfer accept -i ${id} -a ${require('os').networkInterfaces().eth0.find(elm=>elm.family=='IPv4').address} -p ${port} --out ${filename}`);
}


/**
 * @description Helper function to prompt.
 * @param {String} message The message to ask.
 * @returns {Promise<String>}
 */
function readLineAsync(message) {
	return new Promise(resolve => {
		rl.question(message, answer => {
			resolve(answer);
		});
	});
}
