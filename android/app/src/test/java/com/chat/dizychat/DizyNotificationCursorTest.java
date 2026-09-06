package com.chat.dizychat;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class DizyNotificationCursorTest {
    @Test
    public void compareMatchesServerTupleOrdering() {
        assertTrue(DizyNotificationCursor.compare(
                "2026-09-06T12:00:01.000Z", "507f1f77bcf86cd799439099",
                "2026-09-06T12:00:00.000Z", "507f1f77bcf86cd799439099") > 0);
        assertTrue(DizyNotificationCursor.compare(
                "2026-09-06T12:00:00.000Z", "507f1f77bcf86cd79943909a",
                "2026-09-06T12:00:00.000Z", "507f1f77bcf86cd799439099") > 0);
        assertEquals(0, DizyNotificationCursor.compare(
                "2026-09-06T12:00:00.000Z", "507f1f77bcf86cd799439099",
                "2026-09-06T12:00:00.000Z", "507F1F77BCF86CD799439099"));
    }

    @Test(expected = IllegalArgumentException.class)
    public void invalidTimestampFailsSafeInsteadOfGuessingReadState() {
        DizyNotificationCursor.compare(
                "not-a-timestamp", "507f1f77bcf86cd799439099",
                "2026-09-06T12:00:00.000Z", "507f1f77bcf86cd799439099");
    }
}
