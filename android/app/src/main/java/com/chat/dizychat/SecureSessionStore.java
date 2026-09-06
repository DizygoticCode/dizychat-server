package com.chat.dizychat;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureSessionStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "dizychat.mobile.session.v1";
    private static final String PREFS = "dizychat_secure_session_v1";
    private static final String PREF_IV = "iv";
    private static final String PREF_CIPHERTEXT = "ciphertext";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private SecureSessionStore() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build();
        generator.init(spec);
        return generator.generateKey();
    }

    static String readToken(Context context) throws Exception {
        SharedPreferences prefs = preferences(context);
        String ivEncoded = prefs.getString(PREF_IV, "");
        String ciphertextEncoded = prefs.getString(PREF_CIPHERTEXT, "");
        if (ivEncoded == null || ivEncoded.isEmpty() || ciphertextEncoded == null || ciphertextEncoded.isEmpty()) {
            return "";
        }

        byte[] iv = Base64.decode(ivEncoded, Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(ciphertextEncoded, Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    static void writeToken(Context context, String rawToken) throws Exception {
        String token = rawToken == null ? "" : rawToken.trim();
        if (token.isEmpty()) {
            clearToken(context);
            return;
        }

        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));

        boolean stored = preferences(context).edit()
                .putString(PREF_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                .putString(PREF_CIPHERTEXT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                .commit();
        if (!stored) throw new IllegalStateException("Unable to persist secure DizyChat session");
    }

    static void clearToken(Context context) {
        boolean cleared = preferences(context).edit()
                .remove(PREF_IV)
                .remove(PREF_CIPHERTEXT)
                .commit();
        if (!cleared) throw new IllegalStateException("Unable to clear secure DizyChat session");
    }
}
