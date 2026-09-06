package com.chat.dizychat;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.UUID;

final class DizyPushStore {
    private static final String PREFS = "dizychat_push_v1";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_FCM_TOKEN = "fcm_token";
    private static final String KEY_BACKEND_ORIGIN = "backend_origin";
    private static final String KEY_PERMISSION_REQUESTED = "permission_requested";
    private static final String KEY_LAUNCH_ROUTE = "launch_route";

    private DizyPushStore() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized String getOrCreateDeviceId(Context context) {
        SharedPreferences prefs = preferences(context);
        String existing = prefs.getString(KEY_DEVICE_ID, "");
        if (existing != null && !existing.trim().isEmpty()) return existing.trim();
        String created = UUID.randomUUID().toString();
        if (!prefs.edit().putString(KEY_DEVICE_ID, created).commit()) {
            throw new IllegalStateException("Unable to persist DizyChat device id");
        }
        return created;
    }

    static void setFcmToken(Context context, String token) {
        preferences(context).edit().putString(KEY_FCM_TOKEN, token == null ? "" : token.trim()).apply();
    }

    static String getFcmToken(Context context) {
        String token = preferences(context).getString(KEY_FCM_TOKEN, "");
        return token == null ? "" : token.trim();
    }

    static void setBackendOrigin(Context context, String origin) {
        preferences(context).edit().putString(KEY_BACKEND_ORIGIN, origin == null ? "" : origin.trim()).apply();
    }

    static String getBackendOrigin(Context context) {
        String origin = preferences(context).getString(KEY_BACKEND_ORIGIN, "");
        return origin == null ? "" : origin.trim();
    }

    static boolean wasPermissionRequested(Context context) {
        return preferences(context).getBoolean(KEY_PERMISSION_REQUESTED, false);
    }

    static void markPermissionRequested(Context context) {
        preferences(context).edit().putBoolean(KEY_PERMISSION_REQUESTED, true).apply();
    }

    static void setLaunchRoute(Context context, String room, String messageId) {
        try {
            JSONObject route = new JSONObject();
            route.put("room", room == null ? "" : room.trim());
            route.put("messageId", messageId == null ? "" : messageId.trim());
            preferences(context).edit().putString(KEY_LAUNCH_ROUTE, route.toString()).apply();
        } catch (Exception ignored) {
            // Invalid notification data is simply not persisted as a route.
        }
    }

    static JSONObject consumeLaunchRoute(Context context) {
        SharedPreferences prefs = preferences(context);
        String raw = prefs.getString(KEY_LAUNCH_ROUTE, "");
        prefs.edit().remove(KEY_LAUNCH_ROUTE).apply();
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            JSONObject route = new JSONObject(raw);
            if (route.optString("room", "").trim().isEmpty()) return null;
            return route;
        } catch (Exception ignored) {
            return null;
        }
    }
}
