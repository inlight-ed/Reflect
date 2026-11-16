import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { limitConcurrency } from "../lib/concurrency";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("limitConcurrency", () => {
  it("never runs more than the limit at once and finishes every task in arrival order", async () => {
    const slots = limitConcurrency(4);
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const tasks = Array.from({ length: 50 }, (_, index) => slots.run(async () => {
      running += 1;
      peak = Math.max(peak, running);
      started.push(index);
      await pause(5);
      running -= 1;
      return index;
    }));
    assert.equal(slots.active, 4);
    assert.equal(slots.queued, 46);
    const results = await Promise.all(tasks);
    assert.equal(peak, 4);
    assert.deepEqual(results, Array.from({ length: 50 }, (_, index) => index));
    assert.deepEqual(started, Array.from({ length: 50 }, (_, index) => index), "first come, first served");
    assert.equal(slots.active, 0);
    assert.equal(slots.queued, 0);
  });

  it("frees the slot when a task fails and calls onStart only when the slot is taken", async () => {
    const slots = limitConcurrency(1);
    const events: string[] = [];
    const failing = slots.run(async () => { events.push("a"); throw new Error("boom"); }, () => { events.push("start a"); });
    const next = slots.run(async () => { events.push("b"); return "ok"; }, () => { events.push("start b"); });
    await assert.rejects(failing, /boom/);
    assert.equal(await next, "ok");
    assert.deepEqual(events, ["start a", "a", "start b", "b"]);
    assert.equal(slots.active, 0);
  });
});
