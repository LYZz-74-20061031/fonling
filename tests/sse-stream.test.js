const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { TextDecoder, TextEncoder } = require('node:util');

function loadReadSseContent() {
  const html = fs.readFileSync('index.html', 'utf8');
  const start = html.indexOf('function parseSseDelta');
  const end = html.indexOf('/* ---- Send Message ---- */', start);
  assert.notEqual(start, -1, 'parseSseDelta must exist in index.html');
  assert.ok(end > start, 'SSE helpers must appear before sendMessage');
  const source = html.slice(start, end);
  const context = { TextDecoder };
  vm.runInNewContext(`${source}; this.readSseContent = readSseContent;`, context);
  return context.readSseContent;
}

function makeStream(text, chunkSizes) {
  const bytes = new TextEncoder().encode(text);
  const chunks = [];
  let offset = 0;
  let sizeIndex = 0;
  while (offset < bytes.length) {
    const size = chunkSizes[sizeIndex % chunkSizes.length];
    chunks.push(bytes.slice(offset, Math.min(offset + size, bytes.length)));
    offset += size;
    sizeIndex += 1;
  }
  let readIndex = 0;
  return {
    getReader() {
      return {
        async read() {
          if (readIndex >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: chunks[readIndex++] };
        },
      };
    },
  };
}

test('preserves split UTF-8 content and parses a final SSE frame without newline', async () => {
  const readSseContent = loadReadSseContent();
  const first = 'data: {"choices":[{"delta":{"content":"你好🌇"}}]}\n';
  const last = 'data: {"choices":[{"delta":{"content":"结尾"}}]}';
  const deltas = [];

  const result = await readSseContent(
    makeStream(first + last, [1, 2, 1, 3, 2]),
    delta => deltas.push(delta),
  );

  assert.equal(result, '你好🌇结尾');
  assert.equal(deltas.join(''), '你好🌇结尾');
});

test('ignores malformed, non-data, and done SSE lines', async () => {
  const readSseContent = loadReadSseContent();
  const text = [
    'event: ping',
    'data: not-json',
    'data: [DONE]',
    '',
  ].join('\n');

  assert.equal(await readSseContent(makeStream(text, [4, 3])), '');
});
