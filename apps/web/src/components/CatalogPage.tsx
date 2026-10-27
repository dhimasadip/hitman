import type {
  ApiOperationSummary,
  ApiRequestDetail,
  ApiRequestSummary,
  CollectionDetail,
  CollectionFolderSummary,
  ImportSpecificationResponse,
  ProjectRepository,
} from "@hitman/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useDeferredValue, useState } from "react";
import {
  ApiClientError,
  archiveRequest,
  createCollection,
  createFolder,
  deleteCollection,
  deleteFolder,
  getRequest,
  getSpecification,
  importSpecification,
  listCollections,
  listOperations,
  listRequests,
  listRequestVersions,
  listSpecifications,
} from "../api.js";

type CatalogTab = "specifications" | "operations" | "collections" | "requests";

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20";

const methodColors: Record<string, string> = {
  GET: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  POST: "text-blue-300 border-blue-400/30 bg-blue-400/10",
  PUT: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  PATCH: "text-violet-300 border-violet-400/30 bg-violet-400/10",
  DELETE: "text-rose-300 border-rose-400/30 bg-rose-400/10",
};

function Method({ method }: { method: string }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
        methodColors[method] ?? "border-slate-400/30 bg-slate-400/10 text-slate-300"
      }`}
    >
      {method}
    </span>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function ValidationReport({ report }: { report: Record<string, unknown> }) {
  const errors = Array.isArray(report.errors) ? report.errors : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 text-xs">
      {errors.length > 0 ? (
        <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-rose-200">
          <p className="font-semibold">Validation errors</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {errors.slice(0, 20).map((error) => (
              <li key={String(error)}>{String(error)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-amber-200">
          <p className="font-semibold">Warnings</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {warnings.slice(0, 20).map((warning) => (
              <li key={String(warning)}>{String(warning)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function FolderTree({
  folders,
  parentId = null,
  depth = 0,
  onDelete,
  canEdit,
}: {
  folders: CollectionFolderSummary[];
  parentId?: string | null;
  depth?: number;
  onDelete: (folder: CollectionFolderSummary) => void;
  canEdit: boolean;
}) {
  const children = folders.filter((folder) => folder.parentFolderId === parentId);
  if (children.length === 0) return null;
  return (
    <ul className={depth > 0 ? "mt-1 space-y-1" : "mt-3 space-y-1"}>
      {children.map((folder) => (
        <li key={folder.id}>
          <div
            className="flex items-center justify-between gap-3 rounded-lg border border-white/5 px-3 py-2"
            style={{ marginLeft: `${depth * 14}px` }}
          >
            <span className="text-sm text-slate-300">{folder.name}</span>
            {canEdit ? (
              <button
                type="button"
                onClick={() => onDelete(folder)}
                className="text-xs text-rose-300 hover:text-rose-200"
              >
                Delete
              </button>
            ) : null}
          </div>
          <FolderTree
            folders={folders}
            parentId={folder.id}
            depth={depth + 1}
            onDelete={onDelete}
            canEdit={canEdit}
          />
        </li>
      ))}
    </ul>
  );
}

export function CatalogPage({
  projectId,
  canEdit,
  repository,
}: {
  projectId: string;
  canEdit: boolean;
  repository: ProjectRepository | null;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CatalogTab>("specifications");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const specsQuery = useQuery({
    queryKey: ["specifications", projectId],
    queryFn: () => listSpecifications(projectId),
  });
  const [selectedSpecId, setSelectedSpecId] = useState<string | null>(null);
  const specDetailQuery = useQuery({
    queryKey: ["specification", projectId, selectedSpecId],
    queryFn: () => getSpecification(projectId, selectedSpecId as string),
    enabled: selectedSpecId !== null,
  });

  const [importSpecId, setImportSpecId] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importContent, setImportContent] = useState("");
  const [importResult, setImportResult] = useState<ImportSpecificationResponse | null>(null);
  const [importSource, setImportSource] = useState<"upload" | "repository">("upload");

  const [operationSearch, setOperationSearch] = useState("");
  const [operationMethod, setOperationMethod] = useState("");
  const deferredOperationSearch = useDeferredValue(operationSearch);
  const operationsQuery = useQuery({
    queryKey: ["operations", projectId, deferredOperationSearch, operationMethod],
    queryFn: () =>
      listOperations(projectId, {
        ...(deferredOperationSearch ? { q: deferredOperationSearch } : {}),
        ...(operationMethod ? { method: operationMethod } : {}),
      }),
  });

  const collectionsQuery = useQuery({
    queryKey: ["collections", projectId],
    queryFn: () => listCollections(projectId),
  });
  const [collectionName, setCollectionName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderCollectionId, setFolderCollectionId] = useState("");
  const [folderParentId, setFolderParentId] = useState("");

  const [requestSearch, setRequestSearch] = useState("");
  const [requestMethod, setRequestMethod] = useState("");
  const [requestTag, setRequestTag] = useState("");
  const [requestLifecycle, setRequestLifecycle] = useState("");
  const deferredRequestSearch = useDeferredValue(requestSearch);
  const requestsQuery = useQuery({
    queryKey: [
      "requests",
      projectId,
      deferredRequestSearch,
      requestMethod,
      requestTag,
      requestLifecycle,
    ],
    queryFn: () =>
      listRequests(projectId, {
        ...(deferredRequestSearch ? { q: deferredRequestSearch } : {}),
        ...(requestMethod ? { method: requestMethod } : {}),
        ...(requestTag ? { tag: requestTag } : {}),
        ...(requestLifecycle ? { lifecycle: requestLifecycle } : {}),
      }),
  });
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const requestDetailQuery = useQuery({
    queryKey: ["request", selectedRequestId],
    queryFn: () => getRequest(selectedRequestId as string),
    enabled: selectedRequestId !== null,
  });
  const versionsQuery = useQuery({
    queryKey: ["request-versions", selectedRequestId],
    queryFn: () => listRequestVersions(selectedRequestId as string),
    enabled: selectedRequestId !== null,
  });

  async function refreshAll(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["specifications", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["operations", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["collections", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["requests", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["audit"] }),
    ]);
  }

  function clearNotices() {
    setError(null);
    setMessage(null);
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearNotices();
    setImportResult(null);
    if (importSource === "upload" && !importContent) {
      setError("Choose a YAML/JSON file first.");
      return;
    }
    if (importSource === "repository" && !repository?.openapiFilePath) {
      setError("The linked repository has no configured OpenAPI path.");
      return;
    }
    setBusy(true);
    try {
      const result = await importSpecification(projectId, {
        ...(importSpecId ? { specificationId: importSpecId } : {}),
        ...(importLabel.trim() ? { label: importLabel.trim() } : {}),
        sourceKind: importSource,
        ...(importSource === "upload"
          ? { content: importContent, fileName: importFileName || "openapi.yaml" }
          : {}),
      });
      setImportResult(result);
      setSelectedSpecId(result.specification.id);
      setMessage(
        result.deduplicated
          ? "This document content already exists; the existing version was returned."
          : result.version.validationStatus === "valid"
            ? `Imported version ${result.version.versionNumber} with ${result.operationCount} operations.`
            : "Import stored with validation errors; the previous valid version remains current.",
      );
      await refreshAll();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Unable to import specification.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCollection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearNotices();
    setBusy(true);
    try {
      await createCollection(projectId, { name: collectionName, sortOrder: 0 });
      setCollectionName("");
      setMessage("Collection created.");
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to create collection.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!folderCollectionId) {
      setError("Select a collection first.");
      return;
    }
    clearNotices();
    setBusy(true);
    try {
      await createFolder(projectId, folderCollectionId, {
        name: folderName,
        sortOrder: 0,
        ...(folderParentId ? { parentFolderId: folderParentId } : {}),
      });
      setFolderName("");
      setFolderParentId("");
      setMessage("Folder created.");
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to create folder.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCollection(collection: CollectionDetail) {
    if (!window.confirm(`Delete collection "${collection.name}"? It must be empty.`)) return;
    clearNotices();
    setBusy(true);
    try {
      await deleteCollection(projectId, collection.id);
      setMessage("Collection deleted.");
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to delete collection.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteFolder(collectionId: string, folder: CollectionFolderSummary) {
    if (!window.confirm(`Delete folder "${folder.name}"? It must be empty.`)) return;
    clearNotices();
    setBusy(true);
    try {
      await deleteFolder(projectId, collectionId, folder.id);
      setMessage("Folder deleted.");
      await refreshAll();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to delete folder.");
    } finally {
      setBusy(false);
    }
  }

  async function handleArchiveRequest(request: ApiRequestDetail) {
    if (!window.confirm(`Archive request "${request.name}"? It becomes read-only.`)) return;
    clearNotices();
    setBusy(true);
    try {
      await archiveRequest(request.id);
      setMessage("Request archived.");
      await refreshAll();
      await queryClient.invalidateQueries({ queryKey: ["request", request.id] });
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to archive request.");
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ id: CatalogTab; label: string }> = [
    { id: "specifications", label: "Specifications" },
    { id: "operations", label: "Operations" },
    { id: "collections", label: "Collections" },
    { id: "requests", label: "Requests" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">API catalog</h3>
          <p className="mt-1 text-sm text-slate-400">
            OpenAPI documents, parsed operations, collections, and saved request definitions.
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
          {specsQuery.data?.specifications.length ?? 0} spec
          {(specsQuery.data?.specifications.length ?? 0) === 1 ? "" : "s"} ·{" "}
          {requestsQuery.data?.requests.length ?? 0} request
          {(requestsQuery.data?.requests.length ?? 0) === 1 ? "" : "s"}
        </span>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200"
        >
          {message}
        </p>
      ) : null}

      <div className="flex gap-2 overflow-x-auto border-b border-white/10 pb-2">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === entry.id
                ? "bg-blue-500/15 text-blue-200"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "specifications" ? (
        <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <section className="space-y-3">
            {specsQuery.error ? (
              <p className="text-sm text-rose-300">Unable to load specifications.</p>
            ) : specsQuery.isPending ? (
              <p className="text-sm text-slate-400">Loading specifications…</p>
            ) : null}
            {specsQuery.data?.specifications.map((spec) => (
              <button
                key={spec.id}
                type="button"
                onClick={() => setSelectedSpecId(spec.id)}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  selectedSpecId === spec.id
                    ? "border-blue-400/50 bg-blue-400/5"
                    : "border-white/10 bg-black/20 hover:border-white/20"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-200">{spec.label}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {spec.description || "No description"}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${
                      spec.validationStatus === "valid"
                        ? "border-emerald-400/30 text-emerald-300"
                        : spec.validationStatus === "invalid"
                          ? "border-rose-400/30 text-rose-300"
                          : "border-slate-400/30 text-slate-400"
                    }`}
                  >
                    {spec.validationStatus ?? "no current version"}
                  </span>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {spec.versionCount} version{spec.versionCount === 1 ? "" : "s"} ·{" "}
                  {spec.openapiVersion ?? "unknown OpenAPI"} · current v
                  {spec.currentVersionNumber ?? "—"}
                </p>
              </button>
            ))}
            {specsQuery.data?.specifications.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-500">
                No specifications imported yet.
              </p>
            ) : null}

            {selectedSpecId && specDetailQuery.data ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <h4 className="text-sm font-semibold text-slate-200">Version history</h4>
                <div className="mt-3 space-y-2">
                  {specDetailQuery.data.versions.map((version) => (
                    <div
                      key={version.id}
                      className="rounded-lg border border-white/5 px-3 py-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-slate-300">
                          v{version.versionNumber} · {version.specVersion ?? "unknown"}
                        </span>
                        <span
                          className={
                            version.validationStatus === "valid"
                              ? "text-emerald-300"
                              : "text-rose-300"
                          }
                        >
                          {version.validationStatus}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-500">
                        {version.sourceKind}
                        {version.sourceRef ? ` · ${version.sourceRef}` : ""} ·{" "}
                        {version.operationCount} operations · {formatDate(version.createdAt)}
                      </p>
                      <ValidationReport report={version.validationReport} />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h4 className="text-sm font-semibold text-white">Import specification</h4>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              OpenAPI 3.0.x/3.1.x. 3.2.x is rejected. Remote URL import is not enabled yet.
            </p>
            {!canEdit ? (
              <p className="mt-4 text-sm text-slate-400">
                Only project administrators and editors can import specifications.
              </p>
            ) : (
              <form className="mt-4 space-y-3" onSubmit={handleImport}>
                <label className="block text-sm font-medium text-slate-300">
                  Import into
                  <select
                    className={inputClass}
                    value={importSpecId}
                    onChange={(event) => setImportSpecId(event.target.value)}
                  >
                    <option value="">New logical specification</option>
                    {specsQuery.data?.specifications.map((spec) => (
                      <option key={spec.id} value={spec.id}>
                        {spec.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-300">
                  Label override
                  <input
                    className={inputClass}
                    value={importLabel}
                    onChange={(event) => setImportLabel(event.target.value)}
                    placeholder="Defaults to OpenAPI info.title"
                  />
                </label>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setImportSource("upload")}
                    className={`rounded-lg border px-3 py-1.5 ${
                      importSource === "upload"
                        ? "border-blue-400/40 text-blue-200"
                        : "border-white/10 text-slate-400"
                    }`}
                  >
                    Upload file
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportSource("repository")}
                    disabled={!repository?.openapiFilePath}
                    className={`rounded-lg border px-3 py-1.5 disabled:opacity-40 ${
                      importSource === "repository"
                        ? "border-blue-400/40 text-blue-200"
                        : "border-white/10 text-slate-400"
                    }`}
                  >
                    Mock repository path
                  </button>
                </div>
                {importSource === "upload" ? (
                  <label className="block text-sm font-medium text-slate-300">
                    YAML/JSON file
                    <input
                      className={inputClass}
                      type="file"
                      accept=".yaml,.yml,.json,application/json,text/yaml"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        if (file.size > 5_000_000) {
                          setError("OpenAPI file must be 5 MB or smaller.");
                          return;
                        }
                        setImportFileName(file.name);
                        void file.text().then(setImportContent);
                      }}
                    />
                  </label>
                ) : (
                  <p className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-400">
                    Source: {repository?.namespacePath}/{repository?.repositoryName}
                    {repository?.openapiFilePath ? ` · ${repository.openapiFilePath}` : ""}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-400 disabled:opacity-60"
                >
                  {busy ? "Importing…" : "Import specification"}
                </button>
              </form>
            )}

            {importResult ? (
              <div className="mt-4">
                <p className="text-sm text-slate-300">
                  Version {importResult.version.versionNumber} ·{" "}
                  {importResult.version.validationStatus}
                </p>
                <ValidationReport report={importResult.version.validationReport} />
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === "operations" ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap gap-3">
            <label className="min-w-[220px] flex-1 text-sm font-medium text-slate-300">
              Search operations
              <input
                className={inputClass}
                value={operationSearch}
                onChange={(event) => setOperationSearch(event.target.value)}
                placeholder="Path, operation ID, or summary"
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Method
              <select
                className={inputClass}
                value={operationMethod}
                onChange={(event) => setOperationMethod(event.target.value)}
              >
                <option value="">All methods</option>
                {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-5 space-y-2">
            {operationsQuery.data?.operations.map((operation: ApiOperationSummary) => (
              <div
                key={operation.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-white/5 bg-black/20 px-4 py-3"
              >
                <Method method={operation.method} />
                <span className="font-mono text-sm text-slate-300">{operation.pathTemplate}</span>
                <span className="text-xs text-slate-500">{operation.summary ?? ""}</span>
                <span className="ml-auto text-[10px] text-slate-600">
                  {operation.operationKey} · v{operation.versionNumber}
                </span>
              </div>
            ))}
            {operationsQuery.data?.operations.length === 0 ? (
              <p className="text-sm text-slate-500">No operations in the current specifications.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "collections" ? (
        <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <section className="space-y-3">
            {collectionsQuery.data?.collections.map((collection) => (
              <div
                key={collection.id}
                className="rounded-xl border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-200">{collection.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {collection.requestCount} request
                      {collection.requestCount === 1 ? "" : "s"} · {collection.folderCount} folder
                      {collection.folderCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteCollection(collection)}
                      className="text-xs text-rose-300 hover:text-rose-200"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
                <FolderTree
                  folders={collection.folders}
                  onDelete={(folder) => void handleDeleteFolder(collection.id, folder)}
                  canEdit={canEdit}
                />
              </div>
            ))}
            {collectionsQuery.data?.collections.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-500">
                No collections yet.
              </p>
            ) : null}
          </section>

          {canEdit ? (
            <section className="space-y-5">
              <form
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                onSubmit={handleCreateCollection}
              >
                <h4 className="text-sm font-semibold text-white">Create collection</h4>
                <input
                  className={inputClass}
                  required
                  value={collectionName}
                  onChange={(event) => setCollectionName(event.target.value)}
                  placeholder="Collection name"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-400 disabled:opacity-60"
                >
                  Create
                </button>
              </form>
              <form
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                onSubmit={handleCreateFolder}
              >
                <h4 className="text-sm font-semibold text-white">Create folder</h4>
                <select
                  className={inputClass}
                  required
                  value={folderCollectionId}
                  onChange={(event) => {
                    setFolderCollectionId(event.target.value);
                    setFolderParentId("");
                  }}
                >
                  <option value="">Select collection</option>
                  {collectionsQuery.data?.collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  required
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  placeholder="Folder name"
                />
                <select
                  className={inputClass}
                  value={folderParentId}
                  onChange={(event) => setFolderParentId(event.target.value)}
                >
                  <option value="">No parent folder</option>
                  {collectionsQuery.data?.collections
                    .find((collection) => collection.id === folderCollectionId)
                    ?.folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                </select>
                <button
                  type="submit"
                  disabled={busy}
                  className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-400 disabled:opacity-60"
                >
                  Create folder
                </button>
              </form>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "requests" ? (
        <div className="space-y-4">
          {selectedRequestId ? (
            <RequestDetailView
              request={requestDetailQuery.data}
              versions={versionsQuery.data?.versions ?? []}
              loading={requestDetailQuery.isPending}
              error={
                requestDetailQuery.error instanceof Error ? requestDetailQuery.error.message : null
              }
              canEdit={canEdit}
              busy={busy}
              onBack={() => setSelectedRequestId(null)}
              onArchive={() => {
                if (requestDetailQuery.data) void handleArchiveRequest(requestDetailQuery.data);
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-3">
                <label className="min-w-[220px] flex-1 text-sm font-medium text-slate-300">
                  Search requests
                  <input
                    className={inputClass}
                    value={requestSearch}
                    onChange={(event) => setRequestSearch(event.target.value)}
                    placeholder="Name or path"
                  />
                </label>
                <label className="text-sm font-medium text-slate-300">
                  Method
                  <select
                    className={inputClass}
                    value={requestMethod}
                    onChange={(event) => setRequestMethod(event.target.value)}
                  >
                    <option value="">All</option>
                    {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-300">
                  Tag
                  <input
                    className={inputClass}
                    value={requestTag}
                    onChange={(event) => setRequestTag(event.target.value)}
                    placeholder="tag"
                  />
                </label>
                <label className="text-sm font-medium text-slate-300">
                  Lifecycle
                  <select
                    className={inputClass}
                    value={requestLifecycle}
                    onChange={(event) => setRequestLifecycle(event.target.value)}
                  >
                    <option value="">All</option>
                    <option value="draft">Draft</option>
                    <option value="ready">Ready</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
              </div>
              <div className="space-y-2">
                {requestsQuery.data?.requests.map((request: ApiRequestSummary) => (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => setSelectedRequestId(request.id)}
                    className="w-full rounded-xl border border-white/10 bg-black/20 p-4 text-left transition hover:border-blue-400/40"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <Method method={request.method} />
                      <span className="font-mono text-sm text-slate-300">{request.path}</span>
                      <span className="font-medium text-slate-200">{request.name}</span>
                      <span className="ml-auto text-xs text-slate-500">
                        {request.requestLifecycle} · v{request.currentVersionNumber ?? "—"}
                      </span>
                    </div>
                    {request.tags.length > 0 ? (
                      <div className="mt-2 flex gap-2">
                        {request.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-500"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                ))}
                {requestsQuery.data?.requests.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-500">
                    No requests yet. Full request creation and editing arrive in Phase 7;
                    API-created requests appear here.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RequestDetailView({
  request,
  versions,
  loading,
  error,
  canEdit,
  busy,
  onBack,
  onArchive,
}: {
  request: ApiRequestDetail | undefined;
  versions: Array<{
    id: string;
    versionNumber: number;
    method: string;
    path: string;
    changeSummary: string | null;
    createdAt: string;
  }>;
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  busy: boolean;
  onBack: () => void;
  onArchive: () => void;
}) {
  if (loading) return <p className="text-sm text-slate-400">Loading request…</p>;
  if (error || !request) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={onBack} className="text-xs text-slate-300">
          ← Requests
        </button>
        <p className="text-sm text-rose-300">{error ?? "Request not found."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="text-xs text-slate-300">
            ← Requests
          </button>
          <div>
            <h4 className="text-base font-semibold text-white">{request.name}</h4>
            <p className="mt-1 flex items-center gap-2 font-mono text-xs text-slate-500">
              <Method method={request.method} /> {request.path}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
            {request.requestLifecycle}
          </span>
          {canEdit && request.requestLifecycle !== "archived" ? (
            <button
              type="button"
              disabled={busy}
              onClick={onArchive}
              className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-400/10 disabled:opacity-60"
            >
              Archive
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h5 className="text-sm font-semibold text-slate-200">Current definition (read-only)</h5>
          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Current version</dt>
              <dd className="text-slate-300">{request.currentVersionNumber}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Execution scope</dt>
              <dd className="text-slate-300">{request.executionScope}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Query parameters</dt>
              <dd className="text-slate-300">{request.version.queryParams.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Headers</dt>
              <dd className="text-slate-300">{request.version.headers.length}</dd>
            </div>
          </dl>
          <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-xs text-slate-500">Auth</p>
            <pre className="mt-1 overflow-x-auto text-[10px] text-slate-300">
              {JSON.stringify(request.version.authConfig, null, 2)}
            </pre>
          </div>
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-xs text-slate-500">Body</p>
            <pre className="mt-1 overflow-x-auto text-[10px] text-slate-300">
              {JSON.stringify(request.version.body, null, 2)}
            </pre>
          </div>
          <p className="mt-4 rounded-lg border border-blue-400/20 bg-blue-400/5 p-3 text-xs leading-5 text-slate-400">
            Full request editing, URL preview, and response panels arrive in Phase 7. Secrets are
            references only and are not resolved here.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h5 className="text-sm font-semibold text-slate-200">Version history</h5>
          <div className="mt-3 space-y-2">
            {versions.map((version) => (
              <div key={version.id} className="rounded-lg border border-white/5 px-3 py-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-300">
                    v{version.versionNumber} · {version.method} {version.path}
                  </span>
                  <span className="text-slate-600">{formatDate(version.createdAt)}</span>
                </div>
                <p className="mt-1 text-slate-500">
                  {version.changeSummary ?? "No change summary"}
                </p>
              </div>
            ))}
            {versions.length === 0 ? (
              <p className="text-sm text-slate-500">No version history.</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
