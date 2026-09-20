package com.chat.dizychat;

import android.content.Context;
import android.util.Log;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

/** Public Firebase identifiers and irreversible token prefixes only. Never log Options.toString(). */
final class DizyPushTrace {
    private static final String TAG = "DizyPushTrace";
    private DizyPushTrace() {}

    static void identity(Context context) {
        try {
            FirebaseOptions options = FirebaseApp.getInstance().getOptions();
            Log.i(TAG, "firebase-identity package=" + context.getPackageName()
                    + " projectId=" + options.getProjectId()
                    + " senderId=" + options.getGcmSenderId()
                    + " firebaseAppId=" + options.getApplicationId());
        } catch (RuntimeException error) {
            failure("firebase-identity", error);
        }
    }

    static void token(String event, String token) {
        Log.i(TAG, event + " tokenFingerprint=" + DizyPushFingerprint.of(token));
    }

    static void failure(String event, Exception error) {
        // Exception text/stack traces may include request parameters; log classes only.
        Log.w(TAG, event + " failed errorClass=" + (error == null ? "unknown" : error.getClass().getSimpleName())
                + " causeClass=" + (error == null || error.getCause() == null ? "none" : error.getCause().getClass().getSimpleName()));
    }
}
