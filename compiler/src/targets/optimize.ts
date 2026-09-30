/**
 * Shared token-optimization helper for the AI SDK targets.
 *
 * When a target is compiled with `optimizeTokens: true`, the emitted prompt
 * content is built as a list of `PromptSection`s (one per MAM module) and run
 * through `@mam/token-optimization`'s `PromptOptimizer`. The optimized text is
 * what gets embedded in the emitted program, and the savings are surfaced on
 * the `CompileResult.tokenOptimization` field.
 */

import type { V2ModuleNode } from '@mam/ast';
import { PromptOptimizer, type PromptSection } from '@mam/token-optimization';
import { generateModuleContext, type CompileTargetName } from '../context.js';
import type { TokenOptimization } from '../compiler.js';

function listBlock(label: string, items: string[]): string {
  if (!items || items.length === 0) return '';
  return `${label}\n${items.map(item => `- ${item}`).join('\n')}`;
}

/**
 * Builds the descriptive prompt content for a module — mirrors what the AI
 * targets embed as the agent/system prompt in the default (non-optimized)
 * output so the optimized text stays faithful to the source module.
 */
export function modulePromptContent(mod: V2ModuleNode): string {
  switch (mod.moduleType) {
    case 'agent':
      return [
        `${mod.name} agent`,
        mod.role ? `Role: ${mod.role}` : '',
        mod.goal ? `Goal: ${mod.goal}` : '',
        mod.handoff && mod.handoff.length > 0 ? `Handoff: ${mod.handoff.join(', ')}` : '',
        mod.rules && mod.rules.length > 0 ? listBlock('Rules', mod.rules) : '',
      ]
        .filter(Boolean)
        .join('\n');
    case 'workflow':
      return [
        `${mod.name} workflow`,
        mod.steps && mod.steps.length > 0 ? listBlock('Steps', mod.steps.map(s => s.name)) : '',
      ]
        .filter(Boolean)
        .join('\n');
    case 'team':
      return [
        `${mod.name} team`,
        mod.members && mod.members.length > 0 ? listBlock('Members', mod.members.map(String)) : '',
      ]
        .filter(Boolean)
        .join('\n');
    case 'system':
      return [
        `${mod.name}: ${mod.description || 'System composition'}`,
        mod.modules && mod.modules.length > 0
          ? listBlock('Modules to orchestrate', mod.modules.map(String))
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    default:
      return mod.description || mod.name;
  }
}

/**
 * Builds one `PromptSection` per MAM module: the module context frontmatter as
 * a `system` role, and the module's descriptive content as a `knowledge` role.
 */
export function buildPromptSections(
  modules: readonly V2ModuleNode[],
  target: CompileTargetName,
): PromptSection[] {
  const sections: PromptSection[] = [];
  for (const mod of modules) {
    sections.push({ role: 'system', content: generateModuleContext(mod, target) });
    const content = modulePromptContent(mod);
    if (content) {
      sections.push({ role: 'knowledge', content });
    }
  }
  return sections;
}

/**
 * Optimizes the prompt sections for a set of modules and returns the optimized
 * text plus the token-optimization metadata for the `CompileResult`.
 */
export function optimizePrompt(
  modules: readonly V2ModuleNode[],
  target: CompileTargetName,
): { optimizedText: string; tokenOptimization: TokenOptimization } {
  const optimizer = new PromptOptimizer();
  const result = optimizer.optimize(buildPromptSections(modules, target));
  return {
    optimizedText: result.optimizedText,
    tokenOptimization: {
      originalTokens: result.originalTokens,
      optimizedTokens: result.optimizedTokens,
      savedTokens: result.savedTokens,
      savedPercent: result.savedPercent,
    },
  };
}