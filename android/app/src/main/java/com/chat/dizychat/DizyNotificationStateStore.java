package com.chat.dizychat;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

final class DizyNotificationStateStore {
    static final int MAX_RECENT_MESSAGES = 8;
    private static final String PREFS = "dizy_notification_state_v1";
    private static final String STATE_PREFIX = "state:";
    private static final String ID_OWNER_PREFIX = "id-owner:";
    private static final String KEY_ID_PREFIX = "key-id:";

    static final class Entry {
        final String messageId;
        final String sender;
        final String preview;
        final String timestamp;

        Entry(String messageId, String sender, String preview, String timestamp) {
            this.messageId = clean(messageId);
            this.sender = clean(sender);
            this.preview = clean(preview);
            this.timestamp = clean(timestamp);
        }
    }

    static final class RoomState {
        final String room;
        final String notificationKey;
        final int notificationId;
        final String latestMessageId;
        final String latestTimestamp;
        final String readMessageId;
        final String readTimestamp;
        final List<Entry> entries;

        RoomState(
                String room,
                String notificationKey,
                int notificationId,
                String latestMessageId,
                String latestTimestamp,
                String readMessageId,
                String readTimestamp,
                List<Entry> entries
        ) {
            this.room = clean(room);
            this.notificationKey = clean(notificationKey);
            this.notificationId = notificationId;
            this.latestMessageId = clean(latestMessageId);
            this.latestTimestamp = clean(latestTimestamp);
            this.readMessageId = clean(readMessageId);
            this.readTimestamp = clean(readTimestamp);
            this.entries = Collections.unmodifiableList(new ArrayList<>(entries));
        }
    }

    enum ReconcileStatus { STALE, CLEARED, UPDATED }

    static final class ReconcileResult {
        final ReconcileStatus status;
        final int notificationId;
        final RoomState state;

        ReconcileResult(ReconcileStatus status, int notificationId, RoomState state) {
            this.status = status;
            this.notificationId = notificationId;
            this.state = state;
        }
    }

    private DizyNotificationStateStore() {}

    static synchronized RoomState recordMessage(
            Context context,
            String room,
            String messageId,
            String sender,
            String preview,
            String notificationKey,
            String timestamp
    ) {
        String key = required(notificationKey, "notification key");
        String normalizedRoom = required(room, "room");
        String normalizedMessageId = required(messageId, "message id");
        String normalizedTimestamp = required(timestamp, "timestamp");
        validateCursor(normalizedTimestamp, normalizedMessageId);

        SharedPreferences prefs = prefs(context);
        RoomState existing = readState(prefs, key);
        if (existing != null && !existing.readTimestamp.isEmpty() && !existing.readMessageId.isEmpty()) {
            if (DizyNotificationCursor.compare(
                    normalizedTimestamp,
                    normalizedMessageId,
                    existing.readTimestamp,
                    existing.readMessageId
            ) <= 0) {
                return existing.entries.isEmpty() ? null : existing;
            }
        }

        int notificationId = resolveNotificationId(prefs, key);
        List<Entry> entries = new ArrayList<>();
        if (existing != null && normalizedRoom.equals(existing.room)) entries.addAll(existing.entries);
        entries.removeIf(entry -> normalizedMessageId.equalsIgnoreCase(entry.messageId));
        entries.add(new Entry(normalizedMessageId, sender, preview, normalizedTimestamp));
        entries.sort(ENTRY_ORDER);
        while (entries.size() > MAX_RECENT_MESSAGES) entries.remove(0);

        Entry latest = entries.get(entries.size() - 1);
        RoomState next = new RoomState(
                normalizedRoom,
                key,
                notificationId,
                latest.messageId,
                latest.timestamp,
                existing == null ? "" : existing.readMessageId,
                existing == null ? "" : existing.readTimestamp,
                entries
        );
        writeState(prefs, next);
        return next;
    }

    static synchronized ReconcileResult applyReadCursor(
            Context context,
            String room,
            String notificationKey,
            String messageId,
            String timestamp
    ) {
        String key = required(notificationKey, "notification key");
        String normalizedRoom = required(room, "room");
        String normalizedMessageId = required(messageId, "message id");
        String normalizedTimestamp = required(timestamp, "timestamp");
        validateCursor(normalizedTimestamp, normalizedMessageId);

        SharedPreferences prefs = prefs(context);
        RoomState existing = readState(prefs, key);
        if (existing == null || !normalizedRoom.equals(existing.room)) {
            return new ReconcileResult(ReconcileStatus.STALE, 0, null);
        }
        if (!existing.readTimestamp.isEmpty() && !existing.readMessageId.isEmpty()
                && DizyNotificationCursor.compare(
                        normalizedTimestamp,
                        normalizedMessageId,
                        existing.readTimestamp,
                        existing.readMessageId
                ) <= 0) {
            return new ReconcileResult(ReconcileStatus.STALE, existing.notificationId, existing);
        }

        List<Entry> remaining = new ArrayList<>();
        for (Entry entry : existing.entries) {
            if (DizyNotificationCursor.compare(
                    entry.timestamp,
                    entry.messageId,
                    normalizedTimestamp,
                    normalizedMessageId
            ) > 0) {
                remaining.add(entry);
            }
        }

        if (remaining.isEmpty()) {
            prefs.edit().remove(STATE_PREFIX + key).apply();
            return new ReconcileResult(ReconcileStatus.CLEARED, existing.notificationId, null);
        }

        remaining.sort(ENTRY_ORDER);
        Entry latest = remaining.get(remaining.size() - 1);
        RoomState next = new RoomState(
                existing.room,
                existing.notificationKey,
                existing.notificationId,
                latest.messageId,
                latest.timestamp,
                normalizedMessageId,
                normalizedTimestamp,
                remaining
        );
        writeState(prefs, next);
        return new ReconcileResult(ReconcileStatus.UPDATED, existing.notificationId, next);
    }

    static synchronized List<String> listRooms(Context context) {
        SharedPreferences prefs = prefs(context);
        List<String> rooms = new ArrayList<>();
        for (String prefKey : prefs.getAll().keySet()) {
            if (!prefKey.startsWith(STATE_PREFIX)) continue;
            String logicalKey = prefKey.substring(STATE_PREFIX.length());
            RoomState state = readState(prefs, logicalKey);
            if (state != null && !state.room.isEmpty() && !rooms.contains(state.room)) rooms.add(state.room);
        }
        Collections.sort(rooms);
        return rooms;
    }

    static synchronized List<RoomState> listStates(Context context) {
        SharedPreferences prefs = prefs(context);
        List<RoomState> states = new ArrayList<>();
        for (String prefKey : prefs.getAll().keySet()) {
            if (!prefKey.startsWith(STATE_PREFIX)) continue;
            String logicalKey = prefKey.substring(STATE_PREFIX.length());
            RoomState state = readState(prefs, logicalKey);
            if (state != null) states.add(state);
        }
        states.sort(Comparator.comparing(state -> state.room));
        return states;
    }

    static synchronized void clearNotification(Context context, int notificationId) {
        SharedPreferences prefs = prefs(context);
        String owner = clean(prefs.getString(ID_OWNER_PREFIX + notificationId, ""));
        if (!owner.isEmpty()) prefs.edit().remove(STATE_PREFIX + owner).apply();
    }

    private static int resolveNotificationId(SharedPreferences prefs, String notificationKey) {
        int stored = prefs.getInt(KEY_ID_PREFIX + notificationKey, 0);
        if (stored != 0 && notificationKey.equals(prefs.getString(ID_OWNER_PREFIX + stored, ""))) return stored;

        int resolved = DizyNotificationIdentity.resolve(
                notificationKey,
                id -> prefs.getString(ID_OWNER_PREFIX + id, null)
        );
        prefs.edit()
                .putInt(KEY_ID_PREFIX + notificationKey, resolved)
                .putString(ID_OWNER_PREFIX + resolved, notificationKey)
                .apply();
        return resolved;
    }

    private static RoomState readState(SharedPreferences prefs, String notificationKey) {
        String raw = prefs.getString(STATE_PREFIX + notificationKey, null);
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            JSONObject json = new JSONObject(raw);
            String room = required(json.optString("room"), "room");
            String key = required(json.optString("notificationKey"), "notification key");
            int notificationId = json.getInt("notificationId");
            String latestMessageId = required(json.optString("latestMessageId"), "latest message id");
            String latestTimestamp = required(json.optString("latestTimestamp"), "latest timestamp");
            validateCursor(latestTimestamp, latestMessageId);
            String readMessageId = clean(json.optString("readMessageId"));
            String readTimestamp = clean(json.optString("readTimestamp"));
            if (!readMessageId.isEmpty() || !readTimestamp.isEmpty()) validateCursor(readTimestamp, readMessageId);

            JSONArray recent = json.optJSONArray("entries");
            List<Entry> entries = new ArrayList<>();
            if (recent != null) {
                for (int index = 0; index < recent.length(); index += 1) {
                    JSONObject item = recent.getJSONObject(index);
                    Entry entry = new Entry(
                            item.optString("messageId"),
                            item.optString("sender"),
                            item.optString("preview"),
                            item.optString("timestamp")
                    );
                    validateCursor(entry.timestamp, entry.messageId);
                    entries.add(entry);
                }
            }
            if (entries.isEmpty()) throw new JSONException("room state has no entries");
            entries.sort(ENTRY_ORDER);
            while (entries.size() > MAX_RECENT_MESSAGES) entries.remove(0);
            return new RoomState(
                    room,
                    key,
                    notificationId,
                    latestMessageId,
                    latestTimestamp,
                    readMessageId,
                    readTimestamp,
                    entries
            );
        } catch (Exception error) {
            prefs.edit().remove(STATE_PREFIX + notificationKey).apply();
            return null;
        }
    }

    private static void writeState(SharedPreferences prefs, RoomState state) {
        try {
            JSONObject json = new JSONObject();
            json.put("room", state.room);
            json.put("notificationKey", state.notificationKey);
            json.put("notificationId", state.notificationId);
            json.put("latestMessageId", state.latestMessageId);
            json.put("latestTimestamp", state.latestTimestamp);
            json.put("readMessageId", state.readMessageId);
            json.put("readTimestamp", state.readTimestamp);
            JSONArray recent = new JSONArray();
            for (Entry entry : state.entries) {
                JSONObject item = new JSONObject();
                item.put("messageId", entry.messageId);
                item.put("sender", entry.sender);
                item.put("preview", entry.preview);
                item.put("timestamp", entry.timestamp);
                recent.put(item);
            }
            json.put("entries", recent);
            prefs.edit().putString(STATE_PREFIX + state.notificationKey, json.toString()).apply();
        } catch (JSONException error) {
            throw new IllegalStateException("unable to persist notification state", error);
        }
    }

    static long timestampMillis(String timestamp) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setLenient(false);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        try {
            Date date = format.parse(required(timestamp, "timestamp"));
            if (date == null) throw new ParseException("empty date", 0);
            return date.getTime();
        } catch (ParseException error) {
            return System.currentTimeMillis();
        }
    }

    private static void validateCursor(String timestamp, String messageId) {
        DizyNotificationCursor.compare(timestamp, messageId, timestamp, messageId);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String required(String value, String label) {
        String cleaned = clean(value);
        if (cleaned.isEmpty()) throw new IllegalArgumentException(label + " is required");
        return cleaned;
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private static final Comparator<Entry> ENTRY_ORDER = (left, right) -> DizyNotificationCursor.compare(
            left.timestamp,
            left.messageId,
            right.timestamp,
            right.messageId
    );
}
