package com.chat.dizychat;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureSessionPlugin.class);
        registerPlugin(MobileShellPlugin.class);
        registerPlugin(NativePermissionsPlugin.class);
        super.onCreate(savedInstanceState);
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
