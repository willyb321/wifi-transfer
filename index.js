#!/usr/bin/env node
let bonjour;
const http = require('http');
const path = require('path');
const fs = require('fs');
const nanoid = require('nanoid');
const Gauge = require('gauge');

// noinspection BadExpressionStatementJS
require('yargs') // eslint-disable-line
	.usage(`Usage: $0 <command> [options]`)
	.version(require('./package').version)
	.alias('version', 'V')
	.showHelpOnFail(true, 'whoops, something went wrong! run with --help')
	.demandCommand(1)
	.command('send', 'send a file', (yargs) => {
		yargs.option('port', {
			describe: 'port to bind on. default is random between 1024 and 65534',
			default: (Math.random() * (65534 - 1024 + 1)) + 1024
		});
		yargs.option('file', {
			describe: 'File to send',
			default: null,
			alias: 'f'
		});
	}, (argv) => {
		if (argv.file) {
			send(parseInt(argv.port), path.resolve(argv.file));
		} else {
			console.info('Not sending anything, because you didn\'t specify a --file');
			process.exit(1);
		}
	})
	.command('accept', 'accept a file', (yargs) => {
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
	}, (argv) => {
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

function accept(id, out) {
	bonjour = require('bonjour')();
	const request = require('request');
	const progress = require('request-progress');
	bonjour.find({type: 'http'}, function (service) {
		if (service.name === `Local File Transfer: ${id}`) {
			console.log(`Found the right server. Downloading file.`);
			const gauge = new Gauge();
			const req = request(`http://${service.addresses[0]}:${service.port}`);
			progress(req)
				.on('progress', function (state) {
					// The state is an object that looks like this:
					// {
					//     percent: 0.5,               // Overall percent (between 0 to 1)
					//     speed: 554732,              // The download speed in bytes/sec
					//     size: {
					//         total: 90044871,        // The total payload size in bytes
					//         transferred: 27610959   // The transferred payload size in bytes
					//     },
					//     time: {
					//         elapsed: 36.235,        // The total elapsed seconds since the start (3 decimals)
					//         remaining: 81.403       // The remaining seconds to finish (3 decimals)
					//     }
					gauge.show(`${state.percent * 100}% downloaded, ${state.time.remaining || 'unknown'} seconds left`, state.percent)
				})
				.on('error', function (err) {
					console.log(err);
					process.exit(1);
				})
				.on('end', function () {
					gauge.disable();
					console.log('\n');
					console.log('File received. Exiting');
					bonjour.destroy();
					process.exit(0);
				})
				.pipe(fs.createWriteStream(path.resolve(out)));
		}
	});
}

function send(port, file) {
	bonjour = require('bonjour')();
	const mime = require('mime');
	let service;
	if (!file) {
		return null;
	}
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
		});
	});
	server.listen(port);
	const id = nanoid(5);
	service = bonjour.publish({name: `Local File Transfer: ${id}`, type: 'http', port: port});
	console.log('Bonjour published. try to transfer');
	console.log(`ID is: ${id}`);
	console.log(`Example command: wifi-transfer accept -i ${id} --out ${filename}`);
}
