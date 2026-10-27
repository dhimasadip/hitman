import type { MockRepository } from "@hitman/contracts";

export interface GitLabProvider {
  readonly kind: string;
  listRepositories(): Promise<MockRepository[]>;
  getRepository(externalProjectId: string): Promise<MockRepository | undefined>;
  getFile(externalProjectId: string, path: string): Promise<string | undefined>;
}

const MOCK_REPOSITORIES: MockRepository[] = [
  {
    externalProjectId: "1001",
    namespacePath: "acme",
    repositoryName: "app-a",
    repositoryUrl: "https://gitlab.com/acme/app-a.git",
    defaultBranch: "main",
    openapiFilePath: "openapi/openapi.yaml",
  },
  {
    externalProjectId: "1002",
    namespacePath: "acme",
    repositoryName: "app-b",
    repositoryUrl: "https://gitlab.com/acme/app-b.git",
    defaultBranch: "main",
    openapiFilePath: null,
  },
  {
    externalProjectId: "1003",
    namespacePath: "platform",
    repositoryName: "shared-api",
    repositoryUrl: "https://gitlab.com/platform/shared-api.git",
    defaultBranch: "develop",
    openapiFilePath: "api/openapi.yaml",
  },
];

/**
 * Phase 5 provider. Live GitLab API/OAuth integration arrives in Phase 15; the
 * service/API contracts remain the same so the provider can be replaced without
 * fabricating GitLab state in the database.
 */
export class MockGitLabProvider implements GitLabProvider {
  readonly kind = "mock";

  async listRepositories(): Promise<MockRepository[]> {
    return MOCK_REPOSITORIES.map((repository) => ({ ...repository }));
  }

  async getRepository(externalProjectId: string): Promise<MockRepository | undefined> {
    const repository = MOCK_REPOSITORIES.find(
      (candidate) => candidate.externalProjectId === externalProjectId,
    );
    return repository ? { ...repository } : undefined;
  }

  async getFile(externalProjectId: string, path: string): Promise<string | undefined> {
    return MOCK_FILES[`${externalProjectId}:${path}`];
  }
}

const OPENAPI_APP_A = `openapi: 3.0.3
info:
  title: App A API
  version: 1.2.0
  description: Mock App A contract used by the Phase 6 catalog.
servers:
  - url: http://127.0.0.1:3000
paths:
  /api/v1/items:
    get:
      operationId: listItems
      summary: List items
      tags: [items]
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        "200":
          description: Items
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Item"
    post:
      operationId: createItem
      summary: Create an item
      tags: [items]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateItem"
      responses:
        "201":
          description: Created
components:
  schemas:
    Item:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
    CreateItem:
      type: object
      required: [name]
      properties:
        name:
          type: string
`;

const OPENAPI_SHARED = `openapi: 3.1.0
info:
  title: Shared Platform API
  version: 0.9.0
servers:
  - url: http://127.0.0.1:8080
paths:
  /health:
    get:
      operationId: getHealth
      summary: Health check
      responses:
        "200":
          description: Healthy
`;

const MOCK_FILES: Record<string, string> = {
  "1001:openapi/openapi.yaml": OPENAPI_APP_A,
  "1003:api/openapi.yaml": OPENAPI_SHARED,
};
