package com.chat.dizychat;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class WebBundleManifest {
    public static final int SCHEMA_VERSION = 1;
    public static final String ENTRY_PATH = "login.html";
    public static final int MAX_FILES = 32;
    public static final long MAX_FILE_BYTES = 8L * 1024L * 1024L;
    public static final long MAX_TOTAL_BYTES = 32L * 1024L * 1024L;

    public static final List<String> REQUIRED_CORE_PATHS = Collections.unmodifiableList(Arrays.asList(
            "app-config.js",
            "auth-v2-client.js",
            "chat.css",
            "chat.js",
            "emojis.json",
            "index.html",
            "login.html",
            "logo-light.svg",
            "logo.svg",
            "mobile-bootstrap.js",
            "mobile-push-runtime.js",
            "mobile-runtime.js",
            "mobile-toolbar.css",
            "public-auth-ui.js",
            "public-auth.css"
    ));

    private static final Pattern SAFE_PATH_CHARS = Pattern.compile("^[A-Za-z0-9._%\\-/]+$");
    private static final Pattern SAFE_DECODED_PATH_CHARS = Pattern.compile("^[A-Za-z0-9._\\-/]+$");
    private static final Pattern HASH = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern URI_SCHEME = Pattern.compile("^[A-Za-z][A-Za-z0-9+.-]*:.*$");

    private final int schemaVersion;
    private final String entryPath;
    private final String bundleVersion;
    private final List<Entry> files;

    public WebBundleManifest(int schemaVersion, String entryPath, String bundleVersion, List<Entry> files) {
        if (schemaVersion != SCHEMA_VERSION) {
            throw new IllegalArgumentException("Unsupported web bundle schema");
        }
        if (!ENTRY_PATH.equals(entryPath) || !isSafeRelativePath(entryPath)) {
            throw new IllegalArgumentException("Invalid web bundle entry path");
        }
        if (!isSha256(bundleVersion)) {
            throw new IllegalArgumentException("Invalid web bundle version");
        }
        if (files == null || files.isEmpty() || files.size() > MAX_FILES) {
            throw new IllegalArgumentException("Invalid web bundle file count");
        }

        Set<String> required = new HashSet<>(REQUIRED_CORE_PATHS);
        Set<String> seen = new HashSet<>();
        long totalBytes = 0L;
        List<Entry> validated = new ArrayList<>(files.size());
        for (Entry entry : files) {
            if (entry == null || !isSafeRelativePath(entry.path)) {
                throw new IllegalArgumentException("Unsafe web bundle file path");
            }
            if (!required.contains(entry.path)) {
                throw new IllegalArgumentException("Unexpected web bundle file");
            }
            if (!seen.add(entry.path)) {
                throw new IllegalArgumentException("Duplicate web bundle file");
            }
            if (entry.size < 0L || entry.size > MAX_FILE_BYTES) {
                throw new IllegalArgumentException("Invalid web bundle file size");
            }
            if (!isSha256(entry.sha256)) {
                throw new IllegalArgumentException("Invalid web bundle file hash");
            }
            totalBytes += entry.size;
            if (totalBytes > MAX_TOTAL_BYTES) {
                throw new IllegalArgumentException("Web bundle is too large");
            }
            validated.add(entry);
        }

        if (!seen.equals(required)) {
            throw new IllegalArgumentException("Web bundle core is incomplete");
        }

        this.schemaVersion = schemaVersion;
        this.entryPath = entryPath;
        this.bundleVersion = bundleVersion;
        this.files = Collections.unmodifiableList(validated);
    }

    public static WebBundleManifest fromJson(JSONObject json) throws JSONException {
        if (json == null) throw new IllegalArgumentException("Manifest is required");
        JSONArray fileArray = json.getJSONArray("files");
        List<Entry> entries = new ArrayList<>(fileArray.length());
        for (int i = 0; i < fileArray.length(); i++) {
            JSONObject item = fileArray.getJSONObject(i);
            entries.add(new Entry(
                    item.getString("path"),
                    item.getLong("size"),
                    item.getString("sha256")
            ));
        }
        return new WebBundleManifest(
                json.getInt("schemaVersion"),
                json.getString("entryPath"),
                json.getString("bundleVersion"),
                entries
        );
    }

    public int getSchemaVersion() {
        return schemaVersion;
    }

    public String getEntryPath() {
        return entryPath;
    }

    public String getBundleVersion() {
        return bundleVersion;
    }

    public List<Entry> getFiles() {
        return files;
    }

    public static boolean isSafeRelativePath(String value) {
        if (value == null || value.isEmpty() || value.startsWith("/") || value.contains("\\")) return false;
        if (!SAFE_PATH_CHARS.matcher(value).matches() || URI_SCHEME.matcher(value).matches()) return false;

        String decoded = decodePercentEscapes(value);
        if (decoded == null || decoded.isEmpty() || decoded.startsWith("/") || decoded.contains("\\")) return false;
        if (!SAFE_DECODED_PATH_CHARS.matcher(decoded).matches() || URI_SCHEME.matcher(decoded).matches()) return false;
        for (String part : decoded.split("/", -1)) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) return false;
        }
        return true;
    }

    private static String decodePercentEscapes(String value) {
        StringBuilder decoded = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char current = value.charAt(i);
            if (current != '%') {
                decoded.append(current);
                continue;
            }
            if (i + 2 >= value.length()) return null;
            int high = Character.digit(value.charAt(i + 1), 16);
            int low = Character.digit(value.charAt(i + 2), 16);
            if (high < 0 || low < 0) return null;
            decoded.append((char) ((high << 4) | low));
            i += 2;
        }
        return decoded.toString();
    }

    public static String sha256Hex(File file) throws IOException {
        if (file == null || !file.isFile()) throw new IOException("Bundle file is missing");
        final MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
        byte[] buffer = new byte[64 * 1024];
        try (FileInputStream input = new FileInputStream(file)) {
            int count;
            while ((count = input.read(buffer)) != -1) {
                digest.update(buffer, 0, count);
            }
        }
        StringBuilder out = new StringBuilder(64);
        for (byte value : digest.digest()) out.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return out.toString();
    }

    public static boolean verifyFile(File file, Entry entry) {
        if (file == null || entry == null || !file.isFile() || file.length() != entry.size) return false;
        try {
            return entry.sha256.equals(sha256Hex(file));
        } catch (IOException error) {
            return false;
        }
    }

    private static boolean isSha256(String value) {
        return value != null && HASH.matcher(value).matches();
    }

    public static final class Entry {
        private final String path;
        private final long size;
        private final String sha256;

        public Entry(String path, long size, String sha256) {
            this.path = path;
            this.size = size;
            this.sha256 = sha256;
        }

        public String getPath() {
            return path;
        }

        public long getSize() {
            return size;
        }

        public String getSha256() {
            return sha256;
        }
    }
}
