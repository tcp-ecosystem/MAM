import { describe, it, expect } from 'vitest';
import { createRule } from '../src/permissions/types.js';
import { PermissionStore } from '../src/permissions/store.js';
import { PermissionChecker } from '../src/permissions/retrieval.js';
import { PermissionLifecycle } from '../src/permissions/lifecycle.js';
import {
  ToolAuthorizer,
  createToolAuthorizer,
  PermissionDeniedError,
} from '../src/permissions/integration.js';

describe('permissions', () => {
  it('PermissionStore adds rules and grants', () => {
    const store = new PermissionStore();
    const rule = store.addRule(createRule({ tool: 'fs.read', effect: 'allow', roles: ['admin'] }));
    expect(rule.id).toBeDefined();
    expect(store.size).toBe(1);
    expect(store.getRule(rule.id)).toBeDefined();

    const granted = store.grant('fs.write', ['admin', 'editor']);
    expect(granted).toHaveLength(1);
    expect(store.size).toBe(2);
    expect(store.stats().allowRules).toBe(2);
  });

  it('PermissionChecker checks and extracts capabilities', () => {
    const store = new PermissionStore();
    store.grant('fs.read', ['admin']);
    const checker = new PermissionChecker(store);

    expect(checker.check({ tool: 'fs.read', roles: ['admin'] }).allowed).toBe(true);
    expect(checker.can({ tool: 'fs.read', roles: ['admin'] })).toBe(true);
    expect(checker.can({ tool: 'fs.read', roles: ['guest'] })).toBe(false);

    const extraction = checker.extractCapabilities({
      name: 'fs.read',
      capabilities: ['filesystem.read'],
      tags: ['read'],
    });
    expect(extraction.capabilities).toContain('filesystem.read');
    expect(extraction.capabilities).toContain('fs.read');
    expect(extraction.provenance.get('filesystem.read')).toBe('declared');
  });

  it('ToolAuthorizer grants, denies, authorizes and changes the default', () => {
    const authz = createToolAuthorizer();
    authz.grant('fs.read', ['admin']);
    expect(authz.check({ tool: 'fs.read', roles: ['admin'] }).allowed).toBe(true);
    expect(authz.can({ tool: 'fs.read', roles: ['admin'] })).toBe(true);

    authz.deny('fs.read', ['admin']);
    expect(authz.can({ tool: 'fs.read', roles: ['admin'] })).toBe(false);
    expect(() => authz.authorize({ tool: 'fs.read', roles: ['admin'] })).toThrow(
      PermissionDeniedError,
    );

    authz.setDefault('allow');
    expect(authz.can({ tool: 'unknown.tool', roles: ['admin'] })).toBe(true);
    expect(authz.defaultPolicy).toBe('allow');
  });

  it('PermissionLifecycle prunes rules', () => {
    const store = new PermissionStore();
    const lifecycle = new PermissionLifecycle({ store });
    const created: Array<ReturnType<typeof lifecycle.grant>[0]> = [];
    created.push(...lifecycle.grant('tool.a', ['admin']));
    created.push(...lifecycle.grant('tool.b', ['admin']));
    created.push(...lifecycle.grant('tool.c', ['admin']));
    expect(lifecycle.size).toBe(3);

    const removed = lifecycle.prune([created[0].id, created[1].id]);
    expect(removed).toBe(2);
    expect(lifecycle.size).toBe(1);
    lifecycle.dispose();
  });
});