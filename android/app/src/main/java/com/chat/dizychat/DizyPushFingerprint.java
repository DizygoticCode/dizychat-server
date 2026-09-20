package com.chat.dizychat;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class DizyPushFingerprint {
    private DizyPushFingerprint() {}
    static String of(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return "";
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            char[] hex = "0123456789abcdef".toCharArray();
            StringBuilder out = new StringBuilder(12);
            for (int i = 0; i < 6; i++) {
                out.append(hex[(hash[i] & 0xff) >>> 4]);
                out.append(hex[hash[i] & 0x0f]);
            }
            return out.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable");
        }
    }
}
