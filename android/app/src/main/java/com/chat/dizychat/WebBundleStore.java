package com.chat.dizychat;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.plugin.WebView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

public final class WebBundleStore {
    private static final String STATE_PREFS = "dizychat-web-bundle";
    private static final String KEY_ACTIVE = "activeVersion";
    private static final String KEY_PENDING = "pendingVersion";
    private static final String KEY_PREVIOUS = "previousVersion";
    private static final String COMPLETE_MARKER = ".complete";
    private static final Pattern VERSION = Pattern.compile("^[0-9a-f]{64}$");

    public interface StateStore {
        String get(String key);
        void put(String key, String value);
        void remove(String key);
    }

    private final File root;
    private final StateStore state;

    public WebBundleStore(File root, StateStore state) throws IOException {
        if (root == null || state == null) throw new IllegalArgumentException("Bundle root and state are required");
        this.root = root.getCanonicalFile();
        this.state = state;
        if ((!this.root.mkdirs() && !this.root.isDirectory()) || !this.root.isDirectory()) {
            throw new IOException("Unable to create web bundle root");
        }
    }

    public static WebBundleStore fromContext(Context context) throws IOException {
        if (context == null) throw new IllegalArgumentException("Context is required");
        File root = new File(context.getFilesDir(), "web-bundles");
        SharedPreferences preferences = context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE);
        return new WebBundleStore(root, new SharedPreferencesState(preferences));
    }

    public static File prepareActivityLaunch(Context context) throws IOException {
        WebBundleStore store = fromContext(context);
        File launch = store.prepareLaunch();
        persistCapacitorBasePath(context, launch);
        return launch;
    }

    public static void persistCapacitorBasePath(Context context, File directory) {
        SharedPreferences preferences = context.getSharedPreferences(WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE);
        SharedPreferences.Editor editor = preferences.edit();
        if (directory == null) editor.remove(WebView.CAP_SERVER_PATH);
        else editor.putString(WebView.CAP_SERVER_PATH, directory.getAbsolutePath());
        editor.apply();
    }

    public synchronized File bundleDirectory(String version) {
        requireVersion(version);
        return new File(root, version);
    }

    public synchronized File stagingDirectory(String version) {
        requireVersion(version);
        return new File(root, version + ".staging");
    }

    public synchronized String getActiveVersion() {
        return normalizedState(KEY_ACTIVE);
    }

    public synchronized String getPendingVersion() {
        return normalizedState(KEY_PENDING);
    }

    public synchronized String getPreviousVersion() {
        return normalizedState(KEY_PREVIOUS);
    }

    public synchronized void markBundleComplete(String version) throws IOException {
        File directory = bundleDirectory(version);
        if (!directory.isDirectory()) throw new IOException("Bundle directory is missing");
        if (!new File(directory, "index.html").isFile() || !new File(directory, "login.html").isFile()) {
            throw new IOException("Bundle entry files are missing");
        }
        File marker = new File(directory, COMPLETE_MARKER);
        try (FileOutputStream output = new FileOutputStream(marker, false)) {
            output.write(version.getBytes(StandardCharsets.US_ASCII));
            output.getFD().sync();
        }
    }

    public synchronized boolean isBundleComplete(String version) {
        if (!isVersion(version)) return false;
        File directory = bundleDirectory(version);
        return directory.isDirectory()
                && new File(directory, COMPLETE_MARKER).isFile()
                && new File(directory, "index.html").isFile()
                && new File(directory, "login.html").isFile();
    }

    public synchronized void beginPendingActivation(String version) {
        requireVersion(version);
        if (!isBundleComplete(version)) throw new IllegalStateException("Cannot activate incomplete bundle");

        String active = getActiveVersion();
        if (active != null && !active.equals(version) && isBundleComplete(active)) {
            state.put(KEY_PREVIOUS, active);
        } else if (active == null || !isBundleComplete(active)) {
            state.remove(KEY_PREVIOUS);
        }
        state.put(KEY_ACTIVE, version);
        state.put(KEY_PENDING, version);
    }

    public synchronized void markHealthy() {
        String active = getActiveVersion();
        String pending = getPendingVersion();
        if (active == null || pending == null || !active.equals(pending) || !isBundleComplete(active)) {
            throw new IllegalStateException("No complete pending bundle to commit");
        }
        state.remove(KEY_PENDING);
        cleanupOldBundles();
    }

    public synchronized File prepareLaunch() throws IOException {
        String active = getActiveVersion();
        String pending = getPendingVersion();
        String previous = getPreviousVersion();

        if (pending != null) {
            if (previous != null && isBundleComplete(previous)) {
                state.put(KEY_ACTIVE, previous);
                state.remove(KEY_PENDING);
                state.remove(KEY_PREVIOUS);
                return bundleDirectory(previous).getCanonicalFile();
            }
            state.remove(KEY_ACTIVE);
            state.remove(KEY_PENDING);
            state.remove(KEY_PREVIOUS);
            return null;
        }

        if (active != null && isBundleComplete(active)) {
            return bundleDirectory(active).getCanonicalFile();
        }

        if (previous != null && isBundleComplete(previous)) {
            state.put(KEY_ACTIVE, previous);
            state.remove(KEY_PREVIOUS);
            return bundleDirectory(previous).getCanonicalFile();
        }

        state.remove(KEY_ACTIVE);
        state.remove(KEY_PENDING);
        state.remove(KEY_PREVIOUS);
        return null;
    }

    public synchronized File findReusableFile(WebBundleManifest.Entry entry) throws IOException {
        if (entry == null || !WebBundleManifest.isSafeRelativePath(entry.getPath())) return null;
        String[] versions = { getActiveVersion(), getPreviousVersion() };
        Set<String> seen = new HashSet<>();
        for (String version : versions) {
            if (version == null || !seen.add(version) || !isBundleComplete(version)) continue;
            File candidate = resolveInside(bundleDirectory(version), entry.getPath());
            if (WebBundleManifest.verifyFile(candidate, entry)) return candidate.getCanonicalFile();
        }
        return null;
    }

    public synchronized void replaceBundleFromStaging(String version) throws IOException {
        File staging = stagingDirectory(version).getCanonicalFile();
        File destination = bundleDirectory(version).getCanonicalFile();
        if (!staging.isDirectory()) throw new IOException("Staging bundle is missing");
        deleteRecursively(destination);
        if (!staging.renameTo(destination)) throw new IOException("Unable to publish verified web bundle");
    }

    public synchronized void clearStaging(String version) throws IOException {
        deleteRecursively(stagingDirectory(version));
    }

    public static File resolveInside(File directory, String relativePath) throws IOException {
        if (directory == null || !WebBundleManifest.isSafeRelativePath(relativePath)) {
            throw new IOException("Unsafe web bundle path");
        }
        File root = directory.getCanonicalFile();
        File resolved = new File(root, relativePath).getCanonicalFile();
        String prefix = root.getPath() + File.separator;
        if (!resolved.getPath().startsWith(prefix)) throw new IOException("Web bundle path escaped root");
        return resolved;
    }

    public static void deleteRecursively(File file) throws IOException {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("Unable to inspect bundle directory");
            for (File child : children) deleteRecursively(child);
        }
        if (!file.delete() && file.exists()) throw new IOException("Unable to delete " + file.getName());
    }

    private synchronized void cleanupOldBundles() {
        String active = getActiveVersion();
        String previous = getPreviousVersion();
        File[] children = root.listFiles();
        if (children == null) return;
        for (File child : children) {
            String name = child.getName();
            if (name.endsWith(".staging")) continue;
            if (name.equals(active) || name.equals(previous)) continue;
            if (!isVersion(name)) continue;
            try {
                deleteRecursively(child);
            } catch (IOException ignored) {
                // Old verified bundles are cache; failure to prune must not break the active app.
            }
        }
    }

    private String normalizedState(String key) {
        String value = state.get(key);
        if (!isVersion(value)) {
            if (value != null) state.remove(key);
            return null;
        }
        return value;
    }

    private static boolean isVersion(String version) {
        return version != null && VERSION.matcher(version).matches();
    }

    private static void requireVersion(String version) {
        if (!isVersion(version)) throw new IllegalArgumentException("Invalid bundle version");
    }

    private static final class SharedPreferencesState implements StateStore {
        private final SharedPreferences preferences;

        SharedPreferencesState(SharedPreferences preferences) {
            this.preferences = preferences;
        }

        @Override
        public String get(String key) {
            return preferences.getString(key, null);
        }

        @Override
        public void put(String key, String value) {
            preferences.edit().putString(key, value).apply();
        }

        @Override
        public void remove(String key) {
            preferences.edit().remove(key).apply();
        }
    }
}
