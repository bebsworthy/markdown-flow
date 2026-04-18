import { flush } from "./flush.js";

export async function type(
  stdin: { write: (chunk: string) => unknown },
  text: string,
): Promise<void> {
  for (const ch of text) {
    stdin.write(ch);
    await flush(1);
  }
}
