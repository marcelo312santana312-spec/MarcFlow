import { logger } from "./logger";

const DEFAULT_UPDATE_REPO = "marcelo312santana312-spec/MarcFlow";
const DEFAULT_UPDATE_BRANCH = "main";
const DOCKER_WORKFLOW_FILE = "docker-image.yml";

export interface GitHubRepoConfig {
    owner: string;
    repo: string;
    branch: string;
    fullName: string;
}

export interface GitHubCommitSummary {
    sha: string;
    shortSha: string;
    message: string;
    author: string;
    date: string;
    htmlUrl: string;
}

export interface GitHubWorkflowRunSummary {
    id: number;
    status: string;
    conclusion: string | null;
    headSha: string;
    htmlUrl: string;
    createdAt: string;
    updatedAt: string;
}

export type DockerImageBuildStatus = "ready" | "building" | "failed" | "unknown";

export interface GitHubMainUpdateStatus {
    latestCommit: GitHubCommitSummary;
    workflowRun: GitHubWorkflowRunSummary | null;
    imageStatus: DockerImageBuildStatus;
}

/**
 * Resolve o repositório e branch configurados para checagem de atualizações.
 * Retorna null apenas se UPDATE_REPO estiver explicitamente desativado ("disabled" | "none" | "false").
 */
export function getUpdateRepoConfig(): GitHubRepoConfig | null {
    const rawRepo = (process.env.UPDATE_REPO ?? DEFAULT_UPDATE_REPO).trim();
    const lowered = rawRepo.toLowerCase();
    if (!rawRepo || lowered === "disabled" || lowered === "none" || lowered === "false") {
        return null;
    }

    const parts = rawRepo.split("/").map((p) => p.trim()).filter(Boolean);
    if (parts.length !== 2) {
        return null;
    }

    const branch = (process.env.UPDATE_BRANCH || DEFAULT_UPDATE_BRANCH).trim() || DEFAULT_UPDATE_BRANCH;
    return {
        owner: parts[0],
        repo: parts[1],
        branch,
        fullName: `${parts[0]}/${parts[1]}`,
    };
}

/**
 * Compara o commit instalado com o commit mais recente do GitHub.
 */
export function isNewerCommitAvailable(currentSha: string | null | undefined, latestSha: string | null | undefined): boolean {
    const cur = (currentSha || "").trim().toLowerCase();
    const lat = (latestSha || "").trim().toLowerCase();
    if (!cur || !lat) return false;
    return !(lat.startsWith(cur) || cur.startsWith(lat));
}

/**
 * Determina o status da imagem Docker no GitHub Actions para o último commit da branch.
 */
export function resolveDockerImageStatus(
    latestCommitSha: string,
    runs: GitHubWorkflowRunSummary[]
): { workflowRun: GitHubWorkflowRunSummary | null; imageStatus: DockerImageBuildStatus } {
    if (!Array.isArray(runs) || runs.length === 0) {
        return { workflowRun: null, imageStatus: "unknown" };
    }

    const matchingRun = runs.find((r) => r.headSha.toLowerCase() === latestCommitSha.toLowerCase()) || runs[0];
    if (matchingRun.headSha.toLowerCase() !== latestCommitSha.toLowerCase()) {
        // Commit muito recente cujo workflow ainda pode estar na fila para abrir
        if (matchingRun.status !== "completed") {
            return { workflowRun: matchingRun, imageStatus: "building" };
        }
        return { workflowRun: matchingRun, imageStatus: "building" };
    }

    if (matchingRun.status !== "completed") {
        return { workflowRun: matchingRun, imageStatus: "building" };
    }

    if (matchingRun.conclusion === "success") {
        return { workflowRun: matchingRun, imageStatus: "ready" };
    }

    return { workflowRun: matchingRun, imageStatus: "failed" };
}

function githubHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "MarcFlow",
    };
    const token = (process.env.GITHUB_TOKEN || "").trim();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

export async function getLatestCommitAndBuildStatus(
    owner: string,
    repo: string,
    branch = DEFAULT_UPDATE_BRANCH,
    fetchImpl: typeof fetch = fetch
): Promise<GitHubMainUpdateStatus | null> {
    try {
        const headers = githubHeaders();
        const commitUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`;
        const runsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${DOCKER_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(branch)}&per_page=5`;

        const [commitRes, runsRes] = await Promise.all([
            fetchImpl(commitUrl, { headers, cache: "no-store" }),
            fetchImpl(runsUrl, { headers, cache: "no-store" }).catch(() => null),
        ]);

        if (!commitRes.ok) {
            const errorText = await commitRes.text().catch(() => "");
            logger.error("GitHub", `Commits API Error: ${commitRes.status} ${commitRes.statusText} - ${errorText}`);
            return null;
        }

        const commitData = await commitRes.json();
        const sha: string = commitData?.sha || "";
        if (!sha) return null;

        const rawMsg: string = commitData?.commit?.message || "";
        const firstLineMsg = rawMsg.split(/\r?\n/)[0] || "Atualização disponível";

        const latestCommit: GitHubCommitSummary = {
            sha,
            shortSha: sha.slice(0, 7),
            message: firstLineMsg,
            author: commitData?.commit?.author?.name || commitData?.author?.login || "GitHub",
            date: commitData?.commit?.author?.date || "",
            htmlUrl: commitData?.html_url || `https://github.com/${owner}/${repo}/commit/${sha}`,
        };

        let runs: GitHubWorkflowRunSummary[] = [];
        if (runsRes && runsRes.ok) {
            const runsData = await runsRes.json();
            const rawRuns = Array.isArray(runsData?.workflow_runs) ? runsData.workflow_runs : [];
            runs = rawRuns.map((r: any) => ({
                id: Number(r.id),
                status: String(r.status || ""),
                conclusion: r.conclusion ? String(r.conclusion) : null,
                headSha: String(r.head_sha || ""),
                htmlUrl: String(r.html_url || ""),
                createdAt: String(r.created_at || ""),
                updatedAt: String(r.updated_at || ""),
            }));
        }

        const { workflowRun, imageStatus } = resolveDockerImageStatus(sha, runs);
        return { latestCommit, workflowRun, imageStatus };
    } catch (e) {
        logger.error("GitHub", "Error fetching GitHub commit/workflow status:", e);
        return null;
    }
}

export async function getLatestRelease(owner: string, repo: string) {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
        const res = await fetch(url, {
            headers: githubHeaders(),
            cache: "no-store",
        });

        if (!res.ok) {
            const errorText = await res.text();
            logger.error("GitHub", `API Error: ${res.status} ${res.statusText} - ${errorText}`);
            return null;
        }

        const data = await res.json();
        return {
            tag_name: data.tag_name,
            name: data.name,
            html_url: data.html_url,
            body: data.body,
            published_at: data.published_at,
        };
    } catch (e) {
        logger.error("GitHub", "Error fetching GitHub release:", e);
        return null;
    }
}
