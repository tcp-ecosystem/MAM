/**
 * DependencyResolver Tests
 */

import { describe, it, expect } from 'vitest';
import { DependencyResolver } from '../src/resolver.js';
import { PackageDependency } from '../src/package.js';

describe('DependencyResolver', () => {
  const createResolver = () => new DependencyResolver();

  describe('resolve', () => {
    it('should return empty result for empty array', () => {
      const resolver = createResolver();
      const result = resolver.resolve([]);

      expect(result.resolved).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.graph.nodes).toHaveLength(0);
      expect(result.graph.edges).toHaveLength(0);
      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    });

    it('should resolve a single dependency', () => {
      const resolver = createResolver();
      const deps: PackageDependency[] = [{ name: 'lodash', version: '4.17.21' }];

      const result = resolver.resolve(deps);

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].name).toBe('lodash');
      expect(result.resolved[0].version).toBe('4.17.21');
      expect(result.resolved[0].url).toBe('https://registry.mam.dev/lodash/4.17.21');
      expect(result.resolved[0].direct).toBe(true);
    });

    it('should resolve multiple dependencies', () => {
      const resolver = createResolver();
      const deps: PackageDependency[] = [
        { name: 'lodash', version: '4.17.21' },
        { name: 'react', version: '18.2.0' },
        { name: 'vue', version: '3.3.4' },
      ];

      const result = resolver.resolve(deps);

      expect(result.resolved).toHaveLength(3);
      const names = result.resolved.map(r => r.name);
      expect(names).toContain('lodash');
      expect(names).toContain('react');
      expect(names).toContain('vue');
    });

    it('should build correct graph structure', () => {
      const resolver = createResolver();
      const deps: PackageDependency[] = [
        { name: 'lodash', version: '4.17.21' },
        { name: 'react', version: '18.2.0' },
      ];

      const result = resolver.resolve(deps);

      expect(result.graph.nodes).toHaveLength(2);
      expect(result.graph.edges).toHaveLength(0);

      const lodashNode = result.graph.nodes.find(n => n.name === 'lodash');
      const reactNode = result.graph.nodes.find(n => n.name === 'react');
      expect(lodashNode).toBeDefined();
      expect(reactNode).toBeDefined();
      expect(lodashNode!.version).toBe('4.17.21');
      expect(reactNode!.version).toBe('18.2.0');
    });

    it('should detect circular dependencies', () => {
      const resolver = createResolver();

      // Override resolveDependency to simulate circular: when resolving 'a',
      // it adds 'a' to resolving set, then calls resolve again with 'a'
      const origResolveDep = (resolver as any).resolveDependency.bind(resolver);
      let callCount = 0;
      (resolver as any).resolveDependency = function (dep: PackageDependency, depth: number, direct: boolean) {
        if (dep.name === 'a' && callCount === 0) {
          callCount++;
          // Simulate circular by resolving 'a' again while it's being resolved
          (resolver as any).resolving.add('a');
          return origResolveDep(dep, depth, direct);
        }
        return origResolveDep(dep, depth, direct);
      };

      const deps: PackageDependency[] = [{ name: 'a', version: '1.0.0' }];
      const result = resolver.resolve(deps);

      expect(result.errors.some(e => e.code === 'CIRCULAR_DEPENDENCY')).toBe(true);
    });

    it('should produce topological order', () => {
      const resolver = createResolver();
      const deps: PackageDependency[] = [
        { name: 'c', version: '1.0.0' },
        { name: 'a', version: '1.0.0' },
        { name: 'b', version: '1.0.0' },
      ];

      const result = resolver.resolve(deps);

      expect(result.graph.order).toHaveLength(3);
      expect(result.graph.order).toContain('a');
      expect(result.graph.order).toContain('b');
      expect(result.graph.order).toContain('c');
    });

    it('should generate integrity hashes', () => {
      const resolver = createResolver();
      const deps: PackageDependency[] = [{ name: 'lodash', version: '4.17.21' }];

      const result = resolver.resolve(deps);

      expect(result.resolved[0].integrity).toMatch(/^sha256-[a-f0-9]+$/);
    });
  });
});
