import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, createLogger, getDefaultLogger, setDefaultLogger } from '../src/logger.js';

function createMockWriteStream(): { write: ReturnType<typeof vi.fn>; output: () => string } {
  const written: string[] = [];
  return {
    write: vi.fn((chunk: string | Uint8Array) => {
      written.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    }),
    output: () => written.join(''),
  };
}

let stdoutSpy: ReturnType<typeof vi.fn>;
let originalStdoutWrite: typeof process.stdout.write;

beforeEach(() => {
  stdoutSpy = vi.fn((chunk: string | Uint8Array) => true);
  originalStdoutWrite = process.stdout.write;
  (process.stdout as any).write = stdoutSpy;
});

afterEach(() => {
  (process.stdout as any).write = originalStdoutWrite;
});

describe('Logger', () => {
  it('should create with default options', () => {
    const logger = new Logger();
    expect(logger.getLevel()).toBe('info');
  });

  it('should accept custom level', () => {
    const logger = new Logger({ level: 'debug' });
    expect(logger.getLevel()).toBe('debug');
  });

  it('should accept custom level warn', () => {
    const logger = new Logger({ level: 'warn' });
    expect(logger.getLevel()).toBe('warn');
  });

  it('should accept custom level error', () => {
    const logger = new Logger({ level: 'error' });
    expect(logger.getLevel()).toBe('error');
  });

  it('should accept custom level silent', () => {
    const logger = new Logger({ level: 'silent' });
    expect(logger.getLevel()).toBe('silent');
  });
});

describe('Logger level filtering', () => {
  it('should not emit debug when level is info', () => {
    const logger = new Logger({ level: 'info', color: false });
    logger.debug('debug msg');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('should emit info when level is info', () => {
    const logger = new Logger({ level: 'info', color: false });
    logger.info('info msg');
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('should not emit info when level is warn', () => {
    const logger = new Logger({ level: 'warn', color: false });
    logger.info('info msg');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('should emit warn when level is warn', () => {
    const logger = new Logger({ level: 'warn', color: false });
    logger.warn('warn msg');
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('should emit error when level is error', () => {
    const stream = createMockWriteStream();
    const logger = new Logger({ level: 'error', stream: stream as unknown as NodeJS.WriteStream, color: false });
    logger.error('error msg');
    expect(stream.write).toHaveBeenCalled();
  });

  it('should not emit anything when level is silent', () => {
    const logger = new Logger({ level: 'silent', color: false });
    logger.error('error msg');
    logger.info('info msg');
    logger.warn('warn msg');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('should emit debug and info when level is debug', () => {
    const logger = new Logger({ level: 'debug', color: false });
    logger.debug('d');
    logger.info('i');
    expect(stdoutSpy).toHaveBeenCalledTimes(2);
  });
});

describe('Logger setLevel / getLevel', () => {
  it('should change level at runtime', () => {
    const logger = new Logger({ level: 'info' });
    expect(logger.getLevel()).toBe('info');
    logger.setLevel('debug');
    expect(logger.getLevel()).toBe('debug');
  });

  it('should change to silent', () => {
    const logger = new Logger({ level: 'info' });
    logger.setLevel('silent');
    expect(logger.getLevel()).toBe('silent');
  });
});

describe('Logger child', () => {
  it('should create child with prefix', () => {
    const logger = new Logger({ level: 'info', color: false, prefix: 'parent' });
    const child = logger.child('child');
    child.info('hello');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain('[parent:child]');
    expect(output).toContain('hello');
  });

  it('should create child without parent prefix', () => {
    const logger = new Logger({ level: 'info', color: false });
    const child = logger.child('only');
    child.info('msg');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain('[only]');
  });

  it('should inherit level from parent', () => {
    const logger = new Logger({ level: 'warn' });
    const child = logger.child('c');
    expect(child.getLevel()).toBe('warn');
  });
});

describe('Logger timestamp', () => {
  it('should include ISO timestamp when enabled', () => {
    const logger = new Logger({ level: 'info', color: false, timestamp: true });
    logger.info('ts msg');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('should not include timestamp by default', () => {
    const logger = new Logger({ level: 'info', color: false });
    logger.info('no ts');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('Logger format output', () => {
  it('should include INFO tag in output when color enabled', () => {
    const logger = new Logger({ level: 'info', color: true });
    logger.info('hello');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain('INFO');
    expect(output).toContain('hello');
  });

  it('should include WARN tag in output when color enabled', () => {
    const logger = new Logger({ level: 'warn', color: true });
    logger.warn('warn msg');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain('WARN');
  });

  it('should include ERROR tag in output when color enabled', () => {
    const stream = createMockWriteStream();
    const logger = new Logger({ level: 'error', stream: stream as unknown as NodeJS.WriteStream, color: true });
    logger.error('err msg');
    const output = stream.output();
    expect(output).toContain('ERROR');
  });

  it('should not include level tag when color is disabled', () => {
    const logger = new Logger({ level: 'info', color: false });
    logger.info('hello');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).not.toContain('INFO');
    expect(output).toContain('hello');
  });

  it('should append extra args', () => {
    const logger = new Logger({ level: 'info', color: false });
    logger.info('msg', 'extra1', { key: 'val' });
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain('extra1');
    expect(output).toContain('{"key":"val"}');
  });

  it('should end lines with newline', () => {
    const logger = new Logger({ level: 'info', color: false });
    logger.info('line');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output.endsWith('\n')).toBe(true);
  });
});

describe('Logger success', () => {
  it('should emit info-level message with check mark', () => {
    const logger = new Logger({ level: 'info', color: false });
    logger.success('done');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output).toContain('✓');
    expect(output).toContain('done');
  });
});

describe('createLogger', () => {
  it('should return a Logger instance', () => {
    const logger = createLogger({ level: 'debug' });
    expect(logger).toBeInstanceOf(Logger);
    expect(logger.getLevel()).toBe('debug');
  });
});

describe('getDefaultLogger / setDefaultLogger', () => {
  it('should return a default logger', () => {
    const logger = getDefaultLogger();
    expect(logger).toBeInstanceOf(Logger);
  });

  it('should allow replacing the default logger', () => {
    const custom = new Logger({ level: 'debug' });
    setDefaultLogger(custom);
    expect(getDefaultLogger()).toBe(custom);
    setDefaultLogger(new Logger());
  });

  it('should return the same instance on repeated calls', () => {
    const a = getDefaultLogger();
    const b = getDefaultLogger();
    expect(a).toBe(b);
  });
});
