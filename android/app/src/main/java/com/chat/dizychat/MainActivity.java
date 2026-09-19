package com.chat.dizychat;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "DizyChat";
    private static final String EXTRA_LOCAL_NOTIFICATION_TEST = "dizy_local_notification_test";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureSessionPlugin.class);
        registerPlugin(MobileShellPlugin.class);
        registerPlugin(NativePermissionsPlugin.class);
        registerPlugin(DizyPushPlugin.class);
        registerPlugin(WebBundlePlugin.class);
        DizyNotificationManager.ensureChannel(this);
        DizyPushPlugin.handleIntent(this, getIntent());
        maybeShowLocalNotificationTest(getIntent());

        try {
            WebBundleStore.prepareActivityLaunch(this);
        } catch (Exception error) {
            Log.w(TAG, "Unable to prepare verified web bundle; using packaged shell", error);
            WebBundleStore.persistCapacitorBasePath(this, null);
        }

        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        DizyPushPlugin.handleIntent(this, intent);
        maybeShowLocalNotificationTest(intent);
    }

    private void maybeShowLocalNotificationTest(Intent intent) {
        if (intent == null || !intent.getBooleanExtra(EXTRA_LOCAL_NOTIFICATION_TEST, false)) return;
        intent.removeExtra(EXTRA_LOCAL_NOTIFICATION_TEST);
        DizyNotificationManager.showMessageNotification(
                this,
                "Local Test",
                "507f1f77bcf86cd799439099",
                "DizyChat",
                "Local Android notification path is working",
                "0123456789abcdef01234567",
                "2026-09-19T18:30:00.000Z"
        );
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            performDefaultBack();
            return;
        }

        String script = "window.dizychatMobile && window.dizychatMobile.handleBack ? String(Boolean(window.dizychatMobile.handleBack())) : 'false'";
        try {
            getBridge().getWebView().evaluateJavascript(script, value -> {
                String normalized = value == null ? "" : value.replace("\"", "").trim();
                if (!"true".equalsIgnoreCase(normalized)) {
                    performDefaultBack();
                }
            });
        } catch (RuntimeException error) {
            performDefaultBack();
        }
    }

    @SuppressWarnings("deprecation")
    private void performDefaultBack() {
        super.onBackPressed();
    }
}
