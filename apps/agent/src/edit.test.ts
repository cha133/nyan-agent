import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EditManager, findMatch } from "./edit";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nyan-edit-test-"));
  roots.push(root);
  return root;
}

describe("edit manager", () => {
  test("applies an exact replacement and returns diff statistics", async () => {
    const cwd = await workspace();
    const file = join(cwd, "file.ts");
    await writeFile(file, "alpha\nbeta\ngamma\n", "utf8");
    const result = await new EditManager().execute({ filePath: "file.ts", oldText: "beta", newText: "delta" }, { cwd });

    expect(await readFile(file, "utf8")).toBe("alpha\ndelta\ngamma\n");
    expect(result).toMatchObject({ status: "updated", filePath: file, strategy: "exact", replacements: 1, additions: 1, deletions: 1, diffTruncated: false });
    expect(result.diff).toContain("-beta\n+delta");
  });

  test("preserves a UTF-8 BOM and CRLF line endings", async () => {
    const cwd = await workspace();
    const file = join(cwd, "bom.txt");
    await writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("一\r\n旧\r\n三\r\n", "utf8")]));
    await new EditManager().execute({ filePath: file, oldText: "旧\n三", newText: "新\n四" }, { cwd });

    const actual = await readFile(file);
    expect([...actual.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(actual.subarray(3).toString("utf8")).toBe("一\r\n新\r\n四\r\n");
  });

  test("uses line-trimmed matching for harmless line whitespace drift", async () => {
    const cwd = await workspace();
    const file = join(cwd, "trim.ts");
    await writeFile(file, "function run() {\n  return 1\n}\n", "utf8");
    const result = await new EditManager().execute({
      filePath: file,
      oldText: " function run() { \n return 1 \n }",
      newText: "function run() {\n  return 2\n}",
    }, { cwd });
    expect(result.strategy).toBe("line-trimmed");
    expect(await readFile(file, "utf8")).toBe("function run() {\n  return 2\n}\n");
  });

  test("uses indentation-flexible matching with boundary blank lines", async () => {
    const cwd = await workspace();
    const file = join(cwd, "indent.ts");
    await writeFile(file, "if (ok) {\n  run()\n}\n", "utf8");
    const result = await new EditManager().execute({
      filePath: file,
      oldText: "\n    if (ok) {\n      run()\n    }\n",
      newText: "if (ok) {\n  await run()\n}",
    }, { cwd });
    expect(result.strategy).toBe("indentation-flexible");
    expect(await readFile(file, "utf8")).toBe("if (ok) {\n  await run()\n}\n");
  });

  test("maps whitespace-normalized matches back to the real source span", async () => {
    const cwd = await workspace();
    const file = join(cwd, "space.ts");
    await writeFile(file, "const\t value   =\t1;\n", "utf8");
    const result = await new EditManager().execute({ filePath: file, oldText: "const value = 1;", newText: "const value = 2;" }, { cwd });
    expect(result.strategy).toBe("whitespace-normalized");
    expect(await readFile(file, "utf8")).toBe("const value = 2;\n");
  });

  test("accepts one similar block-anchor candidate", async () => {
    const cwd = await workspace();
    const file = join(cwd, "anchor.ts");
    await writeFile(file, "function configure() {\n  const enabled = false\n}\n", "utf8");
    const result = await new EditManager().execute({
      filePath: file,
      oldText: "function configure() {\n  const enabled = true\n}",
      newText: "function configure() {\n  const enabled = true\n  start()\n}",
    }, { cwd });
    expect(result.strategy).toBe("block-anchor");
    expect(await readFile(file, "utf8")).toContain("start()");
  });

  test("rejects unrelated block-anchor content without writing", async () => {
    const cwd = await workspace();
    const file = join(cwd, "unsafe.ts");
    const original = "function configure() {\n  removeAllUserData()\n}\n";
    await writeFile(file, original, "utf8");
    await expect(new EditManager().execute({
      filePath: file,
      oldText: "function configure() {\n  const enabled = true\n}",
      newText: "function configure() {\n  const enabled = false\n}",
    }, { cwd })).rejects.toThrow("edit_match_not_found");
    expect(await readFile(file, "utf8")).toBe(original);
  });

  test("requires unique matches unless replaceAll is explicit", async () => {
    const cwd = await workspace();
    const file = join(cwd, "many.txt");
    await writeFile(file, "foo foo foo", "utf8");
    const manager = new EditManager();
    await expect(manager.execute({ filePath: file, oldText: "foo", newText: "bar" }, { cwd })).rejects.toThrow("edit_multiple_matches");
    const result = await manager.execute({ filePath: file, oldText: "foo", newText: "bar", replaceAll: true }, { cwd });
    expect(result.replacements).toBe(3);
    expect(await readFile(file, "utf8")).toBe("bar bar bar");
  });

  test("replaceAll skips overlapping fuzzy line-block candidates", async () => {
    const cwd = await workspace();
    const file = join(cwd, "overlap.txt");
    await writeFile(file, " x \n x \n x ", "utf8");
    const result = await new EditManager().execute({ filePath: file, oldText: "x\nx", newText: "y", replaceAll: true }, { cwd });
    expect(result).toMatchObject({ strategy: "line-trimmed", replacements: 1 });
    expect(await readFile(file, "utf8")).toBe("y\n x ");
  });

  test("rejects a whitespace match whose real span is disproportionate", async () => {
    const cwd = await workspace();
    const file = join(cwd, "wide.txt");
    const original = `a${" ".repeat(700)}b`;
    await writeFile(file, original, "utf8");
    await expect(new EditManager().execute({ filePath: file, oldText: "a b", newText: "safe" }, { cwd })).rejects.toThrow("edit_match_too_large");
    expect(await readFile(file, "utf8")).toBe(original);
  });

  test("creates a nested UTF-8 file only with empty oldText", async () => {
    const cwd = await workspace();
    const manager = new EditManager();
    const result = await manager.execute({ filePath: "nested/new.txt", oldText: "", newText: "你好\n" }, { cwd });
    expect(result).toMatchObject({ status: "created", strategy: "create", additions: 1, deletions: 0 });
    expect(await readFile(join(cwd, "nested/new.txt"), "utf8")).toBe("你好\n");
    expect((await readdir(join(cwd, "nested"))).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  test("rejects empty oldText for existing files and nonempty oldText for missing files", async () => {
    const cwd = await workspace();
    await writeFile(join(cwd, "existing.txt"), "content", "utf8");
    const manager = new EditManager();
    await expect(manager.execute({ filePath: "existing.txt", oldText: "", newText: "overwrite" }, { cwd })).rejects.toThrow("edit_empty_old_text");
    await expect(manager.execute({ filePath: "missing.txt", oldText: "old", newText: "new" }, { cwd })).rejects.toThrow("edit_file_not_found");
  });

  test("rejects identical text, directories, invalid UTF-8, and pre-aborted edits", async () => {
    const cwd = await workspace();
    const manager = new EditManager();
    const file = join(cwd, "file.txt");
    await writeFile(file, "same", "utf8");
    await mkdir(join(cwd, "directory"));
    await writeFile(join(cwd, "binary.bin"), Buffer.from([0xff, 0xfe, 0xfd]));
    await expect(manager.execute({ filePath: file, oldText: "same", newText: "same" }, { cwd })).rejects.toThrow("edit_no_change");
    await expect(manager.execute({ filePath: "directory", oldText: "a", newText: "b" }, { cwd })).rejects.toThrow("edit_not_regular_file");
    await expect(manager.execute({ filePath: "binary.bin", oldText: "a", newText: "b" }, { cwd })).rejects.toThrow("edit_invalid_utf8");
    const controller = new AbortController();
    controller.abort();
    await expect(manager.execute({ filePath: file, oldText: "same", newText: "changed" }, { cwd, abortSignal: controller.signal })).rejects.toThrow("edit_cancelled");
    expect(await readFile(file, "utf8")).toBe("same");
  });

  test("serializes concurrent edits to the same file", async () => {
    const cwd = await workspace();
    const file = join(cwd, "serial.txt");
    await writeFile(file, "alpha", "utf8");
    const manager = new EditManager();
    await Promise.all([
      manager.execute({ filePath: file, oldText: "alpha", newText: "beta" }, { cwd }),
      manager.execute({ filePath: file, oldText: "beta", newText: "gamma" }, { cwd }),
    ]);
    expect(await readFile(file, "utf8")).toBe("gamma");
  });
});

describe("edit matcher", () => {
  test("block-anchor refuses multiple similar candidates even with replaceAll", () => {
    const block = "function x() {\n  const enabled = false\n}";
    expect(() => findMatch(`${block}\n${block}`, "function x() {\n  const enabled = true\n}", true)).toThrow("edit_multiple_matches");
  });
});
