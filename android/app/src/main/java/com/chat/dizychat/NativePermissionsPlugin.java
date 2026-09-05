package com.chat.dizychat;

import android.Manifest;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
        name = "NativePermissions",
        permissions = {
                @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO}),
                @Permission(alias = "camera", strings = {Manifest.permission.CAMERA})
        }
)
public class NativePermissionsPlugin extends Plugin {}
