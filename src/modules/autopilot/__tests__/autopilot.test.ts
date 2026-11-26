import assert from "node:assert/strict";
import test from "node:test";
import {
    classifyDriveFile,
    extractGoogleDriveFolderId,
    parseEmbeddedFolderHtml,
    parseMetadataText,
} from "../drive";
import { buildAutoPilotCaption } from "../caption";
import { computeUpcomingSlots } from "../scheduler";

test("extractGoogleDriveFolderId extrai IDs de URLs do Google Drive e rejeita hosts externos", () => {
    assert.equal(
        extractGoogleDriveFolderId("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing"),
        "1AbCdEfGhIjKlMnOpQrStUvWxYz"
    );
    assert.equal(
        extractGoogleDriveFolderId("https://drive.google.com/drive/u/0/folders/1XyZ9876543210abcdef"),
        "1XyZ9876543210abcdef"
    );
    assert.equal(extractGoogleDriveFolderId("1AbCdEfGhIjKlMnOpQrStUvWxYz"), "1AbCdEfGhIjKlMnOpQrStUvWxYz");
    assert.equal(extractGoogleDriveFolderId("https://evil.example.com/drive/folders/1AbCdEfGhIjKlMnOpQr"), null);
    assert.equal(extractGoogleDriveFolderId(""), null);
});

test("parseMetadataText e parseEmbeddedFolderHtml extraem arquivos, preço, cupom e link", () => {
    const meta = parseMetadataText(
        "Perfume Lattafa Asad 100ml original!\nPreço: R$ 189,90\nCupom: marcelo10\nhttps://loja.marctech.me/asad"
    );
    assert.equal(meta.priceText, "R$ 189,90");
    assert.equal(meta.couponCode, "MARCELO10");
    assert.equal(meta.productUrl, "https://loja.marctech.me/asad");

    const html = `
      <div class="flip-entry" id="entry-1AbCdEfGhIjKlMnOpQr1"><div class="flip-entry-title">perfume_asad.mp4</div></div>
      <div class="flip-entry" id="entry-1AbCdEfGhIjKlMnOpQr2"><div class="flip-entry-title">perfume_asad.txt</div></div>
      <div class="flip-entry" id="entry-1AbCdEfGhIjKlMnOpQr3"><div class="flip-entry-title">banner.png</div></div>
    `;
    const parsed = parseEmbeddedFolderHtml(html);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].mediaType, "VIDEO");
    assert.equal(parsed[1].mediaType, "TEXT");
    assert.equal(parsed[2].mediaType, "IMAGE");
    assert.equal(classifyDriveFile("vetor.svg"), null);
});

test("buildAutoPilotCaption aplica template e dados do revendedor", async () => {
    const rendered = await buildAutoPilotCaption({
        itemTitle: "Malbec Gold 100ml",
        itemCaption: "Fragrância amadeirada marcante.",
        itemPriceText: "R$ 199,90",
        captionTemplate: "🔥 {produto} por {preco}\nCupom: {cupom}\nCompre: {link}\nZap: {whatsapp}",
        resellerLink: "https://loja.marctech.me/?ref=joao",
        resellerCoupon: "JOAO10",
        resellerWhatsapp: "(11) 99999-0000",
        convertAffiliateLinks: false,
    });

    assert.ok(rendered.includes("Malbec Gold 100ml"));
    assert.ok(rendered.includes("R$ 199,90"));
    assert.ok(rendered.includes("JOAO10"));
    assert.ok(rendered.includes("https://loja.marctech.me/?ref=joao"));
    assert.ok(rendered.includes("(11) 99999-0000"));
});

test("computeUpcomingSlots distribui nos melhores horários evitando slots já preenchidos", () => {
    // 2026-11-26 10:00 America/Sao_Paulo = 2026-11-26T13:00:00Z
    const now = new Date("2026-11-26T13:00:00.000Z");
    const existing1230 = new Date("2026-11-26T15:30:00.000Z").getTime(); // 12:30 BRT já preenchido

    const slots = computeUpcomingSlots({
        scheduleTimes: ["09:00", "12:30", "18:30", "20:30"],
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        maxPostsPerDay: 2,
        timezone: "America/Sao_Paulo",
        existingSlotTimestamps: [existing1230],
        now,
        daysAhead: 1,
    });

    // Hoje (26/11): 09:00 já passou, 12:30 já preenchido (1 de 2 no dia), sobra apenas 18:30 hoje.
    // Amanhã (27/11): pega 09:00 e 12:30 (2 de 2 no dia).
    assert.equal(slots.length, 3);
    assert.equal(slots[0].toISOString(), "2026-11-26T21:30:00.000Z"); // 18:30 BRT
    assert.equal(slots[1].toISOString(), "2026-11-27T12:00:00.000Z"); // 09:00 BRT
    assert.equal(slots[2].toISOString(), "2026-11-27T15:30:00.000Z"); // 12:30 BRT
});
