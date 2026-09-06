package com.chat.dizychat;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.lang.ref.WeakReference;

@CapacitorPlugin(
        name = "DizyPush",
        permissions = {
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        }
)
public class DizyPushPlugin extends Plugin {
    static final String EXTRA_ROOM = "dizy_room";
    static final String EXTRA_MESSAGE_ID = "dizy_message_id";
    private static WeakReference<DizyPushPlugin> activePlugin = new WeakReference<>(null);

    @Override
    public void load() {
        activePlugin = new WeakReference<>(this);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String backendOrigin = normalizeBackendOrigin(call.getString("backendOrigin", ""));
        if (backendOrigin.isEmpty()) {
            call.reject("Invalid DizyChat backend origin");
            return;
        }
        DizyPushStore.setBackendOrigin(getContext(), backendOrigin);
        call.resolve();
    }

    @PluginMethod
    public void getRegistration(PluginCall call) {
        final String deviceId;
        try {
            deviceId = DizyPushStore.getOrCreateDeviceId(getContext());
        } catch (RuntimeException error) {
            call.reject("Unable to create DizyChat device id", error);
            return;
        }

        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null || task.getResult().trim().isEmpty()) {
                    Exception error = task.getException();
                    if (error != null) call.reject("Unable to obtain FCM token", error);
                    else call.reject("Unable to obtain FCM token");
                    return;
                }
                String fcmToken = task.getResult().trim();
                DizyPushStore.setFcmToken(getContext(), fcmToken);
                JSObject result = new JSObject();
                result.put("deviceId", deviceId);
                result.put("fcmToken", fcmToken);
                call.resolve(result);
            });
        } catch (RuntimeException error) {
            call.reject("Firebase messaging is not configured", error);
        }
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            JSObject result = new JSObject();
            result.put("state", "granted");
            call.resolve(result);
            return;
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            resolvePermission(call);
            return;
        }
        if (DizyPushStore.wasPermissionRequested(getContext())) {
            resolvePermission(call);
            return;
        }
        DizyPushStore.markPermissionRequested(getContext());
        requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        resolvePermission(call);
    }

    private void resolvePermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", getPermissionState("notifications") == PermissionState.GRANTED ? "granted" : "denied");
        call.resolve(result);
    }

    @PluginMethod
    public void isScreenOn(PluginCall call) {
        PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject result = new JSObject();
        result.put("on", powerManager != null && powerManager.isInteractive());
        call.resolve(result);
    }

    @PluginMethod
    public void consumeLaunchRoute(PluginCall call) {
        JSONObject route = DizyPushStore.consumeLaunchRoute(getContext());
        JSObject result = new JSObject();
        if (route != null) {
            result.put("room", route.optString("room", ""));
            result.put("messageId", route.optString("messageId", ""));
        }
        call.resolve(result);
    }

    static void notifyTokenChanged(Context context, String token) {
        String cleanToken = token == null ? "" : token.trim();
        if (cleanToken.isEmpty()) return;
        DizyPushStore.setFcmToken(context, cleanToken);
        DizyPushPlugin plugin = activePlugin.get();
        if (plugin == null) return;
        JSObject payload = new JSObject();
        payload.put("fcmToken", cleanToken);
        plugin.notifyListeners("tokenChanged", payload, true);
    }

    public static void handleIntent(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String room = intent.getStringExtra(EXTRA_ROOM);
        String messageId = intent.getStringExtra(EXTRA_MESSAGE_ID);
        if (room == null || room.trim().isEmpty()) return;
        DizyPushStore.setLaunchRoute(context, room, messageId == null ? "" : messageId);
        DizyPushPlugin plugin = activePlugin.get();
        if (plugin == null) return;
        JSObject route = new JSObject();
        route.put("room", room.trim());
        route.put("messageId", messageId == null ? "" : messageId.trim());
        plugin.notifyListeners("notificationRoute", route, true);
    }

    private static String normalizeBackendOrigin(String raw) {
        if (raw == null) return "";
        String value = raw.trim();
        if (value.isEmpty()) return "";
        try {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (host == null || !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) return "";
            int port = uri.getPort();
            return scheme.toLowerCase() + "://" + host + (port > 0 ? ":" + port : "");
        } catch (RuntimeException ignored) {
            return "";
        }
    }
}
