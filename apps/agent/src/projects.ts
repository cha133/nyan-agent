import type { ProjectId } from "@nyan/protocol";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { atomicWriteJson, readJsonFile } from "./files";
import type { NyanPaths } from "./paths";

export type Project = {
  id: ProjectId;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectFile = { version: 1; projects: Project[] };

export class ProjectStore {
  private mutation = Promise.resolve();

  constructor(private readonly paths: NyanPaths, private readonly now: () => Date = () => new Date()) {}

  async list(): Promise<Project[]> {
    const file = await readJsonFile<ProjectFile>(this.paths.projectsFile);
    return [...(file?.projects ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(id: ProjectId): Promise<Project | undefined> {
    return (await this.list()).find((project) => project.id === id);
  }

  async add(inputPath: string): Promise<Project> {
    const path = resolve(inputPath);
    const details = await stat(path).catch(() => undefined);
    if (!details?.isDirectory()) throw new Error("project_path_invalid: Project path must be an existing directory");
    return this.mutate(async () => {
      const projects = await this.list();
      const existing = projects.find((project) => project.path.toLocaleLowerCase() === path.toLocaleLowerCase());
      const updatedAt = this.now().toISOString();
      const project = existing
        ? { ...existing, updatedAt }
        : { id: crypto.randomUUID() as ProjectId, name: basename(path), path, createdAt: updatedAt, updatedAt };
      await this.write([project, ...projects.filter((candidate) => candidate.id !== project.id)]);
      return project;
    });
  }

  async remove(id: ProjectId): Promise<boolean> {
    return this.mutate(async () => {
      const projects = await this.list();
      const next = projects.filter((project) => project.id !== id);
      if (next.length === projects.length) return false;
      await this.write(next);
      return true;
    });
  }

  private async write(projects: Project[]): Promise<void> {
    await atomicWriteJson(this.paths.projectsFile, { version: 1, projects } satisfies ProjectFile);
  }

  private async mutate<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.mutation;
    let release = () => {};
    this.mutation = new Promise<void>((resolve) => { release = resolve; });
    await previous.catch(() => {});
    try {
      return await action();
    } finally {
      release();
    }
  }
}
