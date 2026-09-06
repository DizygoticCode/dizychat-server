package com.chat.dizychat;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class DizyNotificationIdentity {
    private static final int PREFIX = 0x12000000;
    private static final int VALUE_MASK = 0x0fffffff;

    @FunctionalInterface
    interface OccupantLookup {
        String logicalKeyFor(int notificationId);
    }

    private DizyNotificationIdentity() {}

    static int resolve(String logicalKey, OccupantLookup occupants) {
        String key = logicalKey == null ? "" : logicalKey.trim();
        if (key.isEmpty()) throw new IllegalArgumentException("logical notification key is required");
        if (occupants == null) throw new IllegalArgumentException("occupant lookup is required");

        int base = digestBase(key);
        for (int offset = 0; offset <= VALUE_MASK; offset += 1) {
            int candidate = PREFIX | ((base + offset) & VALUE_MASK);
            String occupant = occupants.logicalKeyFor(candidate);
            if (occupant == null || key.equals(occupant)) return candidate;
        }
        throw new IllegalStateException("no Android notification id is available");
    }

    private static int digestBase(String key) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(key.getBytes(StandardCharsets.UTF_8));
            int value = ((digest[0] & 0xff) << 24)
                    | ((digest[1] & 0xff) << 16)
                    | ((digest[2] & 0xff) << 8)
                    | (digest[3] & 0xff);
            return value & VALUE_MASK;
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }
}
