package com.chat.dizychat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

@CapacitorPlugin(name = "WebBundle")
public class WebBundlePlugin extends Plugin {
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 20_000;
    private static final int MAX_MANIFEST_BYTES = 256 * 1024;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void syncAndActivate(PluginCall call) {
        final String backendUrl = call.getString("backendUrl", "");
        executor.execute(() -> {
            String stagingVersion = null;
            try {
                URL backend = validateBackendOrigin(backendUrl);
                WebBundleStore store = WebBundleStore.fromContext(getContext());
                WebBundleManifest manifest = fetchManifest(backend);
                stagingVersion = manifest.getBundleVersion();

                File bundle = store.bundleDirectory(stagingVersion);
                if (!bundleMatchesManifest(bundle, manifest)) {
                    downloadVerifiedBundle(store, backend, manifest);
                    bundle = store.bundleDirectory(stagingVersion);
                    if (!bundleMatchesManifest(bundle, manifest)) {
                        throw new IOException("Published web bundle failed verification");
                    }
                }

                String activeVersion = store.getActiveVersion();
                if (!stagingVersion.equals(activeVersion)) {
                    store.beginPendingActivation(stagingVersion);
                }

                WebBundleStore.persistCapacitorBasePath(getContext(), bundle);
                activateIfNeeded(call, bundle, stagingVersion);
            } catch (Exception error) {
                if (stagingVersion != null) {
                    try {
                        WebBundleStore.fromContext(getContext()).clearStaging(stagingVersion);
                    } catch (Exception ignored) {
                        // Best-effort cleanup only; verified active bundle state is untouched.
                    }
                }
                call.reject("Unable to update DizyChat web bundle", error);
            }
        });
    }

    @PluginMethod
    public void markHealthy(PluginCall call) {
        executor.execute(() -> {
            try {
                WebBundleStore store = WebBundleStore.fromContext(getContext());
                String pending = store.getPendingVersion();
                if (pending != null) store.markHealthy();
                String active = store.getActiveVersion();
                File directory = active == null ? null : store.bundleDirectory(active);
                WebBundleStore.persistCapacitorBasePath(getContext(), directory);
                JSObject result = new JSObject();
                result.put("version", active == null ? JSONObject.NULL : active);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Unable to commit DizyChat web bundle health", error);
            }
        });
    }

    private void activateIfNeeded(PluginCall call, File bundle, String version) throws IOException {
        File target = bundle.getCanonicalFile();
        String currentPath = getBridge() == null ? null : getBridge().getServerBasePath();
        boolean alreadyServing = false;
        if (currentPath != null && !currentPath.isEmpty()) {
            try {
                alreadyServing = new File(currentPath).getCanonicalFile().equals(target);
            } catch (IOException ignored) {
                alreadyServing = false;
            }
        }

        JSObject result = new JSObject();
        result.put("version", version);
        result.put("reloading", !alreadyServing);
        if (alreadyServing) {
            call.resolve(result);
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                call.resolve(result);
                getBridge().setServerBasePath(target.getAbsolutePath());
            } catch (RuntimeException error) {
                call.reject("Unable to activate DizyChat web bundle", error);
            }
        });
    }

    private static WebBundleManifest fetchManifest(URL backend) throws Exception {
        URL url = new URL(backend, "/api/mobile-web/manifest");
        HttpsURLConnection connection = openHttps(url);
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new IOException("Web bundle manifest returned HTTP " + status);
            byte[] bytes = readBounded(connection.getInputStream(), MAX_MANIFEST_BYTES);
            JSONObject json = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            return WebBundleManifest.fromJson(json);
        } finally {
            connection.disconnect();
        }
    }

    private static void downloadVerifiedBundle(WebBundleStore store, URL backend, WebBundleManifest manifest) throws Exception {
        String version = manifest.getBundleVersion();
        store.clearStaging(version);
        File staging = store.stagingDirectory(version);
        if (!staging.mkdirs() && !staging.isDirectory()) throw new IOException("Unable to create web bundle staging directory");

        try {
            for (WebBundleManifest.Entry entry : manifest.getFiles()) {
                File destination = WebBundleStore.resolveInside(staging, entry.getPath());
                File parent = destination.getParentFile();
                if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
                    throw new IOException("Unable to create web bundle directory");
                }

                File reusable = store.findReusableFile(entry);
                if (reusable != null) copyFile(reusable, destination, entry.getSize());
                else downloadFile(backend, entry, destination);

                if (!WebBundleManifest.verifyFile(destination, entry)) {
                    throw new IOException("Web bundle file verification failed: " + entry.getPath());
                }
            }

            if (!new File(staging, manifest.getEntryPath()).isFile() || !new File(staging, "index.html").isFile()) {
                throw new IOException("Verified web bundle is missing entry files");
            }

            store.replaceBundleFromStaging(version);
            store.markBundleComplete(version);
        } catch (Exception error) {
            try {
                store.clearStaging(version);
            } catch (IOException ignored) {
                // Keep the original verification/download failure.
            }
            throw error;
        }
    }

    private static void downloadFile(URL backend, WebBundleManifest.Entry entry, File destination) throws Exception {
        URL url = new URL(backend, "/api/mobile-web/assets/" + entry.getPath());
        HttpsURLConnection connection = openHttps(url);
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new IOException("Web bundle asset returned HTTP " + status);
            long declaredLength = connection.getContentLengthLong();
            if (declaredLength >= 0L && declaredLength != entry.getSize()) {
                throw new IOException("Web bundle asset length mismatch");
            }
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destination, false)) {
                copyBounded(input, output, entry.getSize());
                output.getFD().sync();
            }
        } finally {
            connection.disconnect();
        }
    }

    private static void copyFile(File source, File destination, long expectedBytes) throws IOException {
        try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(destination, false)) {
            copyBounded(input, output, expectedBytes);
            output.getFD().sync();
        }
    }

    private static void copyBounded(InputStream input, FileOutputStream output, long expectedBytes) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        long total = 0L;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > expectedBytes || total > WebBundleManifest.MAX_FILE_BYTES) {
                throw new IOException("Web bundle asset exceeded expected size");
            }
            output.write(buffer, 0, count);
        }
        if (total != expectedBytes) throw new IOException("Web bundle asset size mismatch");
    }

    private static byte[] readBounded(InputStream input, int maxBytes) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int count;
            while ((count = stream.read(buffer)) != -1) {
                total += count;
                if (total > maxBytes) throw new IOException("Web bundle manifest is too large");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private static HttpsURLConnection openHttps(URL url) throws IOException {
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IOException("Web bundle transport must use HTTPS");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json, application/octet-stream;q=0.9, */*;q=0.1");
        return connection;
    }

    private static URL validateBackendOrigin(String value) throws Exception {
        URL parsed = new URL(value == null ? "" : value.trim());
        if (!"https".equalsIgnoreCase(parsed.getProtocol())) throw new IOException("Web bundle backend must use HTTPS");
        if (parsed.getHost() == null || parsed.getHost().isEmpty()) throw new IOException("Web bundle backend host is missing");
        if (parsed.getUserInfo() != null || parsed.getQuery() != null || parsed.getRef() != null) {
            throw new IOException("Web bundle backend must be an origin");
        }
        String path = parsed.getPath();
        if (path != null && !path.isEmpty() && !"/".equals(path)) throw new IOException("Web bundle backend must be an origin");
        return new URL("https", parsed.getHost(), parsed.getPort(), "/");
    }

    private static boolean bundleMatchesManifest(File directory, WebBundleManifest manifest) {
        if (directory == null || manifest == null || !directory.isDirectory()) return false;
        for (WebBundleManifest.Entry entry : manifest.getFiles()) {
            try {
                File file = WebBundleStore.resolveInside(directory, entry.getPath());
                if (!WebBundleManifest.verifyFile(file, entry)) return false;
            } catch (IOException error) {
                return false;
            }
        }
        return true;
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
