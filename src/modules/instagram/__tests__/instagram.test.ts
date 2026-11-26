import test from "node:test";
import assert from "node:assert/strict";
import {
    encryptToken,
    decryptToken,
    createOAuthState,
    verifyOAuthState,
    signMediaPath,
    verifyMediaSignature,
} from "../crypto";
import { validateInstagramPostInput } from "../validation";
import { publishInstagramPost, InstagramApiError } from "../client";

function ensureTestEnv() {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-instagram-module-123456";
    process.env.INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID || "1234567890";
    process.env.INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET || "app-secret-xyz";
    process.env.INSTAGRAM_GRAPH_VERSION = "v22.0";
}

test("encryptToken e decryptToken realizam round-trip e rejeitam payload adulterado", () => {
    ensureTestEnv();
    const original = "IGAA_token_super_secreto_12345";
    const encrypted = encryptToken(original);
    assert.ok(encrypted.startsWith("v1:"));
    assert.notEqual(encrypted, original);
    assert.equal(decryptToken(encrypted), original);

    const parts = encrypted.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:0000${parts[3].slice(4)}`;
    assert.throws(() => decryptToken(tampered));
});

test("createOAuthState e verifyOAuthState validam assinatura, adulteração e expiração", () => {
    ensureTestEnv();
    const state = createOAuthState("user_abc", 60);
    assert.deepEqual(verifyOAuthState(state), { userId: "user_abc" });

    const [payload, sig] = state.split(".");
    const tamperedSig = sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a");
    assert.equal(verifyOAuthState(`${payload}.${tamperedSig}`), null);

    const expired = createOAuthState("user_abc", -5);
    assert.equal(verifyOAuthState(expired), null);
});

test("signMediaPath e verifyMediaSignature validam nome do arquivo e expiração", () => {
    ensureTestEnv();
    const { exp, sig } = signMediaPath("foto123.jpg", 120);
    assert.equal(verifyMediaSignature("foto123.jpg", exp, sig), true);
    assert.equal(verifyMediaSignature("outro.jpg", exp, sig), false);

    const expired = signMediaPath("foto123.jpg", -10);
    assert.equal(verifyMediaSignature("foto123.jpg", expired.exp, expired.sig), false);
});

test("validateInstagramPostInput valida Feed, Story, Reels, Carrossel e limite de legenda", () => {
    const validFeed = validateInstagramPostInput({
        accountId: "acc_1",
        type: "FEED",
        caption: "Post no feed",
        mediaItems: [{ filename: "img.jpg", mediaType: "IMAGE" }],
        scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(validFeed.ok, true);

    const validStory = validateInstagramPostInput({
        accountId: "acc_1",
        type: "STORY",
        mediaItems: [{ filename: "story.jpg", mediaType: "IMAGE" }],
        publishNow: true,
    });
    assert.equal(validStory.ok, true);

    const invalidReelsImage = validateInstagramPostInput({
        accountId: "acc_1",
        type: "REELS",
        mediaItems: [{ filename: "foto.jpg", mediaType: "IMAGE" }],
        publishNow: true,
    });
    assert.equal(invalidReelsImage.ok, false);

    const invalidCarouselSingle = validateInstagramPostInput({
        accountId: "acc_1",
        type: "CAROUSEL",
        mediaItems: [{ filename: "foto.jpg", mediaType: "IMAGE" }],
        publishNow: true,
    });
    assert.equal(invalidCarouselSingle.ok, false);

    const validCarousel = validateInstagramPostInput({
        accountId: "acc_1",
        type: "CAROUSEL",
        mediaItems: [
            { filename: "1.jpg", mediaType: "IMAGE" },
            { filename: "2.mp4", mediaType: "VIDEO" },
        ],
        publishNow: true,
    });
    assert.equal(validCarousel.ok, true);

    const longCaption = validateInstagramPostInput({
        accountId: "acc_1",
        type: "FEED",
        caption: "a".repeat(2201),
        mediaItems: [{ filename: "img.jpg", mediaType: "IMAGE" }],
        publishNow: true,
    });
    assert.equal(longCaption.ok, false);
});

test("publishInstagramPost publica Feed Image, Story, Reels com polling e Carrossel", async () => {
    ensureTestEnv();

    // 1. Feed Image
    {
        const calls: Array<{ url: string; method: string; body?: string }> = [];
        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method || "GET";
            calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
            if (url.endsWith("/media") && method === "POST") {
                return new Response(JSON.stringify({ id: "cont_feed_1" }), { status: 200 });
            }
            if (url.endsWith("/media_publish") && method === "POST") {
                return new Response(JSON.stringify({ id: "med_feed_1" }), { status: 200 });
            }
            if (url.includes("fields=permalink")) {
                return new Response(JSON.stringify({ permalink: "https://instagram.com/p/feed1" }), { status: 200 });
            }
            return new Response("{}", { status: 404 });
        }) as typeof fetch;

        const res = await publishInstagramPost(
            {
                igUserId: "ig_100",
                accessToken: "tok",
                type: "FEED",
                caption: "Olá Feed",
                mediaItems: [{ mediaType: "IMAGE", publicUrl: "https://cdn.marctech.me/a.jpg" }],
            },
            { fetchImpl: mockFetch, pollIntervalMs: 0 }
        );
        assert.equal(res.containerId, "cont_feed_1");
        assert.equal(res.mediaId, "med_feed_1");
        assert.equal(res.permalink, "https://instagram.com/p/feed1");
        assert.ok(calls[0].body?.includes("image_url="));
    }

    // 2. Story Image
    {
        const calls: Array<{ url: string; body?: string }> = [];
        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
            if (url.endsWith("/media")) return new Response(JSON.stringify({ id: "cont_story_1" }), { status: 200 });
            if (url.endsWith("/media_publish")) return new Response(JSON.stringify({ id: "med_story_1" }), { status: 200 });
            return new Response(JSON.stringify({}), { status: 200 });
        }) as typeof fetch;

        const res = await publishInstagramPost(
            {
                igUserId: "ig_100",
                accessToken: "tok",
                type: "STORY",
                mediaItems: [{ mediaType: "IMAGE", publicUrl: "https://cdn.marctech.me/story.jpg" }],
            },
            { fetchImpl: mockFetch, pollIntervalMs: 0 }
        );
        assert.equal(res.mediaId, "med_story_1");
        assert.ok(calls[0].body?.includes("media_type=STORIES"));
    }

    // 3. Reels Video with polling IN_PROGRESS -> FINISHED
    {
        let pollCount = 0;
        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method || "GET";
            if (url.endsWith("/media") && method === "POST") {
                return new Response(JSON.stringify({ id: "cont_reel_1" }), { status: 200 });
            }
            if (url.includes("fields=status_code")) {
                pollCount++;
                const status_code = pollCount === 1 ? "IN_PROGRESS" : "FINISHED";
                return new Response(JSON.stringify({ status_code }), { status: 200 });
            }
            if (url.endsWith("/media_publish") && method === "POST") {
                return new Response(JSON.stringify({ id: "med_reel_1" }), { status: 200 });
            }
            return new Response(JSON.stringify({ permalink: "https://instagram.com/reel/1" }), { status: 200 });
        }) as typeof fetch;

        const res = await publishInstagramPost(
            {
                igUserId: "ig_100",
                accessToken: "tok",
                type: "REELS",
                caption: "Meu Reel",
                shareToFeed: true,
                mediaItems: [{ mediaType: "VIDEO", publicUrl: "https://cdn.marctech.me/reel.mp4" }],
            },
            { fetchImpl: mockFetch, pollIntervalMs: 0, maxPollAttempts: 5 }
        );
        assert.equal(pollCount, 2);
        assert.equal(res.mediaId, "med_reel_1");
    }

    // 4. Carousel with 2 children -> parent container -> publish
    {
        const bodies: string[] = [];
        let mediaIdx = 0;
        const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method || "GET";
            if (typeof init?.body === "string") bodies.push(init.body);

            if (url.endsWith("/media") && method === "POST") {
                mediaIdx++;
                return new Response(JSON.stringify({ id: `cont_car_${mediaIdx}` }), { status: 200 });
            }
            if (url.includes("fields=status_code")) {
                return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
            }
            if (url.endsWith("/media_publish") && method === "POST") {
                return new Response(JSON.stringify({ id: "med_car_final" }), { status: 200 });
            }
            return new Response(JSON.stringify({}), { status: 200 });
        }) as typeof fetch;

        const res = await publishInstagramPost(
            {
                igUserId: "ig_100",
                accessToken: "tok",
                type: "CAROUSEL",
                caption: "Carrossel teste",
                mediaItems: [
                    { mediaType: "IMAGE", publicUrl: "https://cdn.marctech.me/1.jpg" },
                    { mediaType: "VIDEO", publicUrl: "https://cdn.marctech.me/2.mp4" },
                ],
            },
            { fetchImpl: mockFetch, pollIntervalMs: 0 }
        );
        assert.equal(res.containerId, "cont_car_3");
        assert.equal(res.mediaId, "med_car_final");
        assert.ok(bodies[2].includes("media_type=CAROUSEL"));
        assert.ok(bodies[2].includes("children=cont_car_1%2Ccont_car_2"));
    }

    // 5. Erro Meta propaga InstagramApiError com code
    {
        const mockFetch = (async () => {
            return new Response(
                JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }),
                { status: 400 }
            );
        }) as typeof fetch;

        await assert.rejects(
            () =>
                publishInstagramPost(
                    {
                        igUserId: "ig_100",
                        accessToken: "bad",
                        type: "FEED",
                        mediaItems: [{ mediaType: "IMAGE", publicUrl: "https://cdn.marctech.me/a.jpg" }],
                    },
                    { fetchImpl: mockFetch, pollIntervalMs: 0 }
                ),
            (err: unknown) => err instanceof InstagramApiError && err.code === 190
        );
    }
});
