/**
 * MAM Language Server Entry Point
 */

import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { MAMServer } from './server.js';

const connection = createConnection(ProposedFeatures.all);
const server = new MAMServer(connection);

connection.onInitialize(params => server.initialize(params));
connection.onInitialized(() => server.onInitialized());
connection.onShutdown(() => server.shutdown());

connection.listen();