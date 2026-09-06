package com.chat.dizychat;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

final class DizyNotificationManager {
    static final String CHANNEL_ID = "dizychat_messages_v1";
    static final String EXTRA_NOTIFICATION_ID = "dizy_notification_id";
    static final String REMOTE_INPUT_KEY = "dizy_reply_text";

    private DizyNotificationManager() {}

    static void showMessageNotification(
            Context context,
            String room,
            String messageId,
            String sender,
            String preview,
            String notificationKey,
            String timestamp
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ensureChannel(context);

        String identity = notificationKey == null || notificationKey.trim().isEmpty()
                ? room
                : notificationKey.trim();
        int notificationId = notificationId(identity);

        Intent tapIntent = new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(DizyPushPlugin.EXTRA_ROOM, room)
                .putExtra(DizyPushPlugin.EXTRA_MESSAGE_ID, messageId);
        PendingIntent tapPendingIntent = PendingIntent.getActivity(
                context,
                notificationId,
                tapIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        RemoteInput remoteInput = new RemoteInput.Builder(REMOTE_INPUT_KEY)
                .setLabel("Reply")
                .build();
        Intent replyIntent = actionIntent(context, DizyNotificationActionReceiver.ACTION_REPLY, room, messageId, notificationId);
        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
                context,
                notificationId ^ 0x22000000,
                replyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_send,
                "Reply",
                replyPendingIntent
        ).addRemoteInput(remoteInput).build();

        Intent readIntent = actionIntent(context, DizyNotificationActionReceiver.ACTION_MARK_READ, room, messageId, notificationId);
        PendingIntent readPendingIntent = PendingIntent.getBroadcast(
                context,
                notificationId ^ 0x44000000,
                readIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Action readAction = new NotificationCompat.Action.Builder(
                android.R.drawable.checkbox_on_background,
                "Mark as read",
                readPendingIntent
        ).build();

        String cleanSender = sender == null || sender.trim().isEmpty() ? "DizyChat" : sender.trim();
        String cleanPreview = preview == null ? "" : preview.trim();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(cleanSender + " · " + room)
                .setContentText(cleanPreview)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(cleanPreview))
                .setContentIntent(tapPendingIntent)
                .setAutoCancel(false)
                .setOnlyAlertOnce(false)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setGroup("dizychat-room-" + room)
                .addAction(replyAction)
                .addAction(readAction);
        if (timestamp != null && !timestamp.trim().isEmpty()) {
            try {
                builder.setWhen(Long.parseLong(timestamp.trim()));
            } catch (NumberFormatException ignored) {
                // Server timestamp is display-only metadata; system time is safe fallback.
            }
        }
        NotificationManagerCompat.from(context).notify(notificationId, builder.build());
    }

    static void cancel(Context context, int notificationId) {
        NotificationManagerCompat.from(context).cancel(notificationId);
    }

    private static Intent actionIntent(Context context, String action, String room, String messageId, int notificationId) {
        return new Intent(context, DizyNotificationActionReceiver.class)
                .setAction(action)
                .putExtra(DizyPushPlugin.EXTRA_ROOM, room)
                .putExtra(DizyPushPlugin.EXTRA_MESSAGE_ID, messageId)
                .putExtra(EXTRA_NOTIFICATION_ID, notificationId);
    }

    private static int notificationId(String notificationKey) {
        return 0x12000000 | (notificationKey.hashCode() & 0x0fffffff);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "DizyChat messages",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Messages from subscribed DizyChat rooms");
        manager.createNotificationChannel(channel);
    }
}
