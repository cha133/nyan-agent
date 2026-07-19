export function configureRuntimeLogging(): void {
  globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) => {
    const context = [provider && `provider=${provider}`, model && `model=${model}`]
      .filter(Boolean)
      .join(" ");
    process.stderr.write(`[ai-sdk warning]${context ? ` ${context}` : ""} ${JSON.stringify(warnings)}\n`);
  };
}
