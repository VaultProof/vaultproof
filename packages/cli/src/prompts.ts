import readline from "node:readline";

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

export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface();

    // Write the question to stderr so it shows up
    process.stderr.write(question);

    // Mute stdout to hide typed characters
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let input = "";

    const onData = (char: Buffer): void => {
      const c = char.toString("utf-8");

      if (c === "\n" || c === "\r" || c === "\u0004") {
        // Enter or Ctrl+D
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        stdin.removeListener("data", onData);
        process.stderr.write("\n");
        rl.close();
        resolve(input);
      } else if (c === "\u0003") {
        // Ctrl+C
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        stdin.removeListener("data", onData);
        rl.close();
        process.exit(1);
      } else if (c === "\u007F" || c === "\b") {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else {
        input += c;
      }
    };

    stdin.on("data", onData);
  });
}

export async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(`${question} (y/N) `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}
