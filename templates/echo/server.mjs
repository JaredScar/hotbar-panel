process.stdout.write(`ready ppid=${process.ppid}\n`);

process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, '');
    buffer = buffer.slice(index + 1);
    if (line === 'stop') {
      process.stdout.write('stopping\n');
      process.exit(0);
    }
    process.stdout.write(`echo: ${line}\n`);
    index = buffer.indexOf('\n');
  }
});
