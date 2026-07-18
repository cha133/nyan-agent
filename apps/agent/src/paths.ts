import { homedir } from "node:os";
import { join } from "node:path";

export type NyanPaths = {
  configDir: string;
  dataDir: string;
  stateDir: string;
  cacheDir: string;
  configFile: string;
  stateFile: string;
  modelCacheFile: string;
  sessionsDir: string;
};

type Environment = Record<string, string | undefined>;

export function resolveNyanPaths(env: Environment = process.env, home = homedir()): NyanPaths {
  const configDir = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "nyan");
  const dataDir = join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "nyan");
  const stateDir = join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "nyan");
  const cacheDir = join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "nyan");
  return {
    configDir,
    dataDir,
    stateDir,
    cacheDir,
    configFile: join(configDir, "config.toml"),
    stateFile: join(stateDir, "state.json"),
    modelCacheFile: join(cacheDir, "models.json"),
    sessionsDir: join(dataDir, "sessions"),
  };
}
