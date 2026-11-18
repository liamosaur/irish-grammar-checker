// Splits text into chunks that can be checked independently, so the worker can
// report progress and stop between chunks. A chunk only ever ends after a line
// that finishes with sentence-ending punctuation (the same shape the engine's
// own sentence splitter looks for), so chunked and whole-text results agree.
// Every chunk starts at the beginning of a line; `line` is its first line index.

export interface Chunk {
  line: number;
  text: string;
}

const ENDS_SENTENCE = /[.?!][\])}"']*[ \t]*$/;

export function chunkText(text: string, minChars = 1500): Chunk[] {
  const lines = text.split('\n');
  const chunks: Chunk[] = [];
  let start = 0;
  let size = 0;
  for (let i = 0; i < lines.length; i++) {
    size += lines[i].length + 1;
    const last = i === lines.length - 1;
    if (last || (size >= minChars && ENDS_SENTENCE.test(lines[i]))) {
      const t = lines.slice(start, i + 1).join('\n');
      if (t.trim()) chunks.push({ line: start, text: t });
      start = i + 1;
      size = 0;
    }
  }
  return chunks;
}
