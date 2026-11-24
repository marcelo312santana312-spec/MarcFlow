import test from "node:test";
import assert from "node:assert/strict";
import { isLidJid, normalizeJid, chatPathFromJid, chatJidFromPath } from "../jid-utils";

test("isLidJid identifica corretamente jids @lid", () => {
    assert.equal(isLidJid("123456789@lid"), true);
    assert.equal(isLidJid("5511999999999@s.whatsapp.net"), false);
    assert.equal(isLidJid("123456-789@g.us"), false);
    assert.equal(isLidJid(null), false);
    assert.equal(isLidJid(undefined), false);
});

test("normalizeJid converte @c.us para @s.whatsapp.net", () => {
    assert.equal(normalizeJid("5511999999999@c.us"), "5511999999999@s.whatsapp.net");
    assert.equal(normalizeJid("5511999999999@s.whatsapp.net"), "5511999999999@s.whatsapp.net");
    assert.equal(normalizeJid("123456-789@g.us"), "123456-789@g.us");
    assert.equal(normalizeJid(""), "");
    assert.equal(normalizeJid(null), "");
});

test("chatPathFromJid extrai número limpo para usuários e codifica grupos", () => {
    assert.equal(chatPathFromJid("5511999999999@s.whatsapp.net"), "5511999999999");
    assert.equal(chatPathFromJid("120363024823194091@g.us"), "120363024823194091%40g.us");
});

test("chatJidFromPath formata JID usando DDI padrão 55 para números com 0", () => {
    assert.equal(chatJidFromPath("011999999999"), "551199999999@s.whatsapp.net");
    assert.equal(chatJidFromPath("5511999999999"), "5511999999999@s.whatsapp.net");
});
