import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JobStore, LeaseRejectedError, ResultRejectedError } from "../src/store.js";

const connectionString =
  process.env.TEST_DATABASE_URL ?? "postgres://hitman@127.0.0.1:5433/hitman_test";

const store = new JobStore(connectionString);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  await store.init();
});

afterAll(async () => {
  await store.close();
});

describe("durable job claiming", () => {
  it("allows exactly one concurrent claim for a queued job", async () => {
    const jobId = await store.enqueue();
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, index) => store.claimNext(`device-${index}`)),
    );
    const winners = claims.filter((claim) => claim !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.jobId).toBe(jobId);
    expect((await store.getJob(jobId))?.status).toBe("claimed");
  });

  it("finds a durable job even when no notification was delivered", async () => {
    const jobId = await store.enqueue();
    const claim = await store.claimNext("device-a");
    expect(claim?.jobId).toBe(jobId);
  });

  it("does not claim a job before its available time or after expiry", async () => {
    await store.enqueue({ method: "POST", path: "/future", availableInSeconds: 60 });
    expect(await store.claimNext("device-a")).toBeNull();

    await store.enqueue({ method: "POST", path: "/expired", expiresInSeconds: -1 });
    expect(await store.claimNext("device-a")).toBeNull();
  });
});

describe("lease and result semantics", () => {
  it("requeues a claimed-but-never-started job after lease expiry", async () => {
    const jobId = await store.enqueue();
    const first = await store.claimNext("device-a", 1);
    expect(first).not.toBeNull();
    await sleep(1_100);

    const reaped = await store.reapExpiredLeases();
    expect(reaped.requeued).toBe(1);
    expect((await store.getJob(jobId))?.status).toBe("queued");

    const second = await store.claimNext("device-a");
    expect(second?.attemptNumber).toBe(2);
  });

  it("marks a started job outcome_unknown when its lease expires", async () => {
    const jobId = await store.enqueue({ method: "POST", path: "/non-idempotent" });
    const claim = await store.claimNext("device-a", 1);
    if (!claim) throw new Error("expected claim");
    await store.start(claim.jobId, "device-a", claim.attemptId, claim.leaseToken);
    await sleep(1_100);

    const reaped = await store.reapExpiredLeases();
    expect(reaped.outcomeUnknown).toBe(1);
    expect((await store.getJob(jobId))?.status).toBe("outcome_unknown");
  });

  it("rejects a late result after the lease was reaped", async () => {
    await store.enqueue({ method: "POST", path: "/late-result" });
    const claim = await store.claimNext("device-a", 1);
    if (!claim) throw new Error("expected claim");
    await store.start(claim.jobId, "device-a", claim.attemptId, claim.leaseToken);
    await sleep(1_100);
    await store.reapExpiredLeases();

    await expect(
      store.report({
        jobId: claim.jobId,
        deviceId: "device-a",
        attemptId: claim.attemptId,
        leaseToken: claim.leaseToken,
        outcome: "succeeded",
        httpStatus: 201,
      }),
    ).rejects.toBeInstanceOf(ResultRejectedError);
    expect((await store.getJob(claim.jobId))?.status).toBe("outcome_unknown");
  });

  it("rejects reporting from the wrong device", async () => {
    await store.enqueue();
    const claim = await store.claimNext("device-a");
    if (!claim) throw new Error("expected claim");
    await store.start(claim.jobId, "device-a", claim.attemptId, claim.leaseToken);

    await expect(
      store.report({
        jobId: claim.jobId,
        deviceId: "device-b",
        attemptId: claim.attemptId,
        leaseToken: claim.leaseToken,
        outcome: "succeeded",
      }),
    ).rejects.toBeInstanceOf(ResultRejectedError);
  });

  it("rejects starting with a stale lease token", async () => {
    await store.enqueue();
    const claim = await store.claimNext("device-a");
    if (!claim) throw new Error("expected claim");
    await expect(
      store.start(claim.jobId, "device-a", claim.attemptId, "wrong-token"),
    ).rejects.toBeInstanceOf(LeaseRejectedError);
  });

  it("stores a successful result exactly once", async () => {
    await store.enqueue();
    const claim = await store.claimNext("device-a");
    if (!claim) throw new Error("expected claim");
    await store.start(claim.jobId, "device-a", claim.attemptId, claim.leaseToken);
    await store.report({
      jobId: claim.jobId,
      deviceId: "device-a",
      attemptId: claim.attemptId,
      leaseToken: claim.leaseToken,
      outcome: "succeeded",
      httpStatus: 201,
      durationMs: 42,
    });

    expect((await store.getJob(claim.jobId))?.status).toBe("succeeded");
    await expect(
      store.report({
        jobId: claim.jobId,
        deviceId: "device-a",
        attemptId: claim.attemptId,
        leaseToken: claim.leaseToken,
        outcome: "succeeded",
        httpStatus: 201,
      }),
    ).rejects.toBeInstanceOf(ResultRejectedError);
  });
});
