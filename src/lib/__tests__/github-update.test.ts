import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    getLatestCommitAndBuildStatus,
    getUpdateRepoConfig,
    isNewerCommitAvailable,
    resolveDockerImageStatus,
} from "../github";

describe("GitHub Update & Build Status Helpers", () => {
    it("parses default UPDATE_REPO and honors disabled sentinel", () => {
        const prev = process.env.UPDATE_REPO;
        try {
            delete process.env.UPDATE_REPO;
            const def = getUpdateRepoConfig();
            assert.equal(def?.fullName, "marcelo312santana312-spec/MarcFlow");
            assert.equal(def?.branch, "main");

            process.env.UPDATE_REPO = "disabled";
            assert.equal(getUpdateRepoConfig(), null);
        } finally {
            if (prev === undefined) delete process.env.UPDATE_REPO;
            else process.env.UPDATE_REPO = prev;
        }
    });

    it("detects newer commits cleanly including short/full SHA prefix", () => {
        assert.equal(isNewerCommitAvailable("657c5662e82da21b50e92783950284d38f9d440a", "657c5662e82da21b50e92783950284d38f9d440a"), false);
        assert.equal(isNewerCommitAvailable("657c566", "657c5662e82da21b50e92783950284d38f9d440a"), false);
        assert.equal(isNewerCommitAvailable("657c566", "abcdef1234567890abcdef1234567890abcdef12"), true);
        assert.equal(isNewerCommitAvailable(null, "abcdef1234567890"), false);
    });

    it("resolves Docker workflow run states accurately", () => {
        const sha = "1111111222222233333334444444555555566666";
        assert.equal(
            resolveDockerImageStatus(sha, [
                { id: 1, status: "completed", conclusion: "success", headSha: sha, htmlUrl: "", createdAt: "", updatedAt: "" },
            ]).imageStatus,
            "ready"
        );
        assert.equal(
            resolveDockerImageStatus(sha, [
                { id: 2, status: "in_progress", conclusion: null, headSha: sha, htmlUrl: "", createdAt: "", updatedAt: "" },
            ]).imageStatus,
            "building"
        );
        assert.equal(
            resolveDockerImageStatus(sha, [
                { id: 3, status: "completed", conclusion: "failure", headSha: sha, htmlUrl: "", createdAt: "", updatedAt: "" },
            ]).imageStatus,
            "failed"
        );
    });

    it("fetches commit and workflow status from mocked GitHub API", async () => {
        const sha = "9999999888888777777666666555555444444333";
        const mockFetch: typeof fetch = async (input) => {
            const url = String(input);
            if (url.includes("/commits/")) {
                return new Response(
                    JSON.stringify({
                        sha,
                        html_url: `https://github.com/o/r/commit/${sha}`,
                        commit: {
                            message: "feat: self update\n\ndetails",
                            author: { name: "Marcelo", date: "2026-11-26T11:00:00Z" },
                        },
                    }),
                    { status: 200 }
                );
            }
            return new Response(
                JSON.stringify({
                    workflow_runs: [
                        {
                            id: 42,
                            status: "completed",
                            conclusion: "success",
                            head_sha: sha,
                            html_url: "https://github.com/o/r/actions/runs/42",
                            created_at: "2026-11-26T11:00:00Z",
                            updated_at: "2026-11-26T11:04:00Z",
                        },
                    ],
                }),
                { status: 200 }
            );
        };

        const result = await getLatestCommitAndBuildStatus("o", "r", "main", mockFetch);
        assert.ok(result);
        assert.equal(result.latestCommit.shortSha, "9999999");
        assert.equal(result.latestCommit.message, "feat: self update");
        assert.equal(result.imageStatus, "ready");
        assert.equal(result.workflowRun?.id, 42);
    });
});
