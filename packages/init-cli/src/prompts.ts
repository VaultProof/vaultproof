/**
 * Minimal readline-based prompts. Kept in this package (not imported
 * from the legacy CLI) so the init package stays isolated.
 */
import readline from 'node:readline';

function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

export function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface();
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Hidden input: raw mode on stdin, display nothing while typing.
 * Used for API keys. Ctrl+C aborts the whole process.
 */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(question);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);

    let input = '';
    const onData = (chunk: Buffer): void => {
      const str = chunk.toString('utf-8');
      for (const c of str) {
        const code = c.charCodeAt(0);
        if (c === '\n' || c === '\r' || code === 0x04) {
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener('data', onData);
          process.stderr.write('\n');
          resolve(input);
          return;
        }
        if (code === 0x03) {
          // Ctrl+C — abort
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener('data', onData);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (c === '\u007F' || c === '\b') {
          input = input.slice(0, -1);
          continue;
        }
        input += c;
      }
    };

    stdin.on('data', onData);
  });
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? '(Y/n)' : '(y/N)';
  const answer = (await prompt(`${question} ${hint} `)).toLowerCase();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}
