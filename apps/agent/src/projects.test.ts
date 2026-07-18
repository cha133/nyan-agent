import { describe, expect, test } from "bun:test";
import type { ProjectId } from "@nyan/protocol";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveNyanPaths } from "./paths";
import { ProjectStore } from "./projects";

describe("project store", () => {
  test("adds, deduplicates, lists and removes project directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyan-projects-"));
    const projectPath = join(root, "demo");
    await mkdir(projectPath);
    const paths = resolveNyanPaths({ XDG_CONFIG_HOME: join(root, "cfg"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache") }, root);
    let tick = 0;
    const store = new ProjectStore(paths, () => new Date(`2026-01-01T00:00:0${tick++}Z`));

    const added = await store.add(projectPath);
    const duplicate = await store.add(projectPath);
    expect(duplicate.id).toBe(added.id);
    expect(duplicate.path).toBe(resolve(projectPath));
    expect(await store.list()).toHaveLength(1);
    expect(await store.remove(added.id)).toBe(true);
    expect(await store.remove(crypto.randomUUID() as ProjectId)).toBe(false);
  });

  test("rejects paths that are not existing directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyan-project-invalid-"));
    const paths = resolveNyanPaths({ XDG_CONFIG_HOME: join(root, "cfg"), XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache") }, root);
    await expect(new ProjectStore(paths).add(join(root, "missing"))).rejects.toThrow("project_path_invalid");
  });
});
