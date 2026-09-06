package com.chat.dizychat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SecureSession")
public class SecureSessionPlugin extends Plugin {
    @PluginMethod
    public void readToken(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("token", SecureSessionStore.readToken(getContext()));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read secure DizyChat session", error);
        }
    }

    @PluginMethod
    public void writeToken(PluginCall call) {
        try {
            SecureSessionStore.writeToken(getContext(), call.getString("token", ""));
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to persist secure DizyChat session", error);
        }
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        try {
            SecureSessionStore.clearToken(getContext());
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to clear secure DizyChat session", error);
        }
    }
}
