/**
 * Large/binary request and response bodies live behind this interface. Phase 3
 * intentionally ships only the disabled adapter; provisioning S3-compatible
 * storage is deferred until large-body support is implemented.
 */
export interface ObjectStorage {
  readonly kind: string;
  put(key: string, data: Uint8Array, options?: PutObjectOptions): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  healthCheck(): Promise<boolean>;
}

export interface PutObjectOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export class ObjectStorageUnavailableError extends Error {
  constructor(message = "Object storage is not configured") {
    super(message);
    this.name = "ObjectStorageUnavailableError";
  }
}

export class DisabledObjectStorage implements ObjectStorage {
  readonly kind = "disabled";

  async put(): Promise<void> {
    throw new ObjectStorageUnavailableError();
  }

  async get(): Promise<Uint8Array | undefined> {
    throw new ObjectStorageUnavailableError();
  }

  async delete(): Promise<void> {
    throw new ObjectStorageUnavailableError();
  }

  async healthCheck(): Promise<boolean> {
    return false;
  }
}

export function createObjectStorage(driver: "disabled"): ObjectStorage {
  switch (driver) {
    case "disabled":
      return new DisabledObjectStorage();
  }
}
