/**
 * @fileoverview Data Pipeline - Production-grade data processing pipeline
 * @module data-pipeline
 * @version 1.0.0
 * MAM Context: {"Id":"data-pipeline-mam-001","Name":"data-pipeline","Version":"1.0.0","Type":"module","Language":"javascript","Runtime":"node","Description":"Data processing pipeline with validators, transforms, parallel execution, error handling, monitoring, logging, and configuration","Author":"MAM Generator","License":"MIT","GeneratedAt":"2026-09-17T00:00:00.000Z","Compiler":"mam-compiler","ModuleFormat":"commonjs","Exports":["Pipeline","DataValidator","Transforms","ParallelExecutor","ErrorHandler","MonitoringDecorator","Logger","ConfigManager"]}
 */
'use strict';

class ConfigManager {
  constructor(defaults = {}) {
    this.config = new Map();
    this.watchers = new Map();
    this.sources = [];
    Object.entries(defaults).forEach(([k, v]) => this.config.set(k, v));
  }

  get(key, defaultValue) { return this.config.has(key) ? this.config.get(key) : defaultValue; }
  set(key, value) { const old = this.config.get(key); this.config.set(key, value); this._notify(key, value, old); return this; }
  has(key) { return this.config.has(key); }
  delete(key) { this.config.delete(key); return this; }
  getAll() { return Object.fromEntries(this.config); }

  watch(key, callback) {
    if (!this.watchers.has(key)) this.watchers.set(key, []);
    this.watchers.get(key).push(callback);
    return () => { const cbs = this.watchers.get(key); if (cbs) this.watchers.set(key, cbs.filter(cb => cb !== callback)); };
  }

  _notify(key, value, oldValue) { (this.watchers.get(key) || []).forEach(cb => cb(value, oldValue, key)); }

  async loadFromSource() {
    for (const source of this.sources) {
      try {
        const data = typeof source === 'function' ? await source() : require(source);
        Object.entries(data).forEach(([k, v]) => this.set(k, v));
      } catch (e) { console.error(`Failed to load config: ${e.message}`); }
    }
  }

  merge(other) { Object.entries(other).forEach(([k, v]) => this.set(k, v)); return this; }
  subset(keys) { const sub = new ConfigManager(); keys.forEach(k => { if (this.has(k)) sub.set(k, this.get(k)); }); return sub; }
}

class Logger {
  constructor(options = {}) {
    this.level = options.level || 'info';
    this.prefix = options.prefix || '';
    this.transports = options.transports || [this._consoleTransport.bind(this)];
    this.levels = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
    this.buffer = [];
    this.maxBufferSize = options.maxBufferSize || 1000;
  }

  _consoleTransport(entry) {
    const msg = `${entry.timestamp} [${entry.level.toUpperCase()}]${this.prefix ? ' ' + this.prefix : ''} ${entry.message}`;
    if (entry.level === 'error') console.error(msg);
    else if (entry.level === 'warn') console.warn(msg);
    else console.log(msg);
    if (entry.meta && Object.keys(entry.meta).length > 0) console.log('  Meta:', JSON.stringify(entry.meta, null, 2));
  }

  _log(level, message, meta = {}) {
    if (this.levels[level] > this.levels[this.level]) return;
    const entry = { timestamp: new Date().toISOString(), level, message, meta, prefix: this.prefix };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) this.buffer.shift();
    this.transports.forEach(t => t(entry));
  }

  error(message, meta) { this._log('error', message, meta); }
  warn(message, meta) { this._log('warn', message, meta); }
  info(message, meta) { this._log('info', message, meta); }
  debug(message, meta) { this._log('debug', message, meta); }
  trace(message, meta) { this._log('trace', message, meta); }

  child(prefix) { return new Logger({ level: this.level, prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix, transports: this.transports }); }
  addTransport(transport) { this.transports.push(transport); return this; }
  getBuffer() { return [...this.buffer]; }
  clearBuffer() { this.buffer = []; }
  setLevel(level) { this.level = level; }
}

class DataValidator {
  constructor() { this.rules = new Map(); this.customValidators = new Map(); }

  addRule(field, rule) {
    if (!this.rules.has(field)) this.rules.set(field, []);
    this.rules.get(field).push(rule);
    return this;
  }

  required(field) { return this.addRule(field, { type: 'required', message: `${field} is required` }); }
  minLength(field, min) { return this.addRule(field, { type: 'minLength', min, message: `${field} must be >= ${min} chars` }); }
  maxLength(field, max) { return this.addRule(field, { type: 'maxLength', max, message: `${field} must be <= ${max} chars` }); }
  pattern(field, regex, message) { return this.addRule(field, { type: 'pattern', regex, message: message || `${field} format invalid` }); }
  range(field, min, max) { return this.addRule(field, { type: 'range', min, max, message: `${field} must be ${min}-${max}` }); }
  oneOf(field, values) { return this.addRule(field, { type: 'oneOf', values, message: `${field} must be one of: ${values.join(', ')}` }); }
  email(field) { return this.pattern(field, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, `${field} must be a valid email`); }
  url(field) { return this.pattern(field, /^https?:\/\/.+/, `${field} must be a valid URL`); }

  custom(field, name, validatorFn, message) {
    this.customValidators.set(name, validatorFn);
    return this.addRule(field, { type: 'custom', validatorName: name, message: message || `${field} is invalid` });
  }

  validate(data) {
    const errors = [];
    for (const [field, rules] of this.rules) {
      const value = data[field];
      for (const rule of rules) {
        const error = this._applyRule(field, value, rule);
        if (error) { errors.push(error); break; }
      }
    }
    return { valid: errors.length === 0, errors, data };
  }

  _applyRule(field, value, rule) {
    switch (rule.type) {
      case 'required':
        if (value === undefined || value === null || value === '') return { field, message: rule.message, rule: rule.type };
        break;
      case 'minLength':
        if (typeof value === 'string' && value.length < rule.min) return { field, message: rule.message, rule: rule.type };
        break;
      case 'maxLength':
        if (typeof value === 'string' && value.length > rule.max) return { field, message: rule.message, rule: rule.type };
        break;
      case 'pattern':
        if (typeof value === 'string' && !rule.regex.test(value)) return { field, message: rule.message, rule: rule.type };
        break;
      case 'range':
        if (typeof value === 'number' && (value < rule.min || value > rule.max)) return { field, message: rule.message, rule: rule.type };
        break;
      case 'oneOf':
        if (!rule.values.includes(value)) return { field, message: rule.message, rule: rule.type };
        break;
      case 'custom': {
        const fn = this.customValidators.get(rule.validatorName);
        if (fn && !fn(value, data)) return { field, message: rule.message, rule: rule.type };
        break;
      }
    }
    return null;
  }

  validateArray(dataArray) { return dataArray.map((data, index) => ({ index, ...this.validate(data) })); }
}

class Transforms {
  static map(items, fn) { return items.map(fn); }
  static filter(items, fn) { return items.filter(fn); }
  static reduce(items, fn, initial) { return items.reduce(fn, initial); }
  static flatMap(items, fn) { return items.flatMap(fn); }

  static unique(items, keyFn) {
    if (!keyFn) return [...new Set(items)];
    const seen = new Set();
    return items.filter(item => { const k = keyFn(item); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  static sort(items, compareFn) { return [...items].sort(compareFn); }

  static groupBy(items, keyFn) {
    return items.reduce((groups, item) => { const key = keyFn(item); (groups[key] = groups[key] || []).push(item); return groups; }, {});
  }

  static chunk(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  }

  static flatten(items, depth = Infinity) { return items.flat(depth); }

  static pick(keys) { return (obj) => keys.reduce((acc, k) => { if (k in obj) acc[k] = obj[k]; return acc; }, {}); }
  static omit(keys) { return (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k))); }
  static rename(renames) { return (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [renames[k] || k, v])); }
  static defaultValue(key, value) { return (obj) => ({ ...{ [key]: value }, ...obj }); }
  static cast(key, type) { return (obj) => { const v = obj[key]; if (type === 'number') obj[key] = Number(v); else if (type === 'string') obj[key] = String(v); else if (type === 'boolean') obj[key] = Boolean(v); return obj; }; }
  static compose(...fns) { return (x) => fns.reduceRight((acc, fn) => fn(acc), x); }
  static pipe(...fns) { return (x) => fns.reduce((acc, fn) => fn(acc), x); }
}

class ParallelExecutor {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 5;
    this.retryCount = options.retryCount || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.logger = options.logger || new Logger({ level: 'warn' });
  }

  async execute(tasks) {
    const results = [];
    const errors = [];
    const executing = new Set();

    for (const [index, task] of tasks.entries()) {
      const promise = this._executeWithRetry(task, index)
        .then(result => { results[index] = { status: 'fulfilled', value: result }; })
        .catch(error => { errors.push({ index, error }); results[index] = { status: 'rejected', reason: error }; })
        .finally(() => executing.delete(promise));
      executing.add(promise);
      if (executing.size >= this.concurrency) await Promise.race(executing);
    }

    await Promise.all(executing);
    return { results, errors, totalTasks: tasks.length, successfulTasks: tasks.length - errors.length, failedTasks: errors.length };
  }

  async _executeWithRetry(task, index) {
    let lastError;
    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      try {
        this.logger.debug(`Task ${index} attempt ${attempt + 1}`);
        return await task();
      } catch (error) {
        lastError = error;
        this.logger.warn(`Task ${index} failed attempt ${attempt + 1}: ${error.message}`);
        if (attempt < this.retryCount) await this._delay(this.retryDelay * Math.pow(2, attempt));
      }
    }
    throw lastError;
  }

  _delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async map(items, fn) {
    const tasks = items.map((item, i) => () => fn(item, i));
    const { results } = await this.execute(tasks);
    return results.map(r => r.status === 'fulfilled' ? r.value : r.reason);
  }

  async filter(items, fn) {
    const results = await this.map(items, async (item) => ({ item, include: await fn(item) }));
    return results.filter(r => r.include !== false).map(r => r.item);
  }

  async forEach(items, fn) {
    const tasks = items.map((item, i) => () => fn(item, i));
    await this.execute(tasks);
  }
}

class ErrorHandler {
  constructor(options = {}) {
    this.handlers = new Map();
    this.defaultHandler = options.defaultHandler || this._defaultHandler.bind(this);
    this.logger = options.logger || new Logger({ level: 'error' });
    this.errorCounts = new Map();
  }

  register(errorType, handler) { this.handlers.set(errorType, handler); return this; }

  async handle(error, context = {}) {
    const Handler = this.handlers.get(error.constructor) || this.handlers.get(error.name) || this.defaultHandler;
    const count = (this.errorCounts.get(error.message) || 0) + 1;
    this.errorCounts.set(error.message, count);
    this.logger.error(error.message, { stack: error.stack, context, count });
    return Handler(error, context);
  }

  _defaultHandler(error, context) { return { handled: false, error: error.message, context, timestamp: Date.now() }; }

  wrap(fn) {
    return async (...args) => {
      try { return await fn(...args); }
      catch (error) { return this.handle(error, { args, function: fn.name }); }
    };
  }

  createMiddleware() {
    return (error, req, res, _next) => {
      this.handle(error, { url: req.url, method: req.method }).then(result => {
        res.status(500).json({ error: 'Internal server error', details: result });
      });
    };
  }

  getErrorCounts() { return Object.fromEntries(this.errorCounts); }
  resetCounts() { this.errorCounts.clear(); }
}

class MonitoringDecorator {
  constructor(options = {}) {
    this.logger = options.logger || new Logger();
    this.metrics = options.metrics || new Map();
  }

  instrument(name, fn) {
    const self = this;
    return async function (...args) {
      const traceId = `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const start = Date.now();
      self.logger.debug(`Starting: ${name}`, { traceId });
      try {
        const result = await fn.apply(this, args);
        const duration = Date.now() - start;
        self._recordMetric(name, { duration, success: true });
        self.logger.debug(`Completed: ${name}`, { traceId, duration });
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        self._recordMetric(name, { duration, success: false, error: error.message });
        self.logger.error(`Failed: ${name}`, { traceId, duration, error: error.message });
        throw error;
      }
    };
  }

  _recordMetric(name, data) {
    if (!this.metrics.has(name)) this.metrics.set(name, { count: 0, totalDuration: 0, errors: 0, avgDuration: 0 });
    const m = this.metrics.get(name);
    m.count++;
    m.totalDuration += data.duration;
    if (!data.success) m.errors++;
    m.avgDuration = m.totalDuration / m.count;
    m.lastDuration = data.duration;
    m.lastRun = Date.now();
  }

  getMetrics(name) { return name ? this.metrics.get(name) : Object.fromEntries(this.metrics); }

  createTimer(name) {
    const start = Date.now();
    return () => { const dur = Date.now() - start; this._recordMetric(name, { duration: dur, success: true }); return dur; };
  }

  createCounter(name, initial = 0) {
    let value = initial;
    return {
      increment: (n = 1) => { value += n; return value; },
      decrement: (n = 1) => { value -= n; return value; },
      getValue: () => value,
    };
  }
}

class Pipeline {
  constructor(options = {}) {
    this.stages = [];
    this.errorHandler = options.errorHandler || new ErrorHandler();
    this.logger = options.logger || new Logger({ prefix: 'pipeline' });
    this.monitoring = options.monitoring || new MonitoringDecorator({ logger: this.logger });
    this.config = options.config || new ConfigManager();
    this.hooks = { before: [], after: [], error: [], finally: [] };
  }

  stage(name, fn) {
    const wrapped = this.monitoring.instrument(name, fn);
    this.stages.push({ name, fn: wrapped, validator: null });
    return this;
  }

  validate(name, validator) {
    const stage = this.stages.find(s => s.name === name);
    if (stage) stage.validator = validator;
    return this;
  }

  before(name, fn) { this.hooks.before.push({ stage: name, fn }); return this; }
  after(name, fn) { this.hooks.after.push({ stage: name, fn }); return this; }
  onError(name, fn) { this.hooks.error.push({ stage: name, fn }); return this; }
  finally(name, fn) { this.hooks.finally.push({ stage: name, fn }); return this; }

  async execute(initialData) {
    let data = initialData;
    const context = { startTime: Date.now(), stages: [], data: initialData };
    this.logger.info('Pipeline started', { stages: this.stages.length });

    try {
      for (const stage of this.stages) {
        const stageCtx = { name: stage.name, startTime: Date.now() };
        this.logger.debug(`Running stage: ${stage.name}`);

        await this._runHooks('before', stage.name, data);

        if (stage.validator) {
          const validation = stage.validator(data);
          if (!validation.valid) throw new Error(`Validation failed in ${stage.name}: ${JSON.stringify(validation.errors)}`);
        }

        try {
          data = await stage.fn(data);
          stageCtx.duration = Date.now() - stageCtx.startTime;
          stageCtx.success = true;
          await this._runHooks('after', stage.name, data);
        } catch (error) {
          stageCtx.duration = Date.now() - stageCtx.startTime;
          stageCtx.success = false;
          stageCtx.error = error.message;
          await this._runHooks('error', stage.name, error);
          await this.errorHandler.handle(error, { stage: stage.name, data });
          throw error;
        }

        context.stages.push(stageCtx);
      }

      await this._runHooks('finally', null, data);
      context.endTime = Date.now();
      context.duration = context.endTime - context.startTime;
      context.success = true;
      this.logger.info('Pipeline completed', { duration: context.duration });
      return { data, context };
    } catch (error) {
      context.endTime = Date.now();
      context.duration = context.endTime - context.startTime;
      context.success = false;
      context.error = error.message;
      await this._runHooks('finally', null, data);
      this.logger.error('Pipeline failed', { duration: context.duration, error: error.message });
      return { data, context, error };
    }
  }

  async _runHooks(type, stageName, data) {
    const hooks = this.hooks[type].filter(h => !stageName || !h.stage || h.stage === stageName);
    for (const hook of hooks) {
      try { await hook.fn(data); } catch (e) { this.logger.warn(`Hook ${type} error: ${e.message}`); }
    }
  }

  async executeArray(items, options = {}) {
    const { parallel = false, concurrency = 5 } = options;
    if (parallel) {
      const executor = new ParallelExecutor({ concurrency, logger: this.logger });
      return executor.map(items, item => this.execute(item));
    }
    const results = [];
    for (const item of items) results.push(await this.execute(item));
    return results;
  }

  describe() {
    return {
      name: this.config.get('pipelineName', 'unnamed'),
      stages: this.stages.map(s => s.name),
      totalStages: this.stages.length,
    };
  }

  clone() {
    const p = new Pipeline({ errorHandler: this.errorHandler, logger: this.logger, monitoring: this.monitoring, config: this.config });
    p.stages = [...this.stages];
    p.hooks = { before: [...this.hooks.before], after: [...this.hooks.after], error: [...this.hooks.error], finally: [...this.hooks.finally] };
    return p;
  }
}

if (require.main === module) {
  const logger = new Logger({ level: 'debug', prefix: 'demo' });
  const config = new ConfigManager({ pipelineName: 'demo-pipeline', batchSize: 100 });
  const validator = new DataValidator();
  validator.required('name').email('email').range('age', 0, 150);

  const pipeline = new Pipeline({ logger, config });
  pipeline
    .stage('validate', (data) => { const r = validator.validate(data); if (!r.valid) throw new Error(JSON.stringify(r.errors)); return data; })
    .stage('transform', (data) => ({ ...data, name: data.name.toUpperCase(), processedAt: Date.now() }))
    .stage('enrich', (data) => ({ ...data, enriched: true, score: Math.random() * 100 }))
    .after('enrich', (data) => logger.info('Data enriched', { score: data.score }));

  pipeline.execute({ name: 'John Doe', email: 'john@example.com', age: 30 }).then(result => {
    console.log('Pipeline result:', JSON.stringify(result, null, 2));
  });
}

module.exports = { Pipeline, DataValidator, Transforms, ParallelExecutor, ErrorHandler, MonitoringDecorator, Logger, ConfigManager };
