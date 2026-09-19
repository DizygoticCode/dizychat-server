package com.chat.dizychat;

import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class DizyPushFingerprintTest {
    @Test public void matchesServerSha256Prefix() {
        assertEquals("4c5dc9b77089", DizyPushFingerprint.of(" test-token "));
        assertEquals("", DizyPushFingerprint.of(null));
        assertEquals("", DizyPushFingerprint.of("  "));
    }
}
