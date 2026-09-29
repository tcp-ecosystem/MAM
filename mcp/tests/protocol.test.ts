import { describe, it, expect } from 'vitest';
import {
  ProtocolCodec,
  createCodec,
  MCP_METHODS,
  isMcpMethod,
} from '../src/protocol/retrieval.js';
import {
  createRequestMessage,
  createResponseMessage,
  createErrorMessage,
  createNotificationMessage,
  McpProtocolError,
  ErrorCodes,
} from '../src/protocol/types.js';
import { MessageStore } from '../src/protocol/store.js';
import { MethodIndex } from '../src/protocol/index.js';
import { ProtocolLifecycle } from '../src/protocol/lifecycle.js';

describe('protocol', () => {
  it('ProtocolCodec round-trips requests, responses, errors and notifications', () => {
    const codec = new ProtocolCodec();

    const requestText = codec.encodeRequest(1, MCP_METHODS.ping);
    const request = codec.decode(requestText);
    expect(request.type).toBe('request');
    if (request.type === 'request') {
      expect(request.request.id).toBe(1);
      expect(request.request.method).toBe('ping');
    }

    const responseText = codec.encodeResponse(1, { ok: true });
    const response = codec.decode(responseText);
    expect(response.type).toBe('response');
    if (response.type === 'response') {
      expect(response.response.id).toBe(1);
      expect(response.response.result).toEqual({ ok: true });
    }

    const errorText = codec.encodeError(1, ErrorCodes.METHOD_NOT_FOUND, 'nope');
    const error = codec.decode(errorText);
    expect(error.type).toBe('error');
    if (error.type === 'error') {
      expect(error.error.id).toBe(1);
      expect(error.error.error.code).toBe(ErrorCodes.METHOD_NOT_FOUND);
      expect(error.error.error.message).toBe('nope');
    }

    const notifText = codec.encodeNotification(MCP_METHODS.toolsListChanged);
    const notif = codec.decode(notifText);
    expect(notif.type).toBe('notification');
    if (notif.type === 'notification') {
      expect(notif.notification.method).toBe(MCP_METHODS.toolsListChanged);
    }
  });

  it('ProtocolCodec.serialize + decode round-trips factory-built messages', () => {
    const codec = new ProtocolCodec();
    const messages = [
      createRequestMessage(7, 'tools/list'),
      createResponseMessage(7, { tools: [] }),
      createErrorMessage(7, ErrorCodes.INVALID_PARAMS, 'bad params'),
      createNotificationMessage('notifications/initialized'),
    ];
    for (const message of messages) {
      const text = codec.serialize(message);
      const decoded = codec.decode(text);
      expect(decoded.type).toBe(message.type);
    }
  });

  it('ProtocolCodec.newRequestId is monotonic', () => {
    const codec = new ProtocolCodec(0);
    const first = codec.newRequestId();
    const second = codec.newRequestId();
    const third = codec.newRequestId();
    expect(first).toBe(1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(codec.currentRequestId()).toBe(3);
  });

  it('ProtocolCodec.decode throws on malformed input but tryDecode never throws', () => {
    const codec = createCodec();
    expect(() => codec.decode('{not json')).toThrow(McpProtocolError);
    const frame = codec.tryDecode('{not json');
    expect(frame.ok).toBe(false);
    expect(frame.error).toBeInstanceOf(McpProtocolError);
  });

  it('MCP_METHODS provides the canonical method catalog', () => {
    expect(isMcpMethod('tools/list')).toBe(true);
    expect(isMcpMethod('tools/call')).toBe(true);
    expect(isMcpMethod('nope/method')).toBe(false);
    expect(MCP_METHODS.ping).toBe('ping');
  });

  it('MessageStore appends and filters by type', () => {
    const store = new MessageStore();
    const req = store.appendReceived(createRequestMessage(1, 'ping'));
    const res = store.appendSent(createResponseMessage(2, {}));
    const err = store.appendReceived(createErrorMessage(3, -32601, 'nope'));
    const notif = store.appendSent(createNotificationMessage('notifications/initialized'));

    expect(store.size()).toBe(4);
    expect(req.direction).toBe('received');
    expect(res.direction).toBe('sent');
    expect(store.getByType('request')).toHaveLength(1);
    expect(store.getByType('response')).toHaveLength(1);
    expect(store.getByType('error')).toHaveLength(1);
    expect(store.getByType('notification')).toHaveLength(1);
    expect(store.getRequests()[0].message.type).toBe('request');
    expect(store.findByMethod('ping')).toHaveLength(1);
    expect(store.pendingCount()).toBe(1);
  });

  it('MethodIndex finds messages by method and sequence', () => {
    const index = new MethodIndex();
    index.indexMessage(1, createRequestMessage(1, 'tools/list'));
    index.indexMessage(2, createNotificationMessage('notifications/initialized'));
    index.indexMessage(3, createRequestMessage(2, 'tools/list'));

    expect(index.size()).toBe(3);
    expect(index.findByMethod('tools/list')).toHaveLength(2);
    expect(index.findRequestByMethod('tools/list')).toBeDefined();
    expect(index.findByType('notification')).toHaveLength(1);
    expect(index.get(2)?.type).toBe('notification');
  });

  it('ProtocolLifecycle prunes the store and keeps the index in sync', () => {
    const lifecycle = new ProtocolLifecycle({ maxMessages: 3 });
    for (let i = 0; i < 5; i += 1) {
      lifecycle.send(createRequestMessage(i, 'ping'));
    }
    expect(lifecycle.store.size()).toBe(5);
    expect(lifecycle.index.size()).toBe(5);

    const removed = lifecycle.prune();
    expect(removed).toBe(2);
    expect(lifecycle.store.size()).toBe(3);
    expect(lifecycle.index.size()).toBe(3);
    expect(lifecycle.stats().prunedTotal).toBe(2);

    expect(lifecycle.start()).toBe(lifecycle);
    expect(lifecycle.running).toBe(true);
    expect(lifecycle.stop()).toBe(lifecycle);
    expect(lifecycle.running).toBe(false);
  });
});