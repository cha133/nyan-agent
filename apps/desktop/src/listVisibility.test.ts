import { describe, expect, test } from "bun:test";
import { INITIAL_VISIBLE_ITEMS, nextVisibleLimit, resetVisibleLimits, visibleItems, visibleLimit } from "./listVisibility";

describe("sidebar list visibility", () => {
  test("starts with five visible items", () => {
    expect(visibleLimit({}, "projects")).toBe(INITIAL_VISIBLE_ITEMS);
    expect(visibleItems(Array.from({ length: 20 }, (_, index) => index), INITIAL_VISIBLE_ITEMS)).toEqual([0, 1, 2, 3, 4]);
  });

  test("reveals ten more items on every expansion", () => {
    expect(nextVisibleLimit(5, 30)).toBe(15);
    expect(nextVisibleLimit(15, 30)).toBe(25);
    expect(nextVisibleLimit(25, 30)).toBe(30);
  });

  test("collapses only after every item is visible", () => {
    expect(nextVisibleLimit(5, 15)).toBe(15);
    expect(nextVisibleLimit(15, 15)).toBe(INITIAL_VISIBLE_ITEMS);
  });

  test("does not grow past the list length", () => {
    expect(nextVisibleLimit(5, 6)).toBe(6);
  });

  test("resetting a parent also resets every descendant list", () => {
    expect(resetVisibleLimits({ projects: 25, "project:a": 15, "project:b": 30, tasks: 15 }, "projects", "project:")).toEqual({
      projects: 5,
      "project:a": 5,
      "project:b": 5,
      tasks: 15,
    });
  });
});
