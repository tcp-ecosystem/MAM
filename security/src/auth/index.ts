/**
 * index.ts
 *
 * `AuthIndex` — an in-memory query index over identities and their tokens.
 *
 * While {@link ../store} owns the canonical identity registry and
 * {@link ../retrieval} owns credential digests, the index exists to answer
 * high-frequency structural questions cheaply:
 *
 *  - "which identities carry role `admin`?"
 *  - "which identities are of type `service`?"
 *  - "is this token live, and who owns it?"
 *
 * Every secondary index (by role, by type, by token, by identity) is
 * maintained eagerly on write and rebuilt wholesale by {@link AuthIndex.rebuild}
 * when a caller prefers a single bulk pass. The index is kept fully
 * serializable so warm-start scenarios can hydrate it from disk.
 *
 * @module auth/index
 */

import {
  type AuthStats,
  type AuthToken,
  type Identity,
  type IdentityType,
  createEmptyStats,
  isAuthToken,
  isIdentity,
  isIdentityType,
  isValidId,
} from './types.js';

/** Version tag embedded in {@link AuthIndex.toJSON} output. */
export const AUTH_INDEX_SCHEMA_VERSION = 1;

/** Serialized shape produced by {@link AuthIndex.toJSON}. */
export interface AuthIndexSnapshot {
  schemaVersion: number;
  identities: Identity[];
  tokens: AuthToken[];
}

/**
 * Per-secondary-index counters surfaced by {@link AuthIndex.stats}.
 */
export interface AuthIndexStats {
  identities: number;
  tokens: number;
  roles: number;
  roleEntries: number;
  typeEntries: number;
}

/**
 * An eager multi-map index for identities and auth tokens.
 *
 * Structures:
 *  - `identities`: token of truth for indexed identity records.
 *  - `byRole`:     role label -> set of identity ids.
 *  - `byType`:     identity type -> set of identity ids.
 *  - `tokens`:     token id -> token record.
 *  - `tokenByIdentity`: identity id -> set of token ids.
 *
 * All lookups are O(1) to O(k) (k = fan-out of the queried key); no linear
 * scans are performed for the named accessors.
 */
export class AuthIndex {
  private readonly identities: Map<string, Identity> = new Map();
  private readonly byRole: Map<string, Set<string>> = new Map();
  private readonly byType: Map<IdentityType, Set<string>> = new Map();
  private readonly tokens: Map<string, AuthToken> = new Map();
  private readonly tokenByIdentity: Map<string, Set<string>> = new Map();

  /**
   * @param options Optional initial identities and tokens to index eagerly.
   */
  constructor(options: { identities?: readonly Identity[]; tokens?: readonly AuthToken[] } = {}) {
    if (options.identities) {
      for (const identity of options.identities) this.indexIdentity(identity);
    }
    if (options.tokens) {
      for (const token of options.tokens) this.indexToken(token);
    }
  }

  /**
   * Indexes an identity, inserting the id into every relevant role/type
   * bucket. Re-indexing an existing id replaces its prior record and prunes
   * stale role buckets from the previous role set.
   *
   * @param identity Identity record to index.
   */
  indexIdentity(identity: Identity): void {
    if (!isIdentity(identity) || !isValidId(identity.id)) {
      throw new TypeError('Cannot index an invalid identity');
    }
    const previous = this.identities.get(identity.id);
    if (previous) {
      for (const role of previous.roles) this.removeFromSet(this.byRole, role, identity.id);
    }
    this.identities.set(identity.id, identity);
    for (const role of identity.roles) this.addToSet(this.byRole, role, identity.id);
    if (isIdentityType(identity.type)) this.addToSet(this.byType, identity.type, identity.id);
  }

  /**
   * Removes an identity and every token indexed against it. Returns the number
   * of token records removed alongside the identity (0 when absent).
   *
   * @param id Identity id to unindex.
   * @returns Number of tokens removed with the identity.
   */
  removeIdentity(id: string): number {
    if (!isValidId(id)) return 0;
    const identity = this.identities.get(id);
    if (!identity) return 0;
    for (const role of identity.roles) this.removeFromSet(this.byRole, role, id);
    if (isIdentityType(identity.type)) this.removeFromSet(this.byType, identity.type, id);
    this.identities.delete(id);
    let removed = 0;
    const tokenIds = this.tokenByIdentity.get(id);
    if (tokenIds) {
      for (const tokenId of tokenIds) {
        this.tokens.delete(tokenId);
        removed += 1;
      }
      this.tokenByIdentity.delete(id);
    }
    return removed;
  }

  /**
   * Indexes a token under its id and its owning identity.
   *
   * @param token Token record to index.
   */
  indexToken(token: AuthToken): void {
    if (!isAuthToken(token) || !isValidId(token.id) || !isValidId(token.identityId)) {
      throw new TypeError('Cannot index an invalid token');
    }
    this.tokens.set(token.id, token);
    this.addToSet(this.tokenByIdentity, token.identityId, token.id);
  }

  /**
   * Removes a token from the index by id.
   *
   * @param tokenId Token id to unindex.
   * @returns `true` when a token was actually removed.
   */
  removeToken(tokenId: string): boolean {
    if (!isValidId(tokenId)) return false;
    const token = this.tokens.get(tokenId);
    if (!token) return false;
    this.tokens.delete(tokenId);
    this.removeFromSet(this.tokenByIdentity, token.identityId, tokenId);
    return true;
  }

  /**
   * Returns whether a token id is currently indexed.
   *
   * @param tokenId Token id to check.
   * @returns `true` when present.
   */
  hasToken(tokenId: string): boolean {
    return isValidId(tokenId) && this.tokens.has(tokenId);
  }

  /**
   * Looks up a token record by its id.
   *
   * @param tokenId Token id.
   * @returns The token record, or `undefined`.
   */
  findToken(tokenId: string): AuthToken | undefined {
    return isValidId(tokenId) ? this.tokens.get(tokenId) : undefined;
  }

  /**
   * Looks up an identity record by id.
   *
   * @param id Identity id.
   * @returns The identity, or `undefined`.
   */
  findByIdentity(id: string): Identity | undefined {
    return isValidId(id) ? this.identities.get(id) : undefined;
  }

  /**
   * Lists every indexed identity carrying a given role.
   *
   * @param role Role label (exact match).
   * @returns Array of matching identities.
   */
  findByRole(role: string): Identity[] {
    const normalized = typeof role === 'string' ? role.trim() : '';
    if (normalized.length === 0) return [];
    const ids = this.byRole.get(normalized);
    if (!ids) return [];
    const out: Identity[] = [];
    for (const id of ids) {
      const identity = this.identities.get(id);
      if (identity) out.push(identity);
    }
    return out;
  }

  /**
   * Lists every indexed identity of a given type.
   *
   * @param type Identity type to match.
   * @returns Array of matching identities.
   */
  findByType(type: IdentityType): Identity[] {
    if (!isIdentityType(type)) return [];
    const ids = this.byType.get(type);
    if (!ids) return [];
    const out: Identity[] = [];
    for (const id of ids) {
      const identity = this.identities.get(id);
      if (identity) out.push(identity);
    }
    return out;
  }

  /**
   * Lists every token owned by an identity, in insertion order.
   *
   * @param identityId Owning identity id.
   * @returns Array of token records (empty when none).
   */
  findTokensByIdentity(identityId: string): AuthToken[] {
    if (!isValidId(identityId)) return [];
    const ids = this.tokenByIdentity.get(identityId);
    if (!ids) return [];
    const out: AuthToken[] = [];
    for (const tokenId of ids) {
      const token = this.tokens.get(tokenId);
      if (token) out.push(token);
    }
    return out;
  }

  /**
   * Returns all unique role labels currently indexed.
   *
   * @returns Array of role labels.
   */
  roles(): string[] {
    return Array.from(this.byRole.keys());
  }

  /**
   * Returns the ids of every identity currently indexed.
   *
   * @returns Array of identity ids.
   */
  identityIds(): string[] {
    return Array.from(this.identities.keys());
  }

  /**
   * Returns the ids of every token currently indexed.
   *
   * @returns Array of token ids.
   */
  tokenIds(): string[] {
    return Array.from(this.tokens.keys());
  }

  /**
   * Rebuilds the entire index from authoritative identity and token arrays.
   * All prior index state is discarded first. Call this after loading a
   * snapshot or bulk-importing data to guarantee consistency.
   *
   * @param identities Authoritative identity records.
   * @param tokens Authoritative token records.
   */
  rebuild(identities: readonly Identity[], tokens: readonly AuthToken[] = []): void {
    this.clear();
    for (const identity of identities) this.indexIdentity(identity);
    for (const token of tokens) this.indexToken(token);
  }

  /**
   * Clears every index structure without touching any external store.
   *
   * @returns The number of entries (identities + tokens) removed.
   */
  clear(): number {
    const count = this.identities.size + this.tokens.size;
    this.identities.clear();
    this.byRole.clear();
    this.byType.clear();
    this.tokens.clear();
    this.tokenByIdentity.clear();
    return count;
  }

  /**
   * Returns the identity id for a given token id (or `undefined`).
   *
   * @param tokenId Token id.
   * @returns Owning identity id, or `undefined`.
   */
  ownerOf(tokenId: string): string | undefined {
    return this.findToken(tokenId)?.identityId;
  }

  /**
   * Counts how many distinct identities hold a given role.
   *
   * @param role Role label.
   * @returns Fan-out count for the role (0 when unknown).
   */
  countByRole(role: string): number {
    return this.byRole.get(typeof role === 'string' ? role.trim() : '')?.size ?? 0;
  }

  /**
   * Counts how many distinct identities share a given type.
   *
   * @param type Identity type.
   * @returns Fan-out count for the type (0 when unknown).
   */
  countByType(type: IdentityType): number {
    if (!isIdentityType(type)) return 0;
    return this.byType.get(type)?.size ?? 0;
  }

  /**
   * Produces structural statistics for the index.
   *
   * @returns {@link AuthIndexStats} describing the current index state.
   */
  indexStats(): AuthIndexStats {
    let roleEntries = 0;
    for (const ids of this.byRole.values()) roleEntries += ids.size;
    let typeEntries = 0;
    for (const ids of this.byType.values()) typeEntries += ids.size;
    return {
      identities: this.identities.size,
      tokens: this.tokens.size,
      roles: this.byRole.size,
      roleEntries,
      typeEntries,
    };
  }

  /**
   * Computes an {@link AuthStats} snapshot compatible with the rest of the
   * auth engine (identity and token counts merged over `base`).
   *
   * @param base Optional starting stats.
   * @returns A fresh {@link AuthStats} object.
   */
  stats(base: AuthStats = createEmptyStats()): AuthStats {
    let activeIdentities = 0;
    for (const identity of this.identities.values()) {
      if (identity.active !== false) activeIdentities += 1;
    }
    let activeTokens = 0;
    for (const token of this.tokens.values()) {
      if (!token.revoked) activeTokens += 1;
    }
    return {
      ...base,
      identities: this.identities.size,
      activeIdentities,
      tokens: this.tokens.size,
      activeTokens,
    };
  }

  /**
   * Serializes the index to a versioned snapshot safe for persistence.
   *
   * @returns A plain snapshot object.
   */
  toJSON(): AuthIndexSnapshot {
    return {
      schemaVersion: AUTH_INDEX_SCHEMA_VERSION,
      identities: Array.from(this.identities.values()),
      tokens: Array.from(this.tokens.values()),
    };
  }

  /**
   * Replaces the entire index with the contents of a snapshot produced by
   * {@link AuthIndex.toJSON} (or a structurally compatible object).
   *
   * @param snapshot Serialized index data.
   * @returns The number of entries loaded (identities + tokens).
   */
  fromJSON(snapshot: unknown): number {
    if (!isAuthIndexSnapshot(snapshot)) {
      throw new TypeError('Invalid auth index snapshot');
    }
    this.clear();
    for (const identity of snapshot.identities) this.indexIdentity(identity);
    for (const token of snapshot.tokens) this.indexToken(token);
    return snapshot.identities.length + snapshot.tokens.length;
  }

  /**
   * Returns an iterator over all indexed identity records.
   *
   * @returns An iterator over identities.
   */
  [Symbol.iterator](): IterableIterator<Identity> {
    return this.identities.values();
  }

  /**
   * Returns an iterator over all indexed token records.
   *
   * @returns An iterator over tokens.
   */
  tokensIterator(): IterableIterator<AuthToken> {
    return this.tokens.values();
  }

  private addToSet(map: Map<string, Set<string>>, key: string, value: string): void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(value);
  }

  private removeFromSet(map: Map<string, Set<string>>, key: string, value: string): void {
    const set = map.get(key);
    if (!set) return;
    set.delete(value);
    if (set.size === 0) map.delete(key);
  }
}

/**
 * Structural guard for {@link AuthIndexSnapshot}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value looks like a serialized auth index.
 */
export function isAuthIndexSnapshot(value: unknown): value is AuthIndexSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== AUTH_INDEX_SCHEMA_VERSION) return false;
  if (!Array.isArray(candidate.identities) || !Array.isArray(candidate.tokens)) return false;
  return true;
}

/**
 * Convenience factory for an index hydrated from a snapshot.
 *
 * @param snapshot Serialized index data.
 * @returns A configured {@link AuthIndex}.
 */
export function indexFromJSON(snapshot: unknown): AuthIndex {
  const index = new AuthIndex();
  index.fromJSON(snapshot);
  return index;
}