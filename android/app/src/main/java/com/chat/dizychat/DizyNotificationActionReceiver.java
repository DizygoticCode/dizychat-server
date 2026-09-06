package com.chat.dizychat;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.RemoteInput;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class DizyNotificationActionReceiver extends BroadcastReceiver {
    static final String ACTION_REPLY = "com.chat.dizychat.notification.REPLY";
    static final String ACTION_MARK_READ = "com.chat.dizychat.notification.MARK_READ";
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        PendingResult pending = goAsync();
        Context appContext = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                handleAction(appContext, intent);
            } finally {
                pending.finish();
            }
        });
    }

    private static void handleAction(Context context, Intent intent) {
        String room = clean(intent.getStringExtra(DizyPushPlugin.EXTRA_ROOM));
        String messageId = clean(intent.getStringExtra(DizyPushPlugin.EXTRA_MESSAGE_ID));
        int notificationId = intent.getIntExtra(DizyNotificationManager.EXTRA_NOTIFICATION_ID, 0);
        if (room.isEmpty() || messageId.isEmpty() || notificationId == 0) return;

        String token;
        try {
            token = clean(SecureSessionStore.readToken(context));
        } catch (Exception ignored) {
            return;
        }
        String backendOrigin = clean(DizyPushStore.getBackendOrigin(context));
        if (token.isEmpty() || backendOrigin.isEmpty()) return;

        boolean success = false;
        boolean markRead = ACTION_MARK_READ.equals(intent.getAction());
        if (markRead) {
            JSONObject payload = new JSONObject();
            try {
                payload.put("room", room);
                payload.put("messageId", messageId);
                success = postJson(backendOrigin + "/api/read-state/mark", token, payload);
            } catch (Exception ignored) {
                success = false;
            }
        } else if (ACTION_REPLY.equals(intent.getAction())) {
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            CharSequence rawReply = results == null ? null : results.getCharSequence(DizyNotificationManager.REMOTE_INPUT_KEY);
            String text = rawReply == null ? "" : rawReply.toString().trim();
            if (!text.isEmpty()) {
                JSONObject payload = new JSONObject();
                try {
                    payload.put("room", room);
                    payload.put("text", text);
                    payload.put("replyToMessageId", messageId);
                    payload.put("deviceId", DizyPushStore.getOrCreateDeviceId(context));
                    success = postJson(backendOrigin + "/api/mobile/push/reply", token, payload);
                } catch (Exception ignored) {
                    success = false;
                }
            }
        }

        if (success && markRead) {
            DizyNotificationStateStore.clearNotification(context, notificationId);
            DizyNotificationManager.cancel(context, notificationId);
        }
    }

    private static boolean postJson(String endpoint, String token, JSONObject payload) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setDoOutput(true);
            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }
            int responseCode = connection.getResponseCode();
            return responseCode >= 200 && responseCode < 300;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
