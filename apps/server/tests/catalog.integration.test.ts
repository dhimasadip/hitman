import type {
  ApiRequestDetail,
  ApiSpecificationDetail,
  CollectionDetail,
  ImportSpecificationResponse,
  ProjectDetail,
} from "@hitman/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authenticatedHeaders,
  createTestContext,
  login,
  TEST_PASSWORD,
  type TestContext,
  testDatabaseUrl,
  truncateIdentityTables,
} from "./helpers/identity.js";

const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SPEC_30 = `openapi: 3.0.3
info:
  title: Catalog API
  version: 1.0.0
paths:
  /items:
    get:
      operationId: listItems
      summary: List items
      tags: [items]
      responses:
        "200":
          description: Items
    post:
      operationId: createItem
      summary: Create an item
      tags: [items]
      requestBody:
        content:
          application/json:
            schema:
              type: object
      responses:
        "201":
          description: Created
`;

const SPEC_30_V2 = SPEC_30.replace("version: 1.0.0", "version: 1.1.0").replace(
  "summary: Create an item",
  "summary: Create an item (updated)",
);

const SPEC_31 = `openapi: 3.1.0
info:
  title: Second API
  version: 0.1.0
paths:
  /health:
    get:
      operationId: health
      responses:
        "200":
          description: Healthy
`;

const SPEC_32 = `openapi: 3.2.1
info:
  title: Future API
  version: 1.0.0
paths:
  /future:
    get:
      operationId: future
      responses:
        "200":
          description: Future
`;

const INVALID_SPEC = `openapi: 3.0.3
info:
  version: 1.0.0
paths:
  /broken:
    get:
      responses:
        "200":
          description: Missing title
`;

describeWithDatabase("catalog, OpenAPI import, collections, and request versions", () => {
  let context: TestContext;

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
    context = await createTestContext(testDatabaseUrl);
  });

  beforeEach(async () => {
    await truncateIdentityTables(context.database);
  });

  afterAll(async () => {
    await context?.app.close();
    await context?.database.close();
  });

  async function seedAdmin() {
    const result = await context.services.provisioning.bootstrapOrganization({
      organizationName: "Catalog Org",
      organizationSlug: "catalog-org",
      email: "catalog-admin@example.test",
      displayName: "Catalog Admin",
      password: TEST_PASSWORD,
    });
    const loginResult = await login(context.app, "catalog-admin@example.test");
    return { ...result, ...loginResult, cookies: loginResult.cookies };
  }

  async function createProject(
    cookies: Awaited<ReturnType<typeof login>>["cookies"],
    organizationId: string,
    slug = "catalog-project",
  ): Promise<ProjectDetail> {
    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/projects`,
      headers: authenticatedHeaders(cookies),
      payload: { name: "Catalog Project", slug },
    });
    expect(response.statusCode).toBe(201);
    return response.json<ProjectDetail>();
  }

  async function addOrgMember(email: string, role: "member" | "read_only") {
    return context.services.provisioning.addUserToOrganization({
      organizationSlug: "catalog-org",
      email,
      displayName: email.split("@")[0],
      role,
      password: TEST_PASSWORD,
    });
  }

  async function importSpec(
    cookies: Awaited<ReturnType<typeof login>>["cookies"],
    projectId: string,
    content: string,
    overrides: Record<string, unknown> = {},
  ): Promise<ImportSpecificationResponse> {
    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/specifications/import`,
      headers: authenticatedHeaders(cookies),
      payload: {
        sourceKind: "upload",
        content,
        fileName: "openapi.yaml",
        ...overrides,
      },
    });
    if (response.statusCode !== 201) {
      throw new Error(`import failed: ${response.statusCode} ${response.body}`);
    }
    return response.json<ImportSpecificationResponse>();
  }

  it("imports OpenAPI 3.0, extracts operations, and lists the current version", async () => {
    const admin = await seedAdmin();
    const project = await createProject(admin.cookies, admin.organizationId);
    const imported = await importSpec(admin.cookies, project.id, SPEC_30);

    expect(imported.specification.label).toBe("Catalog API");
    expect(imported.specification.currentVersionNumber).toBe(1);
    expect(imported.specification.validationStatus).toBe("valid");
    expect(imported.version.operationCount).toBe(2);
    expect(imported.version.validationStatus).toBe("valid");

    const specs = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/specifications`,
      headers: { cookie: admin.cookies.cookie },
    });
    expect(specs.statusCode).toBe(200);
    expect(specs.json().specifications).toHaveLength(1);

    const operations = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/operations`,
      headers: { cookie: admin.cookies.cookie },
    });
    expect(operations.statusCode).toBe(200);
    expect(operations.json().operations).toHaveLength(2);
    expect(operations.json().operations[0].operationKey).toBe("listItems");

    const audit = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/audit-events`,
      headers: { cookie: admin.cookies.cookie },
    });
    expect(
      (audit.json().events as Array<{ action: string }>).some(
        (event) => event.action === "api_specification.imported",
      ),
    ).toBe(true);
  });

  it("supports multiple logical specs, new versions, and content deduplication", async () => {
    const admin = await seedAdmin();
    const project = await createProject(admin.cookies, admin.organizationId);
    const first = await importSpec(admin.cookies, project.id, SPEC_30);
    const second = await importSpec(admin.cookies, project.id, SPEC_31);
    expect(first.specification.id).not.toBe(second.specification.id);

    const v2 = await importSpec(admin.cookies, project.id, SPEC_30_V2, {
      specificationId: first.specification.id,
    });
    expect(v2.specification.currentVersionNumber).toBe(2);
    expect(v2.version.versionNumber).toBe(2);

    const duplicate = await importSpec(admin.cookies, project.id, SPEC_30_V2, {
      specificationId: first.specification.id,
    });
    expect(duplicate.deduplicated).toBe(true);
    expect(duplicate.version.versionNumber).toBe(2);

    const detailResponse = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/specifications/${first.specification.id}`,
      headers: { cookie: admin.cookies.cookie },
    });
    const detail = detailResponse.json<ApiSpecificationDetail>();
    expect(detail.versions).toHaveLength(2);
    expect(detail.currentVersionNumber).toBe(2);
  });

  it("rejects OpenAPI 3.2.x without creating a specification", async () => {
    const admin = await seedAdmin();
    const project = await createProject(admin.cookies, admin.organizationId);
    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/specifications/import`,
      headers: authenticatedHeaders(admin.cookies),
      payload: { sourceKind: "upload", content: SPEC_32, fileName: "future.yaml" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");

    const specs = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/specifications`,
      headers: { cookie: admin.cookies.cookie },
    });
    expect(specs.json().specifications).toHaveLength(0);
  });

  it("stores invalid imports without replacing the last valid current version", async () => {
    const admin = await seedAdmin();
    const project = await createProject(admin.cookies, admin.organizationId);
    const valid = await importSpec(admin.cookies, project.id, SPEC_30);
    const invalid = await importSpec(admin.cookies, project.id, INVALID_SPEC, {
      specificationId: valid.specification.id,
    });

    expect(invalid.version.validationStatus).toBe("invalid");
    expect(invalid.version.validationReport.errors).toBeTruthy();

    const detailResponse = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/specifications/${valid.specification.id}`,
      headers: { cookie: admin.cookies.cookie },
    });
    const detail = detailResponse.json<ApiSpecificationDetail>();
    expect(detail.currentVersionNumber).toBe(1);
    expect(detail.versions).toHaveLength(2);
  });

  it("imports an OpenAPI file from the linked mock repository path", async () => {
    const admin = await seedAdmin();
    const project = await createProject(admin.cookies, admin.organizationId);
    const link = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/repository`,
      headers: authenticatedHeaders(admin.cookies),
      payload: { externalProjectId: "1001" },
    });
    expect(link.statusCode).toBe(201);

    const response = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/specifications/import`,
      headers: authenticatedHeaders(admin.cookies),
      payload: { sourceKind: "repository" },
    });
    expect(response.statusCode).toBe(201);
    const imported = response.json<ImportSpecificationResponse>();
    expect(imported.version.sourceKind).toBe("repository");
    expect(imported.version.sourceRef).toBe("openapi/openapi.yaml");
    expect(imported.operationCount).toBe(2);
  });

  it("manages collections and nested folders with empty-only deletion", async () => {
    const admin = await seedAdmin();
    const project = await createProject(admin.cookies, admin.organizationId);
    const collectionResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/collections`,
      headers: authenticatedHeaders(admin.cookies),
      payload: { name: "Core" },
    });
    expect(collectionResponse.statusCode).toBe(201);
    const collection = collectionResponse.json<CollectionDetail>();

    const folderResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/collections/${collection.id}/folders`,
      headers: authenticatedHeaders(admin.cookies),
      payload: { name: "Items" },
    });
    expect(folderResponse.statusCode).toBe(201);
    const folder = folderResponse.json<{ id: string }>();

    const requestResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/requests`,
      headers: authenticatedHeaders(admin.cookies),
      payload: {
        name: "Create item",
        collectionId: collection.id,
        folderId: folder.id,
        tags: ["items"],
        request: { method: "POST", path: "/items" },
      },
    });
    expect(requestResponse.statusCode).toBe(201);

    const deleteCollection = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/collections/${collection.id}`,
      headers: authenticatedHeaders(admin.cookies),
    });
    expect(deleteCollection.statusCode).toBe(409);

    const deleteFolder = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${project.id}/collections/${collection.id}/folders/${folder.id}`,
      headers: authenticatedHeaders(admin.cookies),
    });
    expect(deleteFolder.statusCode).toBe(409);
  });

  it("creates draft requests with immutable versions and preserves ordered duplicate entries", async () => {
    const admin = await seedAdmin();
    const project = await createProject(admin.cookies, admin.organizationId);
    const createResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/requests`,
      headers: authenticatedHeaders(admin.cookies),
      payload: {
        name: "Create item",
        tags: ["items", "write"],
        request: {
          method: "POST",
          path: "/items",
          queryParams: [
            { key: "limit", value: "1", enabled: true },
            { key: "limit", value: "2", enabled: false },
          ],
          headers: [
            { key: "Accept", value: "application/json", enabled: true },
            { key: "Accept", value: "text/plain", enabled: false },
          ],
          authConfig: { type: "bearer", tokenSecretRef: "env://CATALOG_TEST_TOKEN" },
          body: { kind: "json", value: { name: "Example" } },
        },
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<ApiRequestDetail>();
    expect(created.requestLifecycle).toBe("draft");
    expect(created.currentVersionNumber).toBe(1);
    expect(created.version.queryParams).toHaveLength(2);
    expect(created.version.headers).toHaveLength(2);
    expect(created.version.authConfig).toEqual({
      type: "bearer",
      tokenSecretRef: "env://CATALOG_TEST_TOKEN",
    });

    const update = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/requests/${created.id}`,
      headers: authenticatedHeaders(admin.cookies),
      payload: {
        expectedVersionNumber: 1,
        requestLifecycle: "ready",
        changeSummary: "Second version",
        request: {
          method: "POST",
          path: "/items",
          queryParams: created.version.queryParams,
          headers: created.version.headers,
          authConfig: created.version.authConfig,
          body: { kind: "json", value: { name: "Updated" } },
        },
      },
    });
    expect(update.statusCode).toBe(200);
    const updated = update.json<ApiRequestDetail>();
    expect(updated.currentVersionNumber).toBe(2);
    expect(updated.requestLifecycle).toBe("ready");

    const versions = await context.app.inject({
      method: "GET",
      url: `/api/v1/requests/${created.id}/versions`,
      headers: { cookie: admin.cookies.cookie },
    });
    expect(versions.statusCode).toBe(200);
    expect(versions.json().versions).toHaveLength(2);

    const oldVersion = await context.app.inject({
      method: "GET",
      url: `/api/v1/requests/${created.id}/versions/${created.version.id}`,
      headers: { cookie: admin.cookies.cookie },
    });
    expect(oldVersion.statusCode).toBe(200);
    expect(oldVersion.json().body.value).toEqual({ name: "Example" });

    const conflict = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/requests/${created.id}`,
      headers: authenticatedHeaders(admin.cookies),
      payload: { expectedVersionNumber: 1, name: "Stale edit" },
    });
    expect(conflict.statusCode).toBe(409);

    const audit = await context.app.inject({
      method: "GET",
      url: `/api/v1/organizations/${admin.organizationId}/audit-events`,
      headers: { cookie: admin.cookies.cookie },
    });
    const actions = (audit.json().events as Array<{ action: string }>).map((event) => event.action);
    expect(actions).toContain("api_request.created");
    expect(actions).toContain("api_request.updated");
  });

  it("searches requests by tag/method and archives them", async () => {
    const admin = await seedAdmin();
    const project = await createProject(admin.cookies, admin.organizationId);
    const createdResponse = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/requests`,
      headers: authenticatedHeaders(admin.cookies),
      payload: {
        name: "Tagged request",
        tags: ["smoke"],
        request: { method: "GET", path: "/tagged" },
      },
    });
    const created = createdResponse.json<ApiRequestDetail>();

    for (const query of ["tag=smoke", "method=GET", "q=tagged"]) {
      const response = await context.app.inject({
        method: "GET",
        url: `/api/v1/projects/${project.id}/requests?${query}`,
        headers: { cookie: admin.cookies.cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().requests).toHaveLength(1);
    }

    const archived = await context.app.inject({
      method: "POST",
      url: `/api/v1/requests/${created.id}/archive`,
      headers: authenticatedHeaders(admin.cookies),
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json<ApiRequestDetail>().requestLifecycle).toBe("archived");

    const edit = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/requests/${created.id}`,
      headers: authenticatedHeaders(admin.cookies),
      payload: { name: "Cannot edit" },
    });
    expect(edit.statusCode).toBe(409);
  });

  it("enforces project editor/write and viewer/read permissions", async () => {
    const admin = await seedAdmin();
    const project = await createProject(admin.cookies, admin.organizationId);
    await addOrgMember("catalog-editor@example.test", "member");
    await addOrgMember("catalog-viewer@example.test", "member");

    for (const [email, role] of [
      ["catalog-editor@example.test", "editor"],
      ["catalog-viewer@example.test", "viewer"],
    ] as const) {
      const added = await context.app.inject({
        method: "POST",
        url: `/api/v1/projects/${project.id}/members`,
        headers: authenticatedHeaders(admin.cookies),
        payload: { email, role },
      });
      expect(added.statusCode).toBe(201);
    }

    const editorLogin = await login(context.app, "catalog-editor@example.test");
    const viewerLogin = await login(context.app, "catalog-viewer@example.test");

    const editorCreate = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/collections`,
      headers: authenticatedHeaders(editorLogin.cookies),
      payload: { name: "Editor Collection" },
    });
    expect(editorCreate.statusCode).toBe(201);

    const viewerCreate = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/collections`,
      headers: authenticatedHeaders(viewerLogin.cookies),
      payload: { name: "Viewer Collection" },
    });
    expect(viewerCreate.statusCode).toBe(403);

    const viewerRead = await context.app.inject({
      method: "GET",
      url: `/api/v1/projects/${project.id}/collections`,
      headers: { cookie: viewerLogin.cookies.cookie },
    });
    expect(viewerRead.statusCode).toBe(200);
  });

  it("rejects plaintext auth values and unknown collection/folder references", async () => {
    const admin = await seedAdmin();
    const project = await createProject(admin.cookies, admin.organizationId);

    const plaintext = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/requests`,
      headers: authenticatedHeaders(admin.cookies),
      payload: {
        name: "Unsafe auth",
        request: {
          method: "GET",
          path: "/unsafe",
          authConfig: { type: "bearer", tokenSecretRef: "plain-token" },
        },
      },
    });
    expect(plaintext.statusCode).toBe(422);

    const missingCollection = await context.app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.id}/requests`,
      headers: authenticatedHeaders(admin.cookies),
      payload: {
        name: "Missing collection",
        collectionId: "00000000-0000-4000-8000-000000000000",
        request: { method: "GET", path: "/missing" },
      },
    });
    expect(missingCollection.statusCode).toBe(404);
  });
});
