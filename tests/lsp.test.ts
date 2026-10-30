/**
 * The language server, exercised the way an editor does: as a subprocess speaking
 * `Content-Length`-framed JSON-RPC on stdin/stdout.
 *
 * The point of these tests is the protocol seam, not the compiler — the compiler has its own
 * tests. A wrong `Content-Length`, a missing publish, or a 1-based line number where LSP wants
 * 0-based would make the server useless in every editor while every unit test still passed.
 */

import { strict as assert } from 'node:assert';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'plainui-lsp-'));
after(() => rmSync(root, { recursive: true, force: true }));

mkdirSync(join(root, 'lib/ui'), { recursive: true });
writeFileSync(join(root, 'plainui.config.json'), '{ "srcDir": "lib/ui", "outDir": "lib/generated" }\n', 'utf8');
writeFileSync(join(root, 'lib/ui/home.pui'), 'screen Home:\n    text "hello"\n', 'utf8');

const fileUri = `file://${join(root, 'lib/ui/home.pui')}`;

interface Message {
  readonly id?: number;
  readonly method?: string;
  readonly result?: unknown;
  readonly params?: unknown;
}

class Client {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private readonly messages: Message[] = [];
  private waiters: { predicate: (message: Message) => boolean; resolve: (message: Message) => void }[] = [];
  private nextId = 1;

  constructor() {
    // Node sets NODE_TEST_CONTEXT for every child of the test runner; a child that inherits it
    // speaks the runner's private protocol instead of ours.
    const env = { ...process.env };
    delete env['NODE_TEST_CONTEXT'];
    this.child = spawn(process.execPath, ['--experimental-strip-types', 'src/tooling/cli.ts', 'lsp'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  private drain(): void {
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      assert.ok(match, `server sent a frame without Content-Length: ${header}`);
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const message = JSON.parse(this.buffer.subarray(start, start + length).toString('utf8')) as Message;
      this.buffer = this.buffer.subarray(start + length);
      const waiting = this.waiters;
      const matched = waiting.find((waiter) => waiter.predicate(message));
      if (matched !== undefined) {
        this.waiters = waiting.filter((waiter) => waiter !== matched);
        matched.resolve(message);
        continue;
      }
      // Not awaited yet: keep it for a later waitFor.
      this.messages.push(message);
    }
  }

  send(message: unknown): void {
    const body = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }

  request(method: string, params: unknown): number {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params });
    return id;
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  waitFor(predicate: (message: Message) => boolean, label: string): Promise<Message> {
    const index = this.messages.findIndex(predicate);
    if (index !== -1) return Promise.resolve(this.messages.splice(index, 1)[0]!);
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 15_000);
      this.waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  response(id: number): Promise<Message> {
    return this.waitFor((message) => message.id === id, `response ${id}`);
  }

  diagnostics(uri: string): Promise<Message> {
    return this.waitFor(
      (message) => message.method === 'textDocument/publishDiagnostics' && (message.params as { uri: string }).uri === uri,
      `diagnostics for ${uri}`,
    );
  }

  async stop(): Promise<void> {
    const id = this.request('shutdown', null);
    await this.response(id);
    this.send({ jsonrpc: '2.0', method: 'exit' });
    await new Promise((resolve) => this.child.on('exit', resolve));
  }
}

test('the language server publishes diagnostics, formats and answers hover', { timeout: 60_000 }, async () => {
  const client = new Client();
  try {
    const initId = client.request('initialize', { processId: null, rootUri: `file://${root}`, capabilities: {} });
    const init = await client.response(initId);
    const capabilities = (init.result as { capabilities: Record<string, unknown> }).capabilities;
    assert.equal(capabilities['textDocumentSync'], 1, 'full sync is advertised');
    assert.equal(capabilities['documentFormattingProvider'], true);
    assert.equal(capabilities['hoverProvider'], true);
    client.notify('initialized', {});

    // 1. A clean file: diagnostics are published, and there are none.
    client.notify('textDocument/didOpen', {
      textDocument: { uri: fileUri, languageId: 'plainui', version: 1, text: 'screen Home:\n    text "hello"\n' },
    });
    const clean = (await client.diagnostics(fileUri)).params as { diagnostics: unknown[] };
    assert.deepEqual(clean.diagnostics, []);

    // 2. A typo: one error, with the code, severity 1 and a 0-based range on line 2.
    client.notify('textDocument/didChange', {
      textDocument: { uri: fileUri, version: 2 },
      contentChanges: [{ text: 'screen Home:\n    colum:\n        text "x"\n' }],
    });
    const broken = (await client.diagnostics(fileUri)).params as {
      diagnostics: { code: string; severity: number; range: { start: { line: number; character: number } }; message: string }[];
    };
    const unknown = broken.diagnostics.find((diagnostic) => diagnostic.code === 'PUI2001');
    assert.ok(unknown, `expected PUI2001, got ${JSON.stringify(broken.diagnostics)}`);
    assert.equal(unknown.severity, 1);
    assert.equal(unknown.range.start.line, 1, 'line numbers are 0-based in LSP');
    assert.equal(unknown.range.start.character, 4);
    assert.match(unknown.message, /colum/);

    // 3. Fixing it clears the diagnostics.
    client.notify('textDocument/didChange', {
      textDocument: { uri: fileUri, version: 3 },
      contentChanges: [{ text: 'screen Home:\n    column:\n        text "x"\n' }],
    });
    const fixed = (await client.diagnostics(fileUri)).params as { diagnostics: unknown[] };
    assert.deepEqual(fixed.diagnostics, []);

    // 4. Formatting returns a whole-document edit in canonical style.
    client.notify('textDocument/didChange', {
      textDocument: { uri: fileUri, version: 4 },
      contentChanges: [{ text: 'screen   Home:\n  text    "x"\n' }],
    });
    await client.diagnostics(fileUri);
    const formatId = client.request('textDocument/formatting', {
      textDocument: { uri: fileUri },
      options: { tabSize: 4, insertSpaces: true },
    });
    const edits = (await client.response(formatId)).result as { newText: string }[];
    assert.equal(edits.length, 1);
    assert.equal(edits[0]!.newText, 'screen Home:\n    text "x"\n');

    // 5. Hover on an element name explains it from the widget registry.
    const hoverId = client.request('textDocument/hover', {
      textDocument: { uri: fileUri },
      position: { line: 1, character: 6 },
    });
    const hover = (await client.response(hoverId)).result as { contents: { kind: string; value: string } } | null;
    assert.ok(hover, 'expected hover content for `text`');
    assert.equal(hover.contents.kind, 'markdown');
    assert.match(hover.contents.value, /text/);
    assert.match(hover.contents.value, /properties:/);

    // 6. Closing the document clears its diagnostics.
    client.notify('textDocument/didClose', { textDocument: { uri: fileUri } });
    const cleared = (await client.diagnostics(fileUri)).params as { diagnostics: unknown[] };
    assert.deepEqual(cleared.diagnostics, []);
  } finally {
    await client.stop();
  }
});

test('an unknown method is answered with a JSON-RPC error, not silence', { timeout: 30_000 }, async () => {
  const client = new Client();
  try {
    const id = client.request('textDocument/nonsense', {});
    const response = await client.response(id);
    assert.equal((response as unknown as { error: { code: number } }).error.code, -32601);
  } finally {
    await client.stop();
  }
});
