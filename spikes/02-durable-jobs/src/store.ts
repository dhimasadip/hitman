import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

export type JobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "outcome_unknown"
  | "expired"
  | "cancelled";

export interface ClaimedJob {
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  leaseToken: string;
  leaseExpiresAt: Date;
  method: string;
  path: string;
}

export interface ReapResult {
  requeued: number;
  outcomeUnknown: number;
  expired: number;
}

export class LeaseRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaseRejectedError";
  }
}

export class ResultRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultRejectedError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const SCHEMA = `
create schema if not exists spike_jobs;

drop table if exists spike_jobs.results;
drop table if exists spike_jobs.attempts;
drop table if exists spike_jobs.jobs;

create table spike_jobs.jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in (
    'queued','claimed','running','succeeded','failed','timed_out',
    'outcome_unknown','expired','cancelled'
  )),
  method text not null,
  path text not null,
  device_id text,
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_claim_idx on spike_jobs.jobs (status, available_at, created_at);
create index jobs_device_idx on spike_jobs.jobs (device_id, status);

create table spike_jobs.attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references spike_jobs.jobs(id) on delete cascade,
  attempt_number integer not null,
  device_id text not null,
  status text not null check (status in (
    'claimed','running','succeeded','failed','timed_out','outcome_unknown','abandoned'
  )),
  lease_token_hash text not null,
  claimed_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  failure_code text,
  unique (job_id, attempt_number)
);

create table spike_jobs.results (
  job_id uuid primary key references spike_jobs.jobs(id) on delete cascade,
  attempt_id uuid not null references spike_jobs.attempts(id),
  outcome text not null,
  http_status integer,
  duration_ms bigint,
  created_at timestamptz not null default now()
);
`;

export class JobStore {
  readonly pool: pg.Pool;

  constructor(connectionString: string, maxConnections = 10) {
    this.pool = new Pool({ connectionString, max: maxConnections });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async enqueue(
    input: {
      method: string;
      path: string;
      expiresInSeconds?: number;
      availableInSeconds?: number;
    } = {
      method: "POST",
      path: "/api/v1/bas",
    },
  ): Promise<string> {
    const expiresIn = input.expiresInSeconds ?? 900;
    const availableIn = input.availableInSeconds ?? 0;
    const result = await this.pool.query<{ id: string }>(
      `insert into spike_jobs.jobs (status, method, path, available_at, expires_at)
       values ('queued', $1, $2, now() + ($3 || ' seconds')::interval, now() + ($4 || ' seconds')::interval)
       returning id`,
      [input.method, input.path, availableIn, expiresIn],
    );
    const row = result.rows[0];
    if (!row) throw new Error("enqueue did not return a job");
    return row.id;
  }

  async claimNext(deviceId: string, leaseSeconds = 30): Promise<ClaimedJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const candidate = await client.query<{
        id: string;
        method: string;
        path: string;
        attempt_count: number;
      }>(
        `select id, method, path, attempt_count
           from spike_jobs.jobs
          where status = 'queued'
            and available_at <= now()
            and expires_at > now()
          order by available_at, created_at
          for update skip locked
          limit 1`,
      );
      const job = candidate.rows[0];
      if (!job) {
        await client.query("commit");
        return null;
      }

      const leaseToken = randomBytes(32).toString("base64url");
      const leaseHash = hashToken(leaseToken);
      const attemptNumber = job.attempt_count + 1;

      const updated = await client.query<{ lease_expires_at: Date }>(
        `update spike_jobs.jobs
            set status = 'claimed',
                device_id = $2,
                claimed_at = now(),
                lease_expires_at = now() + ($3 || ' seconds')::interval,
                attempt_count = $4,
                updated_at = now()
          where id = $1
          returning lease_expires_at`,
        [job.id, deviceId, leaseSeconds, attemptNumber],
      );

      const attempt = await client.query<{ id: string }>(
        `insert into spike_jobs.attempts
           (job_id, attempt_number, device_id, status, lease_token_hash)
         values ($1, $2, $3, 'claimed', $4)
         returning id`,
        [job.id, attemptNumber, deviceId, leaseHash],
      );

      await client.query("commit");
      const leaseExpiresAt = updated.rows[0]?.lease_expires_at;
      const attemptId = attempt.rows[0]?.id;
      if (!leaseExpiresAt || !attemptId) throw new Error("claim did not return lease data");
      return {
        jobId: job.id,
        attemptId,
        attemptNumber,
        leaseToken,
        leaseExpiresAt,
        method: job.method,
        path: job.path,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async start(
    jobId: string,
    deviceId: string,
    attemptId: string,
    leaseToken: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const attempt = await client.query(
        `update spike_jobs.attempts
            set status = 'running', started_at = now()
          where id = $1
            and job_id = $2
            and device_id = $3
            and status = 'claimed'
            and lease_token_hash = $4
          returning id`,
        [attemptId, jobId, deviceId, hashToken(leaseToken)],
      );
      if (attempt.rowCount !== 1) throw new LeaseRejectedError("attempt is not claimable");

      const job = await client.query(
        `update spike_jobs.jobs
            set status = 'running', started_at = now(), updated_at = now()
          where id = $1
            and status = 'claimed'
            and device_id = $2
            and lease_expires_at > now()
          returning id`,
        [jobId, deviceId],
      );
      if (job.rowCount !== 1)
        throw new LeaseRejectedError("lease is expired or belongs to another device");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async report(input: {
    jobId: string;
    deviceId: string;
    attemptId: string;
    leaseToken: string;
    outcome: "succeeded" | "failed" | "timed_out";
    httpStatus?: number;
    durationMs?: number;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const attempt = await client.query(
        `update spike_jobs.attempts
            set status = $5, finished_at = now()
          where id = $1
            and job_id = $2
            and device_id = $3
            and status = 'running'
            and lease_token_hash = $4
          returning id`,
        [input.attemptId, input.jobId, input.deviceId, hashToken(input.leaseToken), input.outcome],
      );
      if (attempt.rowCount !== 1) throw new ResultRejectedError("stale attempt or device");

      const job = await client.query(
        `update spike_jobs.jobs
            set status = $2, finished_at = now(), updated_at = now()
          where id = $1
            and status = 'running'
            and device_id = $3
            and lease_expires_at > now()
          returning id`,
        [input.jobId, input.outcome, input.deviceId],
      );
      if (job.rowCount !== 1) throw new ResultRejectedError("lease expired or job is terminal");

      await client.query(
        `insert into spike_jobs.results (job_id, attempt_id, outcome, http_status, duration_ms)
         values ($1, $2, $3, $4, $5)`,
        [
          input.jobId,
          input.attemptId,
          input.outcome,
          input.httpStatus ?? null,
          input.durationMs ?? null,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Lease reaping is deliberately conservative:
   * - claimed but never started: safe to requeue (no HTTP request was sent)
   * - running at expiry: outcome_unknown (the request may have reached the target)
   */
  async reapExpiredLeases(): Promise<ReapResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const expiredQueued = await client.query(
        `update spike_jobs.jobs
            set status = 'expired', finished_at = now(), updated_at = now()
          where status = 'queued' and expires_at <= now()
          returning id`,
      );

      const staleClaimed = await client.query<{ id: string; attempt_id: string | null }>(
        `select j.id, (
            select a.id from spike_jobs.attempts a
             where a.job_id = j.id order by a.attempt_number desc limit 1
          ) as attempt_id
           from spike_jobs.jobs j
          where j.status = 'claimed' and j.lease_expires_at <= now()
          for update of j skip locked`,
      );

      for (const row of staleClaimed.rows) {
        await client.query(
          `update spike_jobs.jobs
              set status = 'queued', device_id = null, claimed_at = null,
                  lease_expires_at = null, available_at = now(), updated_at = now()
            where id = $1`,
          [row.id],
        );
        if (row.attempt_id) {
          await client.query(
            `update spike_jobs.attempts
                set status = 'abandoned', finished_at = now(), failure_code = 'lease_expired_before_start'
              where id = $1`,
            [row.attempt_id],
          );
        }
      }

      const staleRunning = await client.query<{ id: string; attempt_id: string | null }>(
        `select j.id, (
            select a.id from spike_jobs.attempts a
             where a.job_id = j.id order by a.attempt_number desc limit 1
          ) as attempt_id
           from spike_jobs.jobs j
          where j.status = 'running' and j.lease_expires_at <= now()
          for update of j skip locked`,
      );

      for (const row of staleRunning.rows) {
        await client.query(
          `update spike_jobs.jobs
              set status = 'outcome_unknown', finished_at = now(), updated_at = now()
            where id = $1`,
          [row.id],
        );
        if (row.attempt_id) {
          await client.query(
            `update spike_jobs.attempts
                set status = 'outcome_unknown', finished_at = now(), failure_code = 'result_lost'
              where id = $1`,
            [row.attempt_id],
          );
        }
      }

      await client.query("commit");
      return {
        requeued: staleClaimed.rowCount ?? 0,
        outcomeUnknown: staleRunning.rowCount ?? 0,
        expired: expiredQueued.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getJob(jobId: string): Promise<{ status: JobStatus; attemptCount: number } | null> {
    const result = await this.pool.query<{ status: JobStatus; attempt_count: number }>(
      "select status, attempt_count from spike_jobs.jobs where id = $1",
      [jobId],
    );
    const row = result.rows[0];
    return row ? { status: row.status, attemptCount: row.attempt_count } : null;
  }
}
