import type { MockRepository } from "@hitman/contracts";

export interface GitLabProvider {
  readonly kind: string;
  listRepositories(): Promise<MockRepository[]>;
  getRepository(externalProjectId: string): Promise<MockRepository | undefined>;
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
}
