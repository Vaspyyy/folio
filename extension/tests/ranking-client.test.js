import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkerRanker } from "../src/ui/ranking-client.js";

function harness() {
  const workers = [];
  const rank = createWorkerRanker(() => {
    const worker = {
      terminated: false,
      postMessage(data) {
        this.data = data;
      },
      terminate() {
        this.terminated = true;
      },
    };
    workers.push(worker);
    return worker;
  });
  return { rank, workers };
}

test("worker client cancels obsolete work and delivers only the latest request", async () => {
  const { rank, workers } = harness();
  const first = rank([{ id: "old" }], {});
  const rejected = assert.rejects(first, { name: "AbortError" });
  const second = rank([{ id: "new" }], { explore: 1 });
  await rejected;
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[1].data.profile.explore, 1);
  workers[0].onmessage({ data: { results: ["obsolete"] } });
  workers[1].onmessage({ data: { results: ["latest"] } });
  assert.deepEqual(await second, ["latest"]);
  assert.equal(workers[1].terminated, true);
});

test("worker failures terminate the worker and propagate without poisoning future requests", async () => {
  const { rank, workers } = harness();
  const failure = rank([], {});
  workers[0].onmessage({ data: { error: "Invalid profile" } });
  await assert.rejects(failure, /Invalid profile/);
  assert.equal(workers[0].terminated, true);
  const success = rank([], {});
  workers[1].onmessage({ data: { results: [] } });
  assert.deepEqual(await success, []);
  const crashed = rank([], {});
  workers[2].onerror({ message: "Worker crashed", preventDefault() {} });
  await assert.rejects(crashed, /Worker crashed/);
  assert.equal(workers[2].terminated, true);
});
