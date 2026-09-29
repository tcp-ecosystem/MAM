import { describe, it, expect } from 'vitest';
import { RoleStore } from '../src/authorization/store.js';
import { PermissionIndex } from '../src/authorization/index.js';
import { AccessChecker } from '../src/authorization/retrieval.js';
import { AuthzLifecycle } from '../src/authorization/lifecycle.js';
import { createRole } from '../src/authorization/types.js';
import { createAuthorizer, RbacEngine, AuthorizationError } from '../src/authorization/integration.js';

describe('authorization', () => {
  it('RoleStore defines roles, grants permissions and assigns identities', () => {
    const store = new RoleStore();
    const role = store.defineRole({ name: 'editor', permissions: [{ action: 'write', resource: 'document' }] });
    expect(role.name).toBe('editor');
    expect(store.hasRole('editor')).toBe(true);
    expect(store.grant('editor', { action: 'read', resource: 'document' })).toBe(true);
    expect(store.grant('editor', { action: 'read', resource: 'document' })).toBe(false);
    expect(store.assign('u-1', ['editor'])).toBe(1);
    expect(store.getRolesForIdentity('u-1')).toContain('editor');
    expect(store.listRoles()).toHaveLength(1);
    expect(store.revoke('editor', 'read', 'document')).toBe(1);
  });

  it('AccessChecker checks, can and computes permissionsFor', () => {
    const store = new RoleStore();
    store.defineRole({ name: 'admin', permissions: [{ action: '*', resource: '*' }] });
    const checker = new AccessChecker(store);
    const decision = checker.check({ roles: ['admin'], action: 'delete', resource: 'db' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('granted');
    expect(checker.can({ roles: ['admin'], action: 'invoke', resource: 'lambda' })).toBe(true);
    expect(checker.permissionsFor(['admin'])).toHaveLength(1);

    const denied = checker.check({ roles: ['nobody'], action: 'read', resource: 'x' });
    expect(denied.allowed).toBe(false);
    expect(['unknown-role', 'no-roles']).toContain(denied.reason);
  });

  it('Authorizer check / can / authorize (throws)', () => {
    const authz = createAuthorizer();
    authz.registerRole({ name: 'editor', permissions: [{ action: 'read', resource: 'document' }] });
    authz.assign('u-1', ['editor']);

    expect(authz.can({ identityId: 'u-1', roles: ['editor'], action: 'read', resource: 'document' })).toBe(true);
    const decision = authz.check({ roles: ['editor'], action: 'delete', resource: 'document' });
    expect(decision.allowed).toBe(false);

    expect(() => authz.authorize({ roles: ['editor'], action: 'delete', resource: 'document' })).toThrow(
      AuthorizationError,
    );
    const allowed = authz.authorize({ roles: ['editor'], action: 'read', resource: 'document' });
    expect(allowed.allowed).toBe(true);
    expect(allowed.permission?.action).toBe('read');
  });

  it('RbacEngine enforces requests', () => {
    const engine = new RbacEngine();
    engine.defineRole(createRole('admin', [{ action: '*', resource: '*' }]));
    engine.assign('u-1', ['admin']);
    const decision = engine.enforce({ identityId: 'u-1', roles: ['admin'], action: 'invoke', resource: 'lambda' });
    expect(decision.allowed).toBe(true);
    expect(engine.can({ roles: ['admin'], action: 'read', resource: 'anything' })).toBe(true);
    expect(() => engine.authorize({ roles: ['unknown'], action: 'read', resource: 'x' })).toThrow(AuthorizationError);
    const stats = engine.stats();
    expect(stats.roles).toBe(1);
  });

  it('AuthzLifecycle prunes orphaned roles', () => {
    const store = new RoleStore();
    store.defineRole({ name: 'empty' });
    store.defineRole({ name: 'keeper', permissions: [{ action: 'read', resource: 'x' }] });
    const index = new PermissionIndex();
    const checker = new AccessChecker(store, index);
    const lifecycle = new AuthzLifecycle(store, index, checker);
    const removed = lifecycle.prune();
    expect(removed).toContain('empty');
    expect(removed).not.toContain('keeper');
    expect(store.hasRole('empty')).toBe(false);
    expect(store.hasRole('keeper')).toBe(true);
  });
});