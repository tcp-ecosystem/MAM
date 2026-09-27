/**
 * MAM Language Server Entry Point
 */

import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import type { Connection } from 'vscode-languageserver';
import { MAMServer } from './server.js';

export { MAMServer } from './server.js';

const connection = createConnection(ProposedFeatures.all);
const server = new MAMServer(connection);

connection.onInitialize(params => server.initialize(params));
connection.onInitialized(() => server.onInitialized());
connection.onShutdown(() => server.shutdown());

connection.listen();

export const LSP_SERVER_NAME = 'mam-lsp';

export const LSP_SERVER_VERSION = '0.1.0';

export function createMAMServer(connection: Connection): MAMServer {
  return new MAMServer(connection);
}

export function registerMAMServerHandlers(connection: Connection, server: MAMServer): void {
  connection.onInitialize(params => server.initialize(params));
  connection.onInitialized(() => server.onInitialized());
  connection.onShutdown(() => server.shutdown());
}

export function getMAMServerInfo(): { name: string; version: string } {
  return { name: LSP_SERVER_NAME, version: LSP_SERVER_VERSION };
}

export function isMAMLanguageId(languageId: string): boolean {
  return languageId === 'mam';
}