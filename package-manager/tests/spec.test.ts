/**
 * Package Spec, Tarball, and Git Helpers Tests
 */

import { describe, it, expect } from 'vitest';
import { parsePackageSpec, splitNameVersion, isValidPackageName, normalizePackageName } from '../src/spec.js';
import { tarballFilename, extractTarballInfo, isTarballFilename, stripTarballExt } from '../src/tarball.js';
import { isGitUrl, parseGitUrl, gitRef, GIT_PROTOCOLS } from '../src/git.js';

describe('parsePackageSpec', () => {
  it('should parse a plain name', () => {
    expect(parsePackageSpec('lodash')).toEqual({ name: 'lodash' });
  });

  it('should parse a name with an exact version', () => {
    expect(parsePackageSpec('lodash@1.2.3')).toEqual({ name: 'lodash', versionRange: '1.2.3' });
  });

  it('should parse a name with a range', () => {
    expect(parsePackageSpec('lodash@^1.2')).toEqual({ name: 'lodash', versionRange: '^1.2' });
  });

  it('should parse scoped package names', () => {
    expect(parsePackageSpec('@scope/name@1.2.3')).toEqual({ name: '@scope/name', versionRange: '1.2.3' });
  });

  it('should parse workspace specs', () => {
    expect(parsePackageSpec('workspace:*')).toEqual({ name: '', versionRange: '*', source: 'workspace' });
    expect(parsePackageSpec('workspace:^1.0.0')).toEqual({ name: '', versionRange: '^1.0.0', source: 'workspace' });
  });

  it('should parse file specs', () => {
    expect(parsePackageSpec('file:./path')).toEqual({ name: '', versionRange: './path', source: 'file' });
  });

  it('should parse git specs', () => {
    expect(parsePackageSpec('git:https://github.com/user/repo.git#v1.0.0')).toEqual({
      name: '',
      versionRange: 'https://github.com/user/repo.git#v1.0.0',
      source: 'git',
    });
    expect(parsePackageSpec('git@github.com:user/repo.git')).toEqual({ name: '', source: 'git' });
  });

  it('should leave name empty for an empty spec', () => {
    expect(parsePackageSpec('')).toEqual({ name: '' });
  });
});

describe('splitNameVersion', () => {
  it('should split name and version', () => {
    expect(splitNameVersion('lodash@1.2.3')).toEqual(['lodash', '1.2.3']);
  });

  it('should return only the name when there is no version', () => {
    expect(splitNameVersion('lodash')).toEqual(['lodash', undefined]);
  });

  it('should handle scoped names', () => {
    expect(splitNameVersion('@scope/name@1.2.3')).toEqual(['@scope/name', '1.2.3']);
    expect(splitNameVersion('@scope/name')).toEqual(['@scope/name', undefined]);
  });

  it('should split on the first @ only', () => {
    expect(splitNameVersion('a@b@c')).toEqual(['a', 'b@c']);
  });

  it('should handle empty input', () => {
    expect(splitNameVersion('')).toEqual(['', undefined]);
  });
});

describe('isValidPackageName', () => {
  it('should accept valid names', () => {
    expect(isValidPackageName('lodash')).toBe(true);
    expect(isValidPackageName('my-module')).toBe(true);
    expect(isValidPackageName('@scope/name')).toBe(true);
    expect(isValidPackageName('1st-package')).toBe(true);
  });

  it('should reject invalid names', () => {
    expect(isValidPackageName('Lodash')).toBe(false);
    expect(isValidPackageName('')).toBe(false);
    expect(isValidPackageName('bad name')).toBe(false);
    expect(isValidPackageName('bad/name')).toBe(false);
    expect(isValidPackageName('bad!name')).toBe(false);
    expect(isValidPackageName('_underscore')).toBe(false);
    expect(isValidPackageName('a'.repeat(215))).toBe(false);
  });
});

describe('normalizePackageName', () => {
  it('should lowercase and replace whitespace with hyphens', () => {
    expect(normalizePackageName('My MODULE')).toBe('my-module');
    expect(normalizePackageName('  spaced  name  ')).toBe('spaced-name');
  });

  it('should normalize scoped names', () => {
    expect(normalizePackageName('@Scope//Name')).toBe('@scope/name');
  });

  it('should strip leading and trailing slashes', () => {
    expect(normalizePackageName('/foo/')).toBe('foo');
  });
});

describe('tarballFilename', () => {
  it('should build a filename for a plain package', () => {
    expect(tarballFilename('lodash', '4.17.21')).toBe('lodash-4.17.21.tgz');
  });

  it('should flatten scoped names', () => {
    expect(tarballFilename('@scope/name', '1.0.0')).toBe('scope-name-1.0.0.tgz');
  });
});

describe('extractTarballInfo', () => {
  it('should extract name and version from .tgz', () => {
    expect(extractTarballInfo('lodash-4.17.21.tgz')).toEqual({ name: 'lodash', version: '4.17.21' });
  });

  it('should extract from .tar.gz', () => {
    expect(extractTarballInfo('foo-1.0.0.tar.gz')).toEqual({ name: 'foo', version: '1.0.0' });
  });

  it('should extract flattened scoped names', () => {
    expect(extractTarballInfo('scope-name-1.0.0.tgz')).toEqual({ name: 'scope-name', version: '1.0.0' });
  });

  it('should return null for an invalid version segment', () => {
    expect(extractTarballInfo('lodash-abc.tgz')).toBeNull();
    expect(extractTarballInfo('foo-1.0.0-beta.tgz')).toBeNull();
  });

  it('should return null for non-tarball inputs', () => {
    expect(extractTarballInfo('foo.tar.gz')).toBeNull();
    expect(extractTarballInfo('not-a-tarball')).toBeNull();
    expect(extractTarballInfo('')).toBeNull();
  });
});

describe('isTarballFilename', () => {
  it('should recognize tarball extensions case-insensitively', () => {
    expect(isTarballFilename('foo.tgz')).toBe(true);
    expect(isTarballFilename('foo.tar.gz')).toBe(true);
    expect(isTarballFilename('foo.TGZ')).toBe(true);
  });

  it('should reject non-tarball extensions', () => {
    expect(isTarballFilename('foo.zip')).toBe(false);
    expect(isTarballFilename('foo.tgz2')).toBe(false);
    expect(isTarballFilename('foo')).toBe(false);
  });
});

describe('stripTarballExt', () => {
  it('should remove tarball extensions', () => {
    expect(stripTarballExt('foo.tgz')).toBe('foo');
    expect(stripTarballExt('foo.tar.gz')).toBe('foo');
    expect(stripTarballExt('foo.TGZ')).toBe('foo');
  });

  it('should return the input unchanged when there is no extension', () => {
    expect(stripTarballExt('foo-1.0.0')).toBe('foo-1.0.0');
  });
});

describe('GIT_PROTOCOLS', () => {
  it('should list the supported git protocol schemes', () => {
    expect(GIT_PROTOCOLS).toEqual(['git', 'ssh', 'https', 'http', 'git+ssh', 'git+https', 'git+http', 'git+file']);
  });
});

describe('isGitUrl', () => {
  it('should recognize ssh shorthand', () => {
    expect(isGitUrl('git@github.com:user/repo.git')).toBe(true);
  });

  it('should recognize git: and git+ protocols', () => {
    expect(isGitUrl('git://github.com/user/repo.git')).toBe(true);
    expect(isGitUrl('git+https://github.com/user/repo.git')).toBe(true);
  });

  it('should recognize https URLs ending in .git', () => {
    expect(isGitUrl('https://github.com/user/repo.git')).toBe(true);
    expect(isGitUrl('https://github.com/user/repo')).toBe(false);
  });

  it('should reject plain values', () => {
    expect(isGitUrl('lodash')).toBe(false);
    expect(isGitUrl('')).toBe(false);
  });
});

describe('parseGitUrl', () => {
  it('should parse repo and ref', () => {
    expect(parseGitUrl('git+https://github.com/user/repo.git#v1.0.0')).toEqual({
      repo: 'https://github.com/user/repo.git',
      ref: 'v1.0.0',
    });
  });

  it('should parse sub-directory path and ref', () => {
    expect(parseGitUrl('https://github.com/user/repo.git#subdir:main')).toEqual({
      repo: 'https://github.com/user/repo.git',
      ref: 'main',
      path: 'subdir',
    });
  });

  it('should parse ssh shorthand', () => {
    expect(parseGitUrl('git@github.com:user/repo.git')).toEqual({ repo: 'git@github.com:user/repo.git' });
  });

  it('should strip trailing slashes from the repo', () => {
    expect(parseGitUrl('https://github.com/user/repo.git/')).toEqual({ repo: 'https://github.com/user/repo.git' });
  });

  it('should return null for non-git values', () => {
    expect(parseGitUrl('lodash')).toBeNull();
    expect(parseGitUrl('')).toBeNull();
  });
});

describe('gitRef', () => {
  it('should return the ref when present', () => {
    expect(gitRef('git+https://github.com/user/repo.git#v2.0.0')).toBe('v2.0.0');
  });

  it('should return undefined when no ref is present', () => {
    expect(gitRef('https://github.com/user/repo.git')).toBeUndefined();
  });
});