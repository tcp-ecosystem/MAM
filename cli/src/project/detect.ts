/**
 * Project detection helper — locate a `mam.toml` from a starting directory.
 */

import { Project } from './loader.js';

/**
 * Find and load the nearest MAM project, or null when none exists.
 */
export async function findProject(startDir: string = process.cwd()): Promise<Project | null> {
  const manifestPath = await Project.findManifest(startDir);
  if (!manifestPath) return null;
  try {
    return await Project.load(startDir);
  } catch {
    return null;
  }
}
