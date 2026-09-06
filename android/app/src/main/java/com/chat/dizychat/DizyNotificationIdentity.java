package com.chat.dizychat;

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

        int base = key.hashCode() & VALUE_MASK;
        for (int offset = 0; offset <= VALUE_MASK; offset += 1) {
            int candidate = PREFIX | ((base + offset) & VALUE_MASK);
            String occupant = occupants.logicalKeyFor(candidate);
            if (occupant == null || key.equals(occupant)) return candidate;
        }
        throw new IllegalStateException("no Android notification id is available");
    }
}
