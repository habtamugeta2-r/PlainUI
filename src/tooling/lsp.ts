/**
 * A language server for PlainUI.
 *
 * The compiler already produces everything an editor needs — diagnostics with codes, spans and
 * hints, plus a formatter — so this module is mostly protocol: read JSON-RPC frames from stdin,
 * keep the open documents in sync, recompile, publish.
 *
 * Scope is deliberately small and complete rather than broad and half-working:
 *
 *   - `textDocument/publishDiagnostics` on open, change and save (full sync);
 *   - `textDocument/formatting` (whole-document edit);
 *   - `textDocument/hover` for element and property names, from the widget registry.
 *
 * Commit-on-type, go-to-definition and completion are not here; see docs/06-roadmap.md for what
 * they need (incremental parsing, a name-resolution index) and why guessing is worse than waiting.
 *
 * Diagnostics are project-aware: the editor buffer replaces the file on disk, but its siblings are
 * read from disk, so a component imported from another file resolves exactly as it does in a build.
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { CODES } from '../analysis/diagnostics.ts';
import { formatText } from './format.ts';
import { compileProject, ProjectCache, type SourceInput } from '../project/project.ts';
import { positionAt, sourceFile } from '../frontend/source.ts';
import { BUILTIN_STYLES } from '../analysis/styles.ts';
import { discoverSources, resolveProject, toInputs } from '../project/workspace.ts';
import { WIDGETS, findProp, propsFor, widgetSpec } from '../analysis/widgets/registry.ts';

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: number | string;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

type Incoming = JsonRpcRequest | JsonRpcNotification;

/** Notifications have no `id`; requests always do. */
function requestId(message: Incoming): number | string | undefined {
  return (message as { id?: number | string }).id;
}

/** Requests expect a reply; notifications do not. */
function isRequest(message: Incoming): message is JsonRpcRequest {
  return requestId(message) !== undefined;
}

interface LspPosition {
  readonly line: number;
  readonly character: number;
}

interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

interface LspDiagnostic {
  readonly range: LspRange;
  readonly severity: 1 | 2 | 3 | 4;
  readonly code: string;
  readonly source: 'plainui';
  readonly message: string;
}

interface TextDocumentItem {
  readonly uri: string;
  readonly languageId?: string;
  readonly version?: number;
  readonly text: string;
}

interface TextDocumentIdentifier {
  readonly uri: string;
}

interface DocumentPosition {
  readonly textDocument: TextDocumentIdentifier;
  readonly position: LspPosition;
}

/** `file://` URI ⇄ path, without pulling in a URL polyfill. */
export function uriToPath(uri: string): string {
  const withoutScheme = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  return decodeURIComponent(withoutScheme);
}

export function pathToUri(path: string): string {
  const absolute = resolvePath(path).replace(/\\/g, '/');
  return `file://${absolute.split('/').map(encodeURIComponent).join('/')}`;
}

const SEVERITY: Record<string, 1 | 2 | 3 | 4> = { error: 1, warning: 2, info: 3, hint: 4 };

export class LanguageServer {
  private readonly documents = new Map<string, string>();
  private readonly cache = new ProjectCache();
  private cwd: string;
  private readonly send: (message: unknown) => void;
  private readonly log: (message: string) => void;

  constructor(options: { cwd: string; send: (message: unknown) => void; log?: (message: string) => void }) {
    this.cwd = options.cwd;
    this.send = options.send;
    this.log = options.log ?? (() => {});
  }

  /** Handles one message. Returns `false` when the server should exit. */
  handle(message: Incoming): boolean {
    switch (message.method) {
      case 'initialize': {
        const params = message.params as { rootUri?: string | null; rootPath?: string | null } | undefined;
        const root = params?.rootUri ?? (params?.rootPath === undefined || params.rootPath === null ? null : `file://${params.rootPath}`);
        if (typeof root === 'string' && root.length > 0) this.cwd = uriToPath(root);
        this.reply(message, {
          capabilities: {
            textDocumentSync: 1, // full: the editor sends the whole document, which is cheap here
            hoverProvider: true,
            documentFormattingProvider: true,
          },
          serverInfo: { name: 'plainui', version: '1.0.0' },
        });
        return true;
      }
      case 'initialized':
        return true;
      case 'shutdown':
        this.reply(message, null);
        return true;
      case 'exit':
        return false;
      case 'textDocument/didOpen': {
        const params = message.params as { textDocument: TextDocumentItem };
        this.documents.set(params.textDocument.uri, params.textDocument.text);
        this.publish(params.textDocument.uri);
        return true;
      }
      case 'textDocument/didChange': {
        const params = message.params as {
          textDocument: TextDocumentIdentifier;
          contentChanges: readonly { text: string }[];
        };
        const last = params.contentChanges[params.contentChanges.length - 1];
        if (last !== undefined) this.documents.set(params.textDocument.uri, last.text);
        this.publish(params.textDocument.uri);
        return true;
      }
      case 'textDocument/didSave': {
        const params = message.params as { textDocument: TextDocumentIdentifier };
        this.publish(params.textDocument.uri);
        return true;
      }
      case 'textDocument/didClose': {
        const params = message.params as { textDocument: TextDocumentIdentifier };
        this.documents.delete(params.textDocument.uri);
        this.send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: params.textDocument.uri, diagnostics: [] } });
        return true;
      }
      case 'textDocument/formatting': {
        this.formatDocument(message);
        return true;
      }
      case 'textDocument/hover': {
        this.hover(message);
        return true;
      }
      default:
        if (isRequest(message)) this.replyError(message, -32601, `unknown method ${message.method}`);
        return true;
    }
  }

  private reply(message: Incoming, result: unknown): void {
    const id = requestId(message);
    if (id === undefined) return;
    this.send({ jsonrpc: '2.0', id, result });
  }

  private replyError(message: Incoming, code: number, text: string): void {
    const id = requestId(message);
    if (id === undefined) return;
    this.send({ jsonrpc: '2.0', id, error: { code, message: text } });
  }

  private text(uri: string): string | undefined {
    const open = this.documents.get(uri);
    if (open !== undefined) return open;
    try {
      return readFileSync(uriToPath(uri), 'utf8');
    } catch {
      return undefined;
    }
  }

  /** Compiles the project around the open document and publishes that document's diagnostics. */
  private publish(uri: string): void {
    const text = this.text(uri);
    if (text === undefined) return;

    const path = uriToPath(uri);
    let inputs: SourceInput[];
    let targetPath: string;
    try {
      const project = resolveProject({ paths: [], cwd: this.cwd });
      const files = discoverSources(project.roots, project.config);
      inputs = toInputs(files, project.root);
      const relative = files.length > 0 ? files : [path];
      const index = relative.findIndex((file) => resolvePath(file) === resolvePath(path));
      targetPath = inputs[index]?.path ?? 'file.pui';
      if (index === -1) {
        // A file outside the configured source roots (or not yet on disk): compile it alone.
        targetPath = 'file.pui';
        inputs = [{ path: targetPath, text }];
      } else {
        inputs[index] = { path: targetPath, text };
      }
    } catch (error) {
      this.log(`project discovery failed: ${(error as Error).message}`);
      inputs = [{ path: 'file.pui', text }];
      targetPath = 'file.pui';
    }

    const result = compileProject(inputs, { outDir: 'lib/generated', cache: this.cache });
    const file = result.files.find((candidate) => candidate.source.path === targetPath);
    const fileSource = file?.source ?? sourceFile(targetPath, text);
    const diagnostics: LspDiagnostic[] = (file?.diagnostics ?? []).map((diagnostic) => {
      const start = positionAt(fileSource, diagnostic.span.start);
      const end = positionAt(fileSource, diagnostic.span.end);
      const info = CODES[diagnostic.code as keyof typeof CODES];
      const detail = diagnostic.hint !== undefined ? `${diagnostic.message}\n\nhint: ${diagnostic.hint}` : diagnostic.message;
      return {
        range: {
          start: { line: start.line - 1, character: start.col - 1 },
          end: { line: end.line - 1, character: end.col - 1 },
        },
        severity: SEVERITY[diagnostic.severity] ?? 1,
        code: diagnostic.code,
        source: 'plainui' as const,
        message: info !== undefined ? `${detail}\n\n${info.title}` : detail,
      };
    });

    this.send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
  }

  private formatDocument(message: Incoming): void {
    if (!isRequest(message)) return;
    const params = message.params as DocumentPosition;
    const text = this.text(params.textDocument.uri);
    if (text === undefined) {
      this.reply(message, null);
      return;
    }
    const formatted = formatText(uriToPath(params.textDocument.uri), text);
    if (!formatted.changed) {
      this.reply(message, []);
      return;
    }
    const original = sourceFile('doc.pui', text);
    const lastLine =
      original.text.length === 0 ? { line: 1, col: 1 } : positionAt(original, original.text.length);
    this.reply(message, [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: lastLine.line - 1, character: lastLine.col - 1 },
        },
        newText: formatted.text,
      },
    ]);
  }

  private hover(message: Incoming): void {
    if (!isRequest(message)) return;
    const params = message.params as DocumentPosition;
    const text = this.text(params.textDocument.uri);
    if (text === undefined) {
      this.reply(message, null);
      return;
    }

    const lines = text.split('\n');
    const line = lines[params.position.line] ?? '';
    const character = params.position.character;
    const word = wordAt(line, character);
    if (word === undefined) {
      this.reply(message, null);
      return;
    }

    const markdown: string[] = [];
    const spec = widgetSpec(word);
    if (spec !== undefined) {
      markdown.push(`**${spec.tag}** — ${spec.summary}`);
      const props = propsFor(spec).map((prop) => `\`${prop.name}\``);
      if (props.length > 0) markdown.push(`properties: ${props.join(', ')}`);
      markdown.push('```plainui\n' + spec.example + '\n```');
    } else if (BUILTIN_STYLES.includes(word)) {
      markdown.push(`**${word}** — a built-in text style`);
    } else {
      // A property name: show what it means and which elements accept it.
      const owners = [...WIDGETS.values()].filter((spec) => findProp(spec, word) !== undefined);
      const prop = owners.length === 0 ? undefined : findProp(owners[0]!, word);
      if (prop !== undefined) {
        markdown.push(`**${prop.name}** — ${prop.summary}`);
        markdown.push(`kind: \`${prop.kind}\` · accepted by: ${owners.map((spec) => `\`${spec.tag}\``).join(', ')}`);
      }
    }

    if (markdown.length === 0) {
      this.reply(message, null);
      return;
    }
    this.reply(message, {
      contents: { kind: 'markdown', value: markdown.join('\n\n') },
      range: {
        start: { line: params.position.line, character: Math.max(0, character - word.length) },
        end: { line: params.position.line, character: character },
      },
    });
  }
}

function wordAt(line: string, character: number): string | undefined {
  const isWord = (char: string | undefined): boolean => char !== undefined && /[A-Za-z0-9_]/.test(char);
  let start = Math.max(0, Math.min(character, line.length));
  // LSP positions sit between characters; treat both neighbours as "inside" the word.
  if (!isWord(line[start]) && isWord(line[start - 1])) start -= 1;
  while (start > 0 && isWord(line[start - 1])) start -= 1;
  let end = start;
  while (isWord(line[end])) end += 1;
  const word = line.slice(start, end);
  return word.length > 0 ? word : undefined;
}

/** Reads `Content-Length` framed JSON-RPC from `input` and writes replies to `output`. */
export function runLanguageServer(options: {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  cwd: string;
  log?: (message: string) => void;
}): Promise<number> {
  const input = options.input;
  const output = options.output;

  const write = (message: unknown): void => {
    const body = JSON.stringify(message);
    output.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  };

  const server = new LanguageServer({ cwd: options.cwd, send: write, ...(options.log === undefined ? {} : { log: options.log }) });

  let buffer = Buffer.alloc(0);

  return new Promise<number>((resolve) => {
    input.on('data', (chunk: Buffer | string) => {
      buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk]);
      for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (match === null) {
          buffer = buffer.subarray(headerEnd + 4);
          continue;
        }
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) return;
        const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
        buffer = buffer.subarray(bodyStart + length);
        let message: Incoming;
        try {
          message = JSON.parse(body) as Incoming;
        } catch {
          continue;
        }
        const keepGoing = server.handle(message);
        if (!keepGoing) {
          // `exit`: the client is done. Closing stdin lets the process end on its own; resolving
          // here without that would leave the CLI alive holding an open stdin handle.
          (input as { destroy?: () => void }).destroy?.();
          resolve(0);
          return;
        }
      }
    });
    input.on('end', () => resolve(0));
  });
}
