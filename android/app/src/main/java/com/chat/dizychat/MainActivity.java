package com.chat.dizychat;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "DizyChat";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureSessionPlugin.class);
        registerPlugin(MobileShellPlugin.class);
        registerPlugin(NativePermissionsPlugin.class);
        registerPlugin(DizyPushPlugin.class);
        registerPlugin(WebBundlePlugin.class);
        DizyPushPlugin.handleIntent(this, getIntent());

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
