/**
 * @fileoverview API Gateway - Production-grade REST API gateway
 * @module api-gateway
 * @version 1.0.0
 * MAM Context: {"Id":"api-gateway-mam-001","Name":"api-gateway","Version":"1.0.0","Type":"module","Language":"javascript","Runtime":"node","Description":"REST API gateway","Author":"MAM Generator","License":"MIT","GeneratedAt":"2026-09-17T00:00:00.000Z","Compiler":"mam-compiler","ModuleFormat":"commonjs","Exports":["ApiGateway","RateLimiter","AuthMiddleware","RequestRouter","ResponseCache","LoadBalancer","HealthChecker","MetricsCollector"]}
 */
'use strict';

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
      const headers = this.getHeaders(id);
      res.set(headers);
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

class AuthMiddleware {
  constructor(options = {}) {
    this.jwtSecret = options.jwtSecret || 'default-secret';
    this.apiKeys = new Set(options.apiKeys || []);
    this.tokenBlacklist = new Set();
  }

  validateApiKey(apiKey) { return this.apiKeys.has(apiKey); }

  validateToken(token) {
    if (this.tokenBlacklist.has(token)) return { valid: false, payload: null };
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return { valid: false, payload: null };
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return { valid: false, payload: null };
      return { valid: true, payload };
    } catch { return { valid: false, payload: null }; }
  }

  middleware() {
    return (req, res, next) => {
      const apiKey = req.headers['x-api-key'];
      const authHeader = req.headers.authorization;
      if (apiKey) {
        if (this.validateApiKey(apiKey)) { req.auth = { type: 'apikey', key: apiKey }; return next(); }
        return res.status(401).json({ error: 'Invalid API key' });
      }
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const result = this.validateToken(token);
        if (result.valid) { req.auth = { type: 'jwt', payload: result.payload }; return next(); }
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      return res.status(401).json({ error: 'Authentication required' });
    };
  }

  blacklistToken(token) { this.tokenBlacklist.add(token); }
  addApiKey(apiKey) { this.apiKeys.add(apiKey); }
  removeApiKey(apiKey) { this.apiKeys.delete(apiKey); }
}

class RequestRouter {
  constructor() { this.routes = []; this.middlewares = []; }

  use(fn) { this.middlewares.push(fn); return this; }

  route(method, path, handler) {
    const paramNames = [];
    const pattern = path.replace(/:(\w+)/g, (_, name) => { paramNames.push(name); return '([^/]+)'; });
    this.routes.push({ method: method.toUpperCase(), path, regex: new RegExp(`^${pattern}$`), paramNames, handler });
    return this;
  }

  get(path, handler) { return this.route('GET', path, handler); }
  post(path, handler) { return this.route('POST', path, handler); }
  put(path, handler) { return this.route('PUT', path, handler); }
  delete(path, handler) { return this.route('DELETE', path, handler); }

  match(method, reqPath) {
    for (const r of this.routes) {
      if (r.method !== method.toUpperCase()) continue;
      const m = reqPath.match(r.regex);
      if (m) {
        const params = {};
        r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
    }
    return null;
  }

  toExpressRouter() {
    const express = require('express');
    const router = express.Router();
    this.middlewares.forEach(mw => router.use(mw));
    this.routes.forEach(r => router[r.method.toLowerCase()](r.path, r.handler));
    return router;
  }
}

class ResponseCache {
  constructor(options = {}) {
    this.ttl = options.ttl || 60000;
    this.maxSize = options.maxSize || 1000;
    this.keyGenerator = options.keyGenerator || (req => `${req.method}:${req.url}`);
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  getKey(req) { return this.keyGenerator(req); }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() > entry.expiresAt) { this.store.delete(key); this.misses++; return null; }
    this.hits++;
    return entry.value;
  }

  set(key, value, ttl) {
    if (this.store.size >= this.maxSize) this.store.delete(this.store.keys().next().value);
    this.store.set(key, { value, expiresAt: Date.now() + (ttl || this.ttl) });
  }

  middleware() {
    return (req, res, next) => {
      if (req.method !== 'GET') return next();
      const key = this.getKey(req);
      const cached = this.get(key);
      if (cached) { res.set(cached.headers || {}); return res.status(cached.statusCode || 200).json(cached.body); }
      const origJson = res.json.bind(res);
      res.json = (body) => {
        this.set(key, { body, headers: { 'X-Cache': 'MISS' }, statusCode: res.statusCode });
        return origJson(body);
      };
      next();
    };
  }

  getStats() {
    const total = this.hits + this.misses;
    return { size: this.store.size, maxSize: this.maxSize, hits: this.hits, misses: this.misses, hitRate: total > 0 ? this.hits / total : 0 };
  }

  clear(pattern) {
    if (!pattern) { this.store.clear(); return; }
    const re = new RegExp(pattern);
    for (const key of this.store.keys()) { if (re.test(key)) this.store.delete(key); }
  }
}

class LoadBalancer {
  constructor(options = {}) {
    this.algorithm = options.algorithm || 'round-robin';
    this.backends = (options.backends || []).map((b, i) => ({
      id: b.id || `backend-${i}`, host: b.host, port: b.port,
      weight: b.weight || 1, healthy: true, connections: 0, totalRequests: 0, lastCheck: Date.now(),
    }));
    this.currentIndex = 0;
  }

  addBackend(backend) {
    this.backends.push({
      id: backend.id || `backend-${this.backends.length}`, host: backend.host, port: backend.port,
      weight: backend.weight || 1, healthy: true, connections: 0, totalRequests: 0, lastCheck: Date.now(),
    });
  }

  removeBackend(id) { this.backends = this.backends.filter(b => b.id !== id); }

  getNextRoundRobin() {
    const healthy = this.backends.filter(b => b.healthy);
    if (!healthy.length) return null;
    this.currentIndex = (this.currentIndex + 1) % healthy.length;
    return healthy[this.currentIndex];
  }

  getNextWeighted() {
    const healthy = this.backends.filter(b => b.healthy);
    if (!healthy.length) return null;
    const total = healthy.reduce((s, b) => s + b.weight, 0);
    let rand = Math.random() * total;
    for (const b of healthy) { rand -= b.weight; if (rand <= 0) return b; }
    return healthy[0];
  }

  getNextLeastConnections() {
    const healthy = this.backends.filter(b => b.healthy);
    if (!healthy.length) return null;
    return healthy.reduce((min, b) => (b.connections < min.connections ? b : min));
  }

  getNext() {
    switch (this.algorithm) {
      case 'weighted': return this.getNextWeighted();
      case 'least-connections': return this.getNextLeastConnections();
      default: return this.getNextRoundRobin();
    }
  }

  markHealthy(id) { const b = this.backends.find(x => x.id === id); if (b) { b.healthy = true; b.lastCheck = Date.now(); } }
  markUnhealthy(id) { const b = this.backends.find(x => x.id === id); if (b) { b.healthy = false; b.lastCheck = Date.now(); } }

  getStats() {
    return {
      algorithm: this.algorithm,
      backends: this.backends.map(b => ({ id: b.id, healthy: b.healthy, connections: b.connections, weight: b.weight })),
      totalBackends: this.backends.length, healthyBackends: this.backends.filter(b => b.healthy).length,
    };
  }
}

class HealthChecker {
  constructor(options = {}) {
    this.checks = options.checks || [];
    this.interval = options.interval || 30000;
    this.lastCheck = null;
    this.status = 'unknown';
    this.results = [];
    this.timer = null;
  }

  addCheck(fn) { this.checks.push(fn); }

  async runChecks() {
    this.results = [];
    for (const check of this.checks) {
      try {
        const r = await check();
        this.results.push({ name: r.name || 'unnamed', status: r.status || 'ok', message: r.message || '', timestamp: Date.now() });
      } catch (e) {
        this.results.push({ name: check.name || 'unnamed', status: 'error', message: e.message, timestamp: Date.now() });
      }
    }
    this.status = this.results.some(r => r.status === 'error' || r.status === 'critical') ? 'unhealthy' : 'healthy';
    this.lastCheck = Date.now();
    return { status: this.status, timestamp: this.lastCheck, checks: this.results };
  }

  middleware(path = '/health') {
    return async (req, res, next) => {
      if (req.path !== path) return next();
      const health = await this.runChecks();
      res.status(health.status === 'healthy' ? 200 : 503).json(health);
    };
  }

  start() { this.timer = setInterval(async () => { await this.runChecks(); }, this.interval); }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}

class MetricsCollector {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.startTime = Date.now();
  }

  increment(name, value = 1) { this.counters.set(name, (this.counters.get(name) || 0) + value); }
  decrement(name, value = 1) { this.counters.set(name, (this.counters.get(name) || 0) - value); }
  gauge(name, value) { this.gauges.set(name, value); }

  histogram(name, value) {
    if (!this.histograms.has(name)) this.histograms.set(name, []);
    this.histograms.get(name).push(value);
  }

  timer(name) {
    const start = Date.now();
    return () => { const dur = Date.now() - start; this.histogram(name, dur); return dur; };
  }

  getCounter(name) { return this.counters.get(name) || 0; }
  getGauge(name) { return this.gauges.get(name) ?? null; }

  getHistogramStats(name) {
    const vals = this.histograms.get(name) || [];
    if (!vals.length) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
    const sorted = [...vals].sort((a, b) => a - b);
    return {
      count: vals.length, min: sorted[0], max: sorted[sorted.length - 1],
      mean: vals.reduce((a, b) => a + b, 0) / vals.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  middleware() {
    return (req, res, next) => {
      const end = this.timer('http_request_duration');
      this.increment('http_requests_total');
      this.increment(`http_requests_${req.method}`);
      res.on('finish', () => { end(); this.increment(`http_responses_${res.statusCode}`); });
      next();
    };
  }

  getMetrics() {
    const uptime = Date.now() - this.startTime;
    const counters = Object.fromEntries(this.counters);
    const gauges = Object.fromEntries(this.gauges);
    const histograms = {};
    for (const [k] of this.histograms) histograms[k] = this.getHistogramStats(k);
    return { uptime, counters, gauges, histograms };
  }

  reset() { this.counters.clear(); this.gauges.clear(); this.histograms.clear(); this.startTime = Date.now(); }
}

class ApiGateway {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.rateLimiter = new RateLimiter(options.rateLimit);
    this.auth = new AuthMiddleware(options.auth);
    this.router = new RequestRouter();
    this.cache = new ResponseCache(options.cache);
    this.loadBalancer = new LoadBalancer(options.loadBalancer);
    this.healthChecker = new HealthChecker(options.healthCheck);
    this.metrics = new MetricsCollector();
    this.server = null;
  }

  setupRoutes() {
    this.router.use(this.rateLimiter.middleware());
    this.router.use(this.auth.middleware());
    this.router.use(this.cache.middleware());
    this.router.use(this.metrics.middleware());
    this.router.get('/health', async (req, res) => { res.json(await this.healthChecker.runChecks()); });
    this.router.get('/metrics', (req, res) => { res.json(this.metrics.getMetrics()); });
    this.router.get('/lb/stats', (req, res) => { res.json(this.loadBalancer.getStats()); });
    this.router.get('/cache/stats', (req, res) => { res.json(this.cache.getStats()); });
  }

  async start() {
    try {
      const express = require('express');
      const app = express();
      app.use(express.json({ limit: '10mb' }));
      app.use(express.urlencoded({ extended: true }));
      this.setupRoutes();
      app.use(this.router.toExpressRouter());
      this.server = app.listen(this.port, () => {
        console.log(`API Gateway running on port ${this.port}`);
        this.healthChecker.start();
      });
      return this.server;
    } catch (err) {
      console.error('Failed to start API Gateway:', err.message);
      throw err;
    }
  }

  async stop() {
    this.healthChecker.stop();
    this.rateLimiter.destroy();
    if (this.server) return new Promise(resolve => this.server.close(resolve));
  }

  get(path, handler) { this.router.get(path, handler); return this; }
  post(path, handler) { this.router.post(path, handler); return this; }
  put(path, handler) { this.router.put(path, handler); return this; }
  delete(path, handler) { this.router.delete(path, handler); return this; }
}

if (require.main === module) {
  const gateway = new ApiGateway({ port: process.env.PORT || 3000 });
  gateway.start().catch(console.error);
  process.on('SIGTERM', async () => { await gateway.stop(); process.exit(0); });
  process.on('SIGINT', async () => { await gateway.stop(); process.exit(0); });
}

module.exports = { ApiGateway, RateLimiter, AuthMiddleware, RequestRouter, ResponseCache, LoadBalancer, HealthChecker, MetricsCollector };
