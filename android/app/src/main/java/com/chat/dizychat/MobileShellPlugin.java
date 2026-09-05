package com.chat.dizychat;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MobileShell")
public class MobileShellPlugin extends Plugin {
    @PluginMethod
    public void openExternal(PluginCall call) {
        String rawUrl = call.getString("url", "");
        Uri uri = Uri.parse(rawUrl == null ? "" : rawUrl.trim());
        String scheme = uri.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
            call.reject("Only HTTP(S) links can be opened externally.");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to open external link.", error);
        }
    }
}
