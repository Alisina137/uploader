import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
export async function withTerminal(work) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Open an interactive terminal to continue.');
  let hideInput = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (hideInput) done();
      else stdout.write(chunk, encoding, done);
    }
  });
  const terminal = createInterface({ input: stdin, output, terminal: true, historySize: 0 });
  const cancelled = new AbortController();
  terminal.on('SIGINT', () => cancelled.abort());
  const ask = (label) => terminal.question(label, { signal: cancelled.signal });
  async function askPassword(label) {
    stdout.write(label);
    hideInput = true;
    try {
      return await ask('');
    } finally {
      hideInput = false;
      stdout.write('\n');
    }
  }

  try {
    return await work(ask, askPassword);
  } finally {
    terminal.close();
  }
}
