import { describe, it, expect } from 'vitest';
import { IdentityStore } from '../src/auth/store.js';
import { CredentialVerifier } from '../src/auth/retrieval.js';
import { AuthLifecycle } from '../src/auth/lifecycle.js';
import { createAuthenticator } from '../src/auth/integration.js';

// Deterministic entropy provider. `verifyApiKey`/`verifyToken` re-hash the
// presented secret with the same salt the issuing call used, so both must
// share one fixed RNG for round-trips to match.
const fixedRng = () => Buffer.alloc(32, 1);

describe('auth', () => {
  it('IdentityStore registers and removes identities', () => {
    const store = new IdentityStore();
    const identity = store.registerIdentity({ name: 'alice', roles: ['admin'] });
    expect(identity.id).toBeDefined();
    expect(identity.type).toBe('user');
    expect(store.has(identity.id)).toBe(true);
    expect(store.get(identity.id)?.name).toBe('alice');
    expect(store.size()).toBe(1);
    expect(store.removeIdentity(identity.id)).toBe(true);
    expect(store.has(identity.id)).toBe(false);
    expect(store.removeIdentity(identity.id)).toBe(false);
  });

  it('CredentialVerifier hashes and verifies secrets', () => {
    const verifier = new CredentialVerifier();
    const digest = verifier.hashSecret('correct-horse');
    expect(digest.startsWith('sha256$')).toBe(true);
    expect(verifier.verifySecret('correct-horse', digest)).toBe(true);
    expect(verifier.verifySecret('wrong', digest)).toBe(false);
  });

  it('CredentialVerifier issues and verifies API keys', () => {
    const verifier = new CredentialVerifier({ randomBytes: fixedRng });
    const issued = verifier.createApiKey('u-1', { label: 'ci', ttlMs: 60_000 });
    expect(issued.secret.startsWith('mam_ak_')).toBe(true);
    expect(issued.record.identityId).toBe('u-1');
    expect(issued.record.hash).toBeDefined();
    const verified = verifier.verifyApiKey(issued.secret);
    expect(verified?.identityId).toBe('u-1');
    expect(verified?.key).toBe('');
    expect(verifier.verifyApiKey('mam_ak_bogusvalue00000000')).toBeUndefined();
  });

  it('Authenticator registers identities and authenticates API keys', () => {
    const auth = createAuthenticator({}, { randomBytes: fixedRng });
    const alice = auth.registerIdentity({ name: 'alice', roles: ['admin'] });
    const key = auth.createApiKey(alice.id, { label: 'ci' });
    expect(key).not.toBeNull();
    const result = auth.authenticateApiKey(key!.secret);
    expect(result?.identity.id).toBe(alice.id);
    expect(auth.authenticateApiKey('nope')).toBeNull();
    expect(auth.unregisterIdentity(alice.id)).toBe(true);
    expect(auth.authenticateApiKey(key!.secret)).toBeNull();
  });

  it('Authenticator login, authenticateToken, current and logout', () => {
    const auth = createAuthenticator({}, { randomBytes: fixedRng });
    const alice = auth.registerIdentity({ name: 'alice' });
    const login = auth.login(alice.id);
    expect(login).not.toBeNull();
    expect(login!.secret.startsWith('mam_tk_')).toBe(true);

    const result = auth.authenticateToken(login!.secret);
    expect(result?.identity.id).toBe(alice.id);
    expect(result?.session).toBeDefined();

    const current = auth.current(alice.id);
    expect(current).not.toBeNull();
    expect(current!.sessions.length).toBeGreaterThan(0);
    expect(current!.tokens.length).toBe(1);

    expect(auth.logout(login!.token.id)).toBe(true);
    expect(auth.authenticateToken(login!.secret)).toBeNull();
    expect(auth.current(alice.id)?.sessions).toHaveLength(0);
  });

  it('Authenticator prune sweeps expired tokens', () => {
    const auth = createAuthenticator({}, { randomBytes: fixedRng });
    const alice = auth.registerIdentity({ name: 'alice' });
    const login = auth.login(alice.id, { ttlMs: -1000 });
    expect(login).not.toBeNull();
    const result = auth.prune();
    expect(result.tokens).toBeGreaterThan(0);
    expect(auth.authenticateToken(login!.secret)).toBeNull();
  });

  it('AuthLifecycle starts, stops and prunes', () => {
    const verifier = new CredentialVerifier();
    const lifecycle = new AuthLifecycle({ verifier });
    verifier.issueToken('u-1', { ttlMs: -1000 });
    const result = lifecycle.pruneExpired();
    expect(result.tokens).toBe(1);
    expect(result.apiKeys).toBe(0);

    expect(lifecycle.isRunning()).toBe(false);
    expect(lifecycle.start()).toBe(true);
    expect(lifecycle.isRunning()).toBe(true);
    expect(lifecycle.stop()).toBe(true);
    expect(lifecycle.isRunning()).toBe(false);
    lifecycle.dispose();
  });
});