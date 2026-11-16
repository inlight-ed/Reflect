/// <reference lib="webworker" />
/**
 * Parses import files off the main thread, so a large Kaspi export does not freeze the page.
 * Message in: a File. Message out: { ok: true, sheets } or { ok: false, message: i18n key }.
 */
import { parseFile, type RawSheet } from './import-parse';

export type WorkerReply = { ok: true; sheets: RawSheet[] } | { ok: false; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<File>) => {
  let reply: WorkerReply;
  try {
    reply = { ok: true, sheets: await parseFile(event.data) };
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('import.error.') ? error.message : 'import.error.generic';
    reply = { ok: false, message };
  }
  scope.postMessage(reply);
};
