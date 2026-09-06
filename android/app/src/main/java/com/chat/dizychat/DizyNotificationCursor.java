package com.chat.dizychat;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.regex.Pattern;

final class DizyNotificationCursor {
    private static final Pattern OBJECT_ID = Pattern.compile("^[a-fA-F0-9]{24}$");
    private static final Pattern UTC_TIMESTAMP = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$");

    private DizyNotificationCursor() {}

    static int compare(
            String leftTimestamp,
            String leftMessageId,
            String rightTimestamp,
            String rightMessageId
    ) {
        long leftTime = parseTimestamp(leftTimestamp).getTime();
        long rightTime = parseTimestamp(rightTimestamp).getTime();
        if (leftTime != rightTime) return Long.compare(leftTime, rightTime);

        String leftId = normalizeMessageId(leftMessageId);
        String rightId = normalizeMessageId(rightMessageId);
        return leftId.compareTo(rightId);
    }

    private static Date parseTimestamp(String value) {
        String timestamp = value == null ? "" : value.trim();
        if (!UTC_TIMESTAMP.matcher(timestamp).matches()) {
            throw new IllegalArgumentException("notification cursor timestamp is invalid");
        }
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setLenient(false);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        try {
            return format.parse(timestamp);
        } catch (ParseException error) {
            throw new IllegalArgumentException("notification cursor timestamp is invalid", error);
        }
    }

    private static String normalizeMessageId(String value) {
        String messageId = value == null ? "" : value.trim();
        if (!OBJECT_ID.matcher(messageId).matches()) {
            throw new IllegalArgumentException("notification cursor message id is invalid");
        }
        return messageId.toLowerCase(Locale.ROOT);
    }
}
