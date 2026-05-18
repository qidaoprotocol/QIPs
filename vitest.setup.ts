// Vitest test setup — runs once per worker before any test file.
//
// Node 22+ exposes an experimental `localStorage` getter on `globalThis` that
// returns `undefined` unless the process is started with
// `--localstorage-file=<path>`. Neither happy-dom nor jsdom set it up either
// under the current Vitest 2.x environment. This shim installs a plain
// in-memory `Storage`-compatible polyfill on `window` (and `globalThis`) so
// the persistence layer's `window.localStorage.setItem/getItem/removeItem`
// calls behave correctly under test.
//
// Tests opt back to the polyfill via `window.localStorage.clear()` in
// `beforeEach`. Concurrent test files run in separate workers, so the
// in-memory store does not leak across files.

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const storage = new MemoryStorage();

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
}
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});
