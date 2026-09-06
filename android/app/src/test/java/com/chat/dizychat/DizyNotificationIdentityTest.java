package com.chat.dizychat;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import org.junit.Test;

public class DizyNotificationIdentityTest {
    @Test
    public void sameLogicalKeyResolvesDeterministically() {
        String key = "0123456789abcdef01234567";
        int first = DizyNotificationIdentity.resolve(key, ignored -> null);
        int second = DizyNotificationIdentity.resolve(key, ignored -> null);
        assertEquals(first, second);
    }

    @Test
    public void collisionDoesNotReuseAnotherLogicalNotification() {
        String key = "0123456789abcdef01234567";
        int first = DizyNotificationIdentity.resolve(key, ignored -> null);
        int second = DizyNotificationIdentity.resolve(
                key,
                id -> id == first ? "different-key" : null
        );
        assertNotEquals(first, second);
        assertEquals(second, DizyNotificationIdentity.resolve(
                key,
                id -> id == first ? "different-key" : null
        ));
    }

    @Test(expected = IllegalArgumentException.class)
    public void blankLogicalKeyIsRejected() {
        DizyNotificationIdentity.resolve("   ", ignored -> null);
    }
}
