const fsp = require("node:fs/promises");
const path = require("node:path");

/**
 * A tiny JSON-array "database" file.
 *
 * - update() calls are queued, so two requests can never read-modify-write the
 *   same file at the same time (this is what stops two hospitals both winning
 *   an accept).
 * - Writes go to a temporary file first and are then renamed, so a crash in
 *   the middle of a write cannot leave a half-written file.
 * - A corrupt file raises an error instead of silently being replaced by [].
 *
 * Limitation: this is fine for ONE server process and a demo. It is not a
 * replacement for a real database (no multi-process safety, no indexes).
 */
function createStore(file, fallback = []) {
  let queue = Promise.resolve();

  async function read() {
    let content;
    try {
      content = await fsp.readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(fallback);
      throw error;
    }
    let data;
    try {
      data = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `${path.basename(file)} contains invalid JSON. Fix or delete it ` +
          `(a backup is not created automatically). ${error.message}`
      );
    }
    if (!Array.isArray(data)) {
      throw new Error(`${path.basename(file)} must contain a JSON array.`);
    }
    return data;
  }

  async function write(data) {
    const temp = `${file}.tmp`;
    await fsp.writeFile(temp, JSON.stringify(data, null, 2), "utf8");
    await fsp.rename(temp, file);
  }

  /** fn(data) may mutate the array and return a value; the array is then saved. */
  function update(fn) {
    const run = queue.then(async () => {
      const data = await read();
      const result = await fn(data);
      await write(data);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return { read, update };
}

module.exports = { createStore };
