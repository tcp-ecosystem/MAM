/**
 * @fileoverview Auth Service - Production-grade authentication service
 * @module auth-service
 * @version 1.0.0
 * MAM Context: {"Id":"auth-service-mam-001","Name":"auth-service","Version":"1.0.0","Type":"module","Language":"javascript","Runtime":"node","Description":"Authentication service with JWT, OAuth2, sessions, RBAC, audit logging, password hashing, rate limiting, and token refresh","Author":"MAM Generator","License":"MIT","GeneratedAt":"2026-09-17T00:00:00.000Z","Compiler":"mam-compiler","ModuleFormat":"commonjs","Exports":["AuthService","TokenManager","OAuth2Handler","SessionStore","RBACManager","AuditLogger","PasswordHasher","RateLimiter","TokenRefresh"]}
 */
'use strict';

const crypto = require('crypto');

class PasswordHasher {
  constructor(options = {}) {
    this.algorithm = options.algorithm || 'sha256';
    this.iterations = options.iterations || 100000;
    this.keyLength = options.keyLength || 64;
    this.saltLength = options.saltLength || 32;
  }

  async hash(password) {
    const salt = crypto.randomBytes(this.saltLength).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, this.iterations, this.keyLength, this.algorithm);
    return `${salt}:${hash.toString('hex')}`;
  }

  async verify(password, stored) {
    const [salt, hash] = stored.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, this.iterations, this.keyLength, this.algorithm);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), verifyHash);
  }

  generateSalt(length) { return crypto.randomBytes(length || this.saltLength).toString('hex'); }

  hashSync(password) {
    const salt = crypto.randomBytes(this.saltLength).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, this.iterations, this.keyLength, this.algorithm);
    return `${salt}:${hash.toString('hex')}`;
  }
}

class TokenManager {
  constructor(options = {}) {
    this.secret = options.secret || crypto.randomBytes(64).toString('hex');
    this.issuer = options.issuer || 'auth-service';
    this.accessTokenExpiry = options.accessTokenExpiry || 900;
    this.refreshTokenExpiry = options.refreshTokenExpiry || 604800;
    this.blacklist = new Set();
  }

  sign(payload) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = { ...payload, iat: now, exp: now + this.accessTokenExpiry, iss: this.issuer };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  verify(token) {
    if (this.blacklist.has(token)) return { valid: false, payload: null, reason: 'Token blacklisted' };
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return { valid: false, payload: null, reason: 'Invalid token format' };
      const [encodedHeader, encodedPayload, signature] = parts;
      const expectedSig = crypto.createHmac('sha256', this.secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
      if (signature !== expectedSig) return { valid: false, payload: null, reason: 'Invalid signature' };
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return { valid: false, payload, reason: 'Token expired' };
      if (payload.iss && payload.iss !== this.issuer) return { valid: false, payload, reason: 'Invalid issuer' };
      return { valid: true, payload, reason: null };
    } catch (error) { return { valid: false, payload: null, reason: error.message }; }
  }

  decode(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      return { header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()), payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString()) };
    } catch { return null; }
  }

  blacklistToken(token) { this.blacklist.add(token); }
  isBlacklisted(token) { return this.blacklist.has(token); }
  clearBlacklist() { this.blacklist.clear(); }

  generateRefreshToken(payload) {
    const now = Math.floor(Date.now() / 1000);
    const tokenPayload = { ...payload, type: 'refresh', iat: now, exp: now + this.refreshTokenExpiry, jti: crypto.randomUUID() };
    return this.sign(tokenPayload);
  }
}

class OAuth2Handler {
  constructor(options = {}) {
    this.providers = new Map();
    this.clientId = options.clientId || '';
    this.clientSecret = options.clientSecret || '';
    this.redirectUri = options.redirectUri || '';
    this.tokenManager = options.tokenManager || new TokenManager();
    this.userMapper = options.userMapper || this._defaultUserMapper;
  }

  registerProvider(name, config) {
    this.providers.set(name, {
      name,
      authorizeUrl: config.authorizeUrl,
      tokenUrl: config.tokenUrl,
      userInfoUrl: config.userInfoUrl,
      scope: config.scope || 'openid profile email',
      ...config,
    });
    return this;
  }

  getAuthorizationUrl(providerName, state) {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider ${providerName} not registered`);
    const params = new URLSearchParams({
      client_id: provider.clientId || this.clientId,
      redirect_uri: provider.redirectUri || this.redirectUri,
      response_type: 'code',
      scope: provider.scope,
      state: state || crypto.randomUUID(),
    });
    return `${provider.authorizeUrl}?${params.toString()}`;
  }

  async exchangeCode(providerName, code) {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider ${providerName} not registered`);
    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: provider.clientId || this.clientId,
        client_secret: provider.clientSecret || this.clientSecret,
        redirect_uri: provider.redirectUri || this.redirectUri,
      }),
    });
    if (!response.ok) throw new Error(`Token exchange failed: ${response.statusText}`);
    return response.json();
  }

  async getUserInfo(providerName, accessToken) {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider ${providerName} not registered`);
    const response = await fetch(provider.userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`Failed to get user info: ${response.statusText}`);
    return response.json();
  }

  async authenticate(providerName, code) {
    const tokenData = await this.exchangeCode(providerName, code);
    const userInfo = await this.getUserInfo(providerName, tokenData.access_token);
    const mappedUser = this.userMapper(userInfo, providerName);
    const appToken = this.tokenManager.sign({ sub: mappedUser.id, email: mappedUser.email, provider: providerName, roles: mappedUser.roles || ['user'] });
    return { user: mappedUser, accessToken: appToken, providerToken: tokenData };
  }

  _defaultUserMapper(userInfo, provider) {
    return {
      id: userInfo.sub || userInfo.id || crypto.randomUUID(),
      email: userInfo.email,
      name: userInfo.name || userInfo.login || `${userInfo.given_name || ''} ${userInfo.family_name || ''}`.trim(),
      avatar: userInfo.picture || userInfo.avatar_url,
      provider,
      roles: ['user'],
    };
  }

  getProviderNames() { return Array.from(this.providers.keys()); }
  hasProvider(name) { return this.providers.has(name); }
}

class SessionStore {
  constructor(options = {}) {
    this.sessions = new Map();
    this.ttl = options.ttl || 3600000;
    this.maxSessions = options.maxSessions || 10000;
    this.cleanupInterval = setInterval(() => this.cleanup(), this.ttl / 2);
  }

  create(userId, data = {}) {
    const id = crypto.randomUUID();
    const session = { id, userId, data, createdAt: Date.now(), expiresAt: Date.now() + this.ttl, lastAccess: Date.now() };
    this.sessions.set(id, session);
    if (this.sessions.size > this.maxSessions) this._evictOldest();
    return session;
  }

  get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) { this.sessions.delete(sessionId); return null; }
    session.lastAccess = Date.now();
    return session;
  }

  update(sessionId, data) {
    const session = this.get(sessionId);
    if (!session) return null;
    session.data = { ...session.data, ...data };
    this.sessions.set(sessionId, session);
    return session;
  }

  destroy(sessionId) { this.sessions.delete(sessionId); }

  destroyAllForUser(userId) {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(id);
    }
  }

  getAllForUser(userId) {
    const sessions = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId && Date.now() <= session.expiresAt) sessions.push(session);
    }
    return sessions;
  }

  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) this.sessions.delete(id);
    }
  }

  _evictOldest() {
    let oldest = null;
    for (const session of this.sessions.values()) {
      if (!oldest || session.lastAccess < oldest.lastAccess) oldest = session;
    }
    if (oldest) this.sessions.delete(oldest.id);
  }

  getSize() { return this.sessions.size; }
  destroy() { clearInterval(this.cleanupInterval); this.sessions.clear(); }
}

class RBACManager {
  constructor(options = {}) {
    this.roles = new Map();
    this.permissions = new Map();
    this.userRoles = new Map();
    this.roleHierarchy = new Map();
    this.defaultRole = options.defaultRole || 'user';
    this._setupDefaults();
  }

  _setupDefaults() {
    this.createRole('admin', ['*']);
    this.createRole('manager', ['read', 'write', 'delete', 'manage_users']);
    this.createRole('user', ['read', 'write']);
    this.createRole('guest', ['read']);
    this.roleHierarchy.set('admin', ['manager']);
    this.roleHierarchy.set('manager', ['user']);
    this.roleHierarchy.set('user', ['guest']);
  }

  createRole(name, permissions) {
    this.roles.set(name, { name, permissions, createdAt: Date.now() });
    permissions.forEach(p => {
      if (!this.permissions.has(p)) this.permissions.set(p, new Set());
      this.permissions.get(p).add(name);
    });
    return this;
  }

  deleteRole(name) {
    this.roles.delete(name);
    for (const [perm, roles] of this.permissions) { roles.delete(name); if (roles.size === 0) this.permissions.delete(perm); }
    this.roleHierarchy.delete(name);
    return this;
  }

  assignRole(userId, roleName) {
    if (!this.roles.has(roleName)) throw new Error(`Role ${roleName} does not exist`);
    if (!this.userRoles.has(userId)) this.userRoles.set(userId, new Set());
    this.userRoles.get(userId).add(roleName);
    return this;
  }

  revokeRole(userId, roleName) {
    const roles = this.userRoles.get(userId);
    if (roles) roles.delete(roleName);
    return this;
  }

  getUserRoles(userId) { return Array.from(this.userRoles.get(userId) || []); }

  getEffectivePermissions(userId) {
    const perms = new Set();
    const roles = this.getUserRoles(userId);
    for (const role of roles) {
      const roleData = this.roles.get(role);
      if (roleData) roleData.permissions.forEach(p => perms.add(p));
      const inherited = this.roleHierarchy.get(role) || [];
      for (const parentRole of inherited) {
        const parentData = this.roles.get(parentRole);
        if (parentData) parentData.permissions.forEach(p => perms.add(p));
      }
    }
    return Array.from(perms);
  }

  hasPermission(userId, permission) {
    const perms = this.getEffectivePermissions(userId);
    if (perms.includes('*')) return true;
    return perms.includes(permission);
  }

  hasRole(userId, role) { return this.getUserRoles(userId).includes(role); }

  addHierarchy(childRole, parentRoles) {
    const existing = this.roleHierarchy.get(childRole) || [];
    this.roleHierarchy.set(childRole, [...new Set([...existing, ...parentRoles])]);
    return this;
  }

  middleware(requiredPermission) {
    return (req, res, next) => {
      if (!req.auth || !req.auth.payload || !req.auth.payload.sub) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (!this.hasPermission(req.auth.payload.sub, requiredPermission)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    };
  }

  getRoles() { return Array.from(this.roles.keys()); }
  getPermissions() { return Array.from(this.permissions.keys()); }
}

class AuditLogger {
  constructor(options = {}) {
    this.events = [];
    this.maxEvents = options.maxEvents || 10000;
    this.logger = options.logger || console;
    this.hooks = [];
  }

  log(event) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.events.push(entry);
    if (this.events.length > this.maxEvents) this.events.shift();
    this.logger.log(`[AUDIT] ${entry.action} by ${entry.userId || 'system'}: ${JSON.stringify(entry.details || {})}`);
    this.hooks.forEach(h => { try { h(entry); } catch (e) { /* ignore hook errors */ } });
    return entry;
  }

  addHook(fn) { this.hooks.push(fn); return this; }

  login(userId, ip, userAgent) { return this.log({ action: 'LOGIN', userId, ip, userAgent, details: { success: true } }); }
  loginFailed(email, ip, reason) { return this.log({ action: 'LOGIN_FAILED', userId: null, ip, details: { email, reason } }); }
  logout(userId, ip) { return this.log({ action: 'LOGOUT', userId, ip }); }
  tokenRefresh(userId) { return this.log({ action: 'TOKEN_REFRESH', userId }); }
  passwordChange(userId) { return this.log({ action: 'PASSWORD_CHANGE', userId }); }
  roleAssigned(userId, targetUser, role) { return this.log({ action: 'ROLE_ASSIGNED', userId, details: { targetUser, role } }); }
  roleRevoked(userId, targetUser, role) { return this.log({ action: 'ROLE_REVOKED', userId, details: { targetUser, role } }); }
  unauthorizedAccess(userId, resource) { return this.log({ action: 'UNAUTHORIZED_ACCESS', userId, details: { resource } }); }
  custom(action, userId, details) { return this.log({ action, userId, details }); }

  getEvents(filters = {}) {
    let events = [...this.events];
    if (filters.userId) events = events.filter(e => e.userId === filters.userId);
    if (filters.action) events = events.filter(e => e.action === filters.action);
    if (filters.since) events = events.filter(e => new Date(e.timestamp) >= new Date(filters.since));
    if (filters.limit) events = events.slice(-filters.limit);
    return events;
  }

  clear() { this.events = []; }
  getCount() { return this.events.length; }
}

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000;
    this.maxRequests = options.maxRequests || 100;
    this.keyPrefix = options.keyPrefix || 'rl:';
    this.store = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
  }

  getKey(identifier) { return `${this.keyPrefix}${identifier}`; }

  check(identifier) {
    const key = this.getKey(identifier);
    const now = Date.now();
    const windowStart = now - this.windowMs;
    if (!this.store.has(key)) this.store.set(key, []);
    const requests = this.store.get(key).filter(ts => ts > windowStart);
    this.store.set(key, requests);
    const remaining = Math.max(0, this.maxRequests - requests.length);
    const resetAt = Math.ceil((windowStart + this.windowMs) / 1000);
    if (requests.length >= this.maxRequests) return { allowed: false, remaining: 0, resetAt };
    requests.push(now);
    return { allowed: true, remaining: remaining - 1, resetAt };
  }

  getHeaders(identifier) {
    const result = this.check(identifier);
    return { 'X-RateLimit-Limit': this.maxRequests, 'X-RateLimit-Remaining': result.remaining, 'X-RateLimit-Reset': result.resetAt };
  }

  middleware() {
    return (req, res, next) => {
      const id = req.ip || req.connection.remoteAddress || 'unknown';
      res.set(this.getHeaders(id));
      const result = this.check(id);
      if (!result.allowed) return res.status(429).json({ error: 'Too many requests' });
      next();
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [key, requests] of this.store.entries()) {
      const valid = requests.filter(ts => ts > now - this.windowMs);
      if (valid.length === 0) this.store.delete(key); else this.store.set(key, valid);
    }
  }

  reset(identifier) { this.store.delete(this.getKey(identifier)); }
  destroy() { clearInterval(this.cleanupInterval); this.store.clear(); }
}

class TokenRefresh {
  constructor(options = {}) {
    this.tokenManager = options.tokenManager || new TokenManager();
    this.sessionStore = options.sessionStore || new SessionStore();
    this.refreshTokens = new Map();
    this.maxRefreshTokens = options.maxRefreshTokens || 10000;
  }

  generateRefreshToken(userId, payload) {
    const token = this.tokenManager.generateRefreshToken(payload);
    const tokenId = crypto.randomUUID();
    this.refreshTokens.set(tokenId, { token, userId, createdAt: Date.now(), used: false });
    if (this.refreshTokens.size > this.maxRefreshTokens) this._evictOldest();
    return { refreshToken: token, tokenId };
  }

  async refresh(refreshToken, accessToken) {
    const result = this.tokenManager.verify(refreshToken);
    if (!result.valid) return { success: false, error: result.reason };
    if (result.payload.type !== 'refresh') return { success: false, error: 'Not a refresh token' };

    let tokenId = null;
    for (const [id, data] of this.refreshTokens) {
      if (data.token === refreshToken) { tokenId = id; break; }
    }
    if (!tokenId) return { success: false, error: 'Refresh token not found' };

    const stored = this.refreshTokens.get(tokenId);
    if (stored.used) {
      this.refreshTokens.delete(tokenId);
      return { success: false, error: 'Refresh token already used (possible theft)' };
    }

    stored.used = true;
    const newPayload = { sub: result.payload.sub, email: result.payload.email, roles: result.payload.roles };
    const newAccessToken = this.tokenManager.sign(newPayload);
    const newRefreshData = this.generateRefreshToken(result.payload.sub, newPayload);

    this.tokenManager.blacklistToken(accessToken);
    return { success: true, accessToken: newAccessToken, refreshToken: newRefreshData.refreshToken };
  }

  revokeRefreshToken(tokenId) { this.refreshTokens.delete(tokenId); }
  revokeAllForUser(userId) {
    for (const [id, data] of this.refreshTokens) {
      if (data.userId === userId) this.refreshTokens.delete(id);
    }
  }

  _evictOldest() {
    let oldest = null;
    for (const [id, data] of this.refreshTokens) {
      if (!oldest || data.createdAt < oldest.createdAt) oldest = { id, ...data };
    }
    if (oldest) this.refreshTokens.delete(oldest.id);
  }

  getActiveCount() { return this.refreshTokens.size; }
}

class AuthService {
  constructor(options = {}) {
    this.passwordHasher = new PasswordHasher(options.password);
    this.tokenManager = new TokenManager(options.token);
    this.oauth2 = new OAuth2Handler({ ...options.oauth2, tokenManager: this.tokenManager });
    this.sessionStore = new SessionStore(options.session);
    this.rbac = new RBACManager(options.rbac);
    this.audit = new AuditLogger(options.audit);
    this.rateLimiter = new RateLimiter(options.rateLimit);
    this.tokenRefresh = new TokenRefresh({ tokenManager: this.tokenManager, sessionStore: this.sessionStore });
    this.users = new Map();
  }

  async register(email, password, name) {
    if (this.findUserByEmail(email)) throw new Error('User already exists');
    const id = crypto.randomUUID();
    const hashedPassword = await this.passwordHasher.hash(password);
    const user = { id, email, name, password: hashedPassword, roles: [this.rbac.defaultRole], createdAt: Date.now(), verified: false };
    this.users.set(id, user);
    this.rbac.assignRole(id, this.rbac.defaultRole);
    this.audit.log({ action: 'REGISTER', userId: id, details: { email } });
    return this._sanitizeUser(user);
  }

  async login(email, password, ip, userAgent) {
    const user = this.findUserByEmail(email);
    if (!user) { this.audit.loginFailed(email, ip, 'User not found'); throw new Error('Invalid credentials'); }
    const valid = await this.passwordHasher.verify(password, user.password);
    if (!valid) { this.audit.loginFailed(email, ip, 'Invalid password'); throw new Error('Invalid credentials'); }
    const roles = this.rbac.getUserRoles(user.id);
    const accessToken = this.tokenManager.sign({ sub: user.id, email: user.email, roles });
    const { refreshToken } = this.tokenRefresh.generateRefreshToken(user.id, { sub: user.id, email: user.email, roles });
    const session = this.sessionStore.create(user.id, { ip, userAgent });
    this.audit.login(user.id, ip, userAgent);
    return { user: this._sanitizeUser(user), accessToken, refreshToken, sessionId: session.id };
  }

  async logout(sessionId, userId, ip) {
    this.sessionStore.destroy(sessionId);
    this.tokenRefresh.revokeAllForUser(userId);
    this.audit.logout(userId, ip);
  }

  async refreshTokens(refreshToken, accessToken) {
    const result = await this.tokenRefresh.refresh(refreshToken, accessToken);
    if (result.success) this.audit.tokenRefresh(this.tokenManager.verify(accessToken).payload?.sub);
    return result;
  }

  findUserByEmail(email) { for (const user of this.users.values()) { if (user.email === email) return user; } return null; }
  findUserById(id) { return this.users.get(id) || null; }

  async updatePassword(userId, oldPassword, newPassword) {
    const user = this.users.get(userId);
    if (!user) throw new Error('User not found');
    const valid = await this.passwordHasher.verify(oldPassword, user.password);
    if (!valid) throw new Error('Invalid current password');
    user.password = await this.passwordHasher.hash(newPassword);
    this.audit.passwordChange(userId);
    return true;
  }

  async oauth2Authenticate(provider, code) { return this.oauth2.authenticate(provider, code); }

  _sanitizeUser(user) {
    const { password, ...safe } = user;
    return safe;
  }

  middleware() {
    return (req, res, next) => {
      const apiKey = req.headers['x-api-key'];
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const result = this.tokenManager.verify(token);
        if (result.valid) { req.auth = { type: 'jwt', payload: result.payload }; return next(); }
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      return res.status(401).json({ error: 'Authentication required' });
    };
  }

  rbacMiddleware(permission) { return this.rbac.middleware(permission); }

  getStats() {
    return {
      users: this.users.size,
      sessions: this.sessionStore.getSize(),
      refreshTokens: this.tokenRefresh.getActiveCount(),
      auditEvents: this.audit.getCount(),
      roles: this.rbac.getRoles(),
      permissions: this.rbac.getPermissions(),
    };
  }
}

if (require.main === module) {
  const auth = new AuthService({ token: { secret: 'dev-secret-change-in-production' } });
  (async () => {
    const user = await auth.register('user@example.com', 'SecureP@ss123', 'Test User');
    console.log('Registered:', user);
    const loginResult = await auth.login('user@example.com', 'SecureP@ss123', '127.0.0.1', 'Mozilla/5.0');
    console.log('Logged in:', { userId: loginResult.user.id, hasAccessToken: !!loginResult.accessToken });
    const refreshResult = await auth.refreshTokens(loginResult.refreshToken, loginResult.accessToken);
    console.log('Refreshed:', refreshResult.success);
    console.log('Stats:', auth.getStats());
  })();
}

module.exports = { AuthService, TokenManager, OAuth2Handler, SessionStore, RBACManager, AuditLogger, PasswordHasher, RateLimiter, TokenRefresh };
