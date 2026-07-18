import type { ProjectId } from "@nyan/protocol";
import { atomicWriteJson, readJsonFile } from "./files";
import type { NyanPaths } from "./paths";

export type RuntimeState = {
  version: 1;
  recentModel?: string;
  recentProjectId?: ProjectId | null;
};

export class RuntimeStateStore {
  private mutation = Promise.resolve();

  constructor(private readonly paths: NyanPaths) {}

  async read(): Promise<RuntimeState> {
    return (await readJsonFile<RuntimeState>(this.paths.stateFile)) ?? { version: 1 };
  }

  async update(patch: Partial<Omit<RuntimeState, "version">>): Promise<RuntimeState> {
    return this.mutate(async () => {
      const next = { ...await this.read(), ...patch, version: 1 as const };
      await atomicWriteJson(this.paths.stateFile, next);
      return next;
    });
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
