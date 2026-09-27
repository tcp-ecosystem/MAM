import { describe, it, expect } from 'vitest';
import {
  MAMError,
  ParseError,
  ValidationError,
  CompileError,
  ConfigError,
  RegistryError,
  PluginError,
  PackageError,
  ErrorCollector,
  isMAMError,
  asMAMError,
  getErrorCode,
  getErrorMessage,
  isErrorCode,
  formatUnknownError,
  collectErrorMessages,
} from '../src/errors.js';

describe('MAMError', () => {
  it('should create with message only', () => {
    const err = new MAMError('something broke');
    expect(err.message).toBe('something broke');
    expect(err.name).toBe('MAMError');
    expect(err.code).toBe('MAM_ERROR');
  });

  it('should accept custom code', () => {
    const err = new MAMError('oops', { code: 'CUSTOM' });
    expect(err.code).toBe('CUSTOM');
  });

  it('should store cause', () => {
    const cause = new Error('root cause');
    const err = new MAMError('wrapper', { cause });
    expect(err.cause).toBe(cause);
  });

  it('should store context', () => {
    const err = new MAMError('err', { context: { key: 'val' } });
    expect(err.context).toEqual({ key: 'val' });
  });

  it('should store path, line, column', () => {
    const err = new MAMError('err', { path: 'file.mam.md', line: 5, column: 12 });
    expect(err.path).toBe('file.mam.md');
    expect(err.line).toBe(5);
    expect(err.column).toBe(12);
  });

  it('should default code to MAM_ERROR when options.code is undefined', () => {
    const err = new MAMError('msg', {});
    expect(err.code).toBe('MAM_ERROR');
  });

  it('should be an instance of Error', () => {
    const err = new MAMError('msg');
    expect(err).toBeInstanceOf(Error);
  });

  it('should format with path and line', () => {
    const err = new MAMError('bad syntax', { path: 'a.mam.md', line: 10, column: 3 });
    const formatted = err.format();
    expect(formatted).toContain('at a.mam.md:10:3');
    expect(formatted).toContain('bad syntax');
  });

  it('should format with path only', () => {
    const err = new MAMError('bad', { path: 'a.mam.md' });
    expect(err.format()).toContain('at a.mam.md');
  });

  it('should format without path', () => {
    const err = new MAMError('bad');
    expect(err.format()).toBe('bad');
  });

  it('should serialize to JSON', () => {
    const err = new MAMError('msg', {
      code: 'TEST',
      path: 'f.mam.md',
      line: 1,
      column: 2,
      context: { x: 1 },
    });
    const json = err.toJSON();
    expect(json.name).toBe('MAMError');
    expect(json.code).toBe('TEST');
    expect(json.message).toBe('msg');
    expect(json.path).toBe('f.mam.md');
    expect(json.line).toBe(1);
    expect(json.column).toBe(2);
    expect(json.context).toEqual({ x: 1 });
  });

  it('should maintain instanceof chain for subclasses', () => {
    const err = new ParseError('parse fail');
    expect(err).toBeInstanceOf(MAMError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ParseError', () => {
  it('should have name ParseError', () => {
    const err = new ParseError('unexpected token');
    expect(err.name).toBe('ParseError');
  });

  it('should default code to PARSE_ERROR', () => {
    const err = new ParseError('err');
    expect(err.code).toBe('PARSE_ERROR');
  });

  it('should accept custom code', () => {
    const err = new ParseError('err', { code: 'CUSTOM_PARSE' });
    expect(err.code).toBe('CUSTOM_PARSE');
  });

  it('should be instance of MAMError', () => {
    expect(new ParseError('e')).toBeInstanceOf(MAMError);
  });

  it('should store location', () => {
    const err = new ParseError('err', { path: 'x.mam.md', line: 3, column: 7 });
    expect(err.path).toBe('x.mam.md');
    expect(err.line).toBe(3);
  });
});

describe('ValidationError', () => {
  it('should have name ValidationError and code VALIDATION_ERROR', () => {
    const err = new ValidationError('invalid');
    expect(err.name).toBe('ValidationError');
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('should be instance of MAMError', () => {
    expect(new ValidationError('e')).toBeInstanceOf(MAMError);
  });
});

describe('CompileError', () => {
  it('should have name CompileError and code COMPILE_ERROR', () => {
    const err = new CompileError('compile failed');
    expect(err.name).toBe('CompileError');
    expect(err.code).toBe('COMPILE_ERROR');
  });

  it('should be instance of MAMError', () => {
    expect(new CompileError('e')).toBeInstanceOf(MAMError);
  });
});

describe('ConfigError', () => {
  it('should have name ConfigError and code CONFIG_ERROR', () => {
    const err = new ConfigError('bad config');
    expect(err.name).toBe('ConfigError');
    expect(err.code).toBe('CONFIG_ERROR');
  });

  it('should be instance of MAMError', () => {
    expect(new ConfigError('e')).toBeInstanceOf(MAMError);
  });
});

describe('RegistryError', () => {
  it('should have name RegistryError and code REGISTRY_ERROR', () => {
    const err = new RegistryError('publish failed');
    expect(err.name).toBe('RegistryError');
    expect(err.code).toBe('REGISTRY_ERROR');
  });

  it('should be instance of MAMError', () => {
    expect(new RegistryError('e')).toBeInstanceOf(MAMError);
  });
});

describe('PluginError', () => {
  it('should have name PluginError and code PLUGIN_ERROR', () => {
    const err = new PluginError('plugin load failed');
    expect(err.name).toBe('PluginError');
    expect(err.code).toBe('PLUGIN_ERROR');
  });

  it('should be instance of MAMError', () => {
    expect(new PluginError('e')).toBeInstanceOf(MAMError);
  });
});

describe('PackageError', () => {
  it('should have name PackageError and code PACKAGE_ERROR', () => {
    const err = new PackageError('install failed');
    expect(err.name).toBe('PackageError');
    expect(err.code).toBe('PACKAGE_ERROR');
  });

  it('should be instance of MAMError', () => {
    expect(new PackageError('e')).toBeInstanceOf(MAMError);
  });
});

describe('ErrorCollector', () => {
  it('should start empty', () => {
    const collector = new ErrorCollector();
    expect(collector.hasErrors()).toBe(false);
    expect(collector.hasWarnings()).toBe(false);
    expect(collector.errorCount).toBe(0);
    expect(collector.warningCount).toBe(0);
  });

  it('should add errors', () => {
    const collector = new ErrorCollector();
    collector.addError(new MAMError('err1'));
    collector.addError(new MAMError('err2'));
    expect(collector.hasErrors()).toBe(true);
    expect(collector.errorCount).toBe(2);
  });

  it('should add warnings', () => {
    const collector = new ErrorCollector();
    collector.addWarning(new MAMError('warn1'));
    expect(collector.hasWarnings()).toBe(true);
    expect(collector.warningCount).toBe(1);
  });

  it('should return copies from getErrors', () => {
    const collector = new ErrorCollector();
    const err = new MAMError('e');
    collector.addError(err);
    const errors = collector.getErrors();
    errors.push(new MAMError('extra'));
    expect(collector.errorCount).toBe(1);
  });

  it('should return copies from getWarnings', () => {
    const collector = new ErrorCollector();
    collector.addWarning(new MAMError('w'));
    const warnings = collector.getWarnings();
    warnings.push(new MAMError('extra'));
    expect(collector.warningCount).toBe(1);
  });

  it('should clear all errors and warnings', () => {
    const collector = new ErrorCollector();
    collector.addError(new MAMError('e'));
    collector.addWarning(new MAMError('w'));
    collector.clear();
    expect(collector.hasErrors()).toBe(false);
    expect(collector.hasWarnings()).toBe(false);
    expect(collector.errorCount).toBe(0);
    expect(collector.warningCount).toBe(0);
  });

  it('should format errors and warnings', () => {
    const collector = new ErrorCollector();
    collector.addError(new MAMError('err msg', { code: 'E1' }));
    collector.addWarning(new MAMError('warn msg', { code: 'W1' }));
    const output = collector.format();
    expect(output).toContain('error [E1]: err msg');
    expect(output).toContain('warn  [W1]: warn msg');
  });

  it('should format empty collector as empty string', () => {
    const collector = new ErrorCollector();
    expect(collector.format()).toBe('');
  });

  it('should serialize to result object', () => {
    const collector = new ErrorCollector();
    collector.addError(new MAMError('err', { code: 'E1', path: 'f.mam.md' }));
    collector.addWarning(new MAMError('warn', { code: 'W1' }));
    const result = collector.toResult();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({ code: 'E1', message: 'err', path: 'f.mam.md' });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toEqual({ code: 'W1', message: 'warn', path: undefined });
  });

  it('should handle mixed error types', () => {
    const collector = new ErrorCollector();
    collector.addError(new ParseError('parse err'));
    collector.addError(new CompileError('compile err'));
    collector.addWarning(new ValidationError('val warn'));
    expect(collector.errorCount).toBe(2);
    expect(collector.warningCount).toBe(1);
  });
});

describe('isMAMError', () => {
  it('should detect MAM errors', () => {
    expect(isMAMError(new MAMError('x'))).toBe(true);
    expect(isMAMError(new ParseError('x'))).toBe(true);
    expect(isMAMError(new Error('x'))).toBe(false);
    expect(isMAMError('x')).toBe(false);
    expect(isMAMError(null)).toBe(false);
  });
});

describe('asMAMError', () => {
  it('should pass through MAM errors', () => {
    const err = new ParseError('parse');
    expect(asMAMError(err)).toBe(err);
  });

  it('should wrap plain errors and values', () => {
    const wrapped = asMAMError(new Error('boom'));
    expect(wrapped).toBeInstanceOf(MAMError);
    expect(wrapped.message).toBe('boom');
    expect(asMAMError('str').message).toBe('str');
  });
});

describe('getErrorCode / getErrorMessage', () => {
  it('should read codes and messages', () => {
    expect(getErrorCode(new ParseError('x'))).toBe('PARSE_ERROR');
    expect(getErrorCode(new Error('x'))).toBe('UNKNOWN_ERROR');
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage(42)).toBe('42');
  });
});

describe('isErrorCode', () => {
  it('should match codes', () => {
    expect(isErrorCode(new ConfigError('x'), 'CONFIG_ERROR')).toBe(true);
    expect(isErrorCode(new ConfigError('x'), 'OTHER')).toBe(false);
    expect(isErrorCode(new Error('x'), 'UNKNOWN_ERROR')).toBe(true);
  });
});

describe('formatUnknownError', () => {
  it('should format code and message', () => {
    expect(formatUnknownError(new RegistryError('bad'))).toBe('[REGISTRY_ERROR] bad');
    expect(formatUnknownError(new Error('boom'))).toBe('[UNKNOWN_ERROR] boom');
  });
});

describe('collectErrorMessages', () => {
  it('should collect messages from mixed values', () => {
    expect(collectErrorMessages([new Error('a'), 'b', new MAMError('c')])).toEqual(['a', 'b', 'c']);
    expect(collectErrorMessages([])).toEqual([]);
  });
});
