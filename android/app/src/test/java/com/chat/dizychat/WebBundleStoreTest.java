package com.chat.dizychat;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class WebBundleStoreTest {
    @Rule
    public TemporaryFolder temporaryFolder = new TemporaryFolder();

    private static final String V1 = "1".repeat(64);
    private static final String V2 = "2".repeat(64);

    private static final class MemoryState implements WebBundleStore.StateStore {
        private final Map<String, String> values = new HashMap<>();

        @Override
        public String get(String key) {
            return values.get(key);
        }

        @Override
        public void put(String key, String value) {
            if (value == null || value.isEmpty()) values.remove(key);
            else values.put(key, value);
        }

        @Override
        public void remove(String key) {
            values.remove(key);
        }
    }

    private WebBundleStore newStore(MemoryState state) throws Exception {
        return new WebBundleStore(temporaryFolder.newFolder("web-bundles"), state);
    }

    private static void createCompleteBundle(WebBundleStore store, String version) throws Exception {
        File dir = store.bundleDirectory(version);
        assertTrue(dir.mkdirs() || dir.isDirectory());
        for (String required : new String[] { "index.html", "login.html" }) {
            File file = new File(dir, required);
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(required.getBytes(StandardCharsets.UTF_8));
            }
        }
        store.markBundleComplete(version);
    }

    @Test
    public void firstHealthyBundleBecomesActive() throws Exception {
        MemoryState state = new MemoryState();
        WebBundleStore store = newStore(state);
        createCompleteBundle(store, V1);

        store.beginPendingActivation(V1);
        assertEquals(V1, store.getActiveVersion());
        assertEquals(V1, store.getPendingVersion());
        assertNull(store.getPreviousVersion());

        store.markHealthy();
        assertEquals(V1, store.getActiveVersion());
        assertNull(store.getPendingVersion());
        assertEquals(store.bundleDirectory(V1).getCanonicalFile(), store.prepareLaunch().getCanonicalFile());
    }

    @Test
    public void uncommittedPendingBundleRollsBackToPreviousVerifiedBundle() throws Exception {
        MemoryState state = new MemoryState();
        WebBundleStore store = newStore(state);
        createCompleteBundle(store, V1);
        createCompleteBundle(store, V2);

        store.beginPendingActivation(V1);
        store.markHealthy();
        store.beginPendingActivation(V2);
        assertEquals(V2, store.getActiveVersion());
        assertEquals(V1, store.getPreviousVersion());
        assertEquals(V2, store.getPendingVersion());

        File launch = store.prepareLaunch();
        assertEquals(store.bundleDirectory(V1).getCanonicalFile(), launch.getCanonicalFile());
        assertEquals(V1, store.getActiveVersion());
        assertNull(store.getPendingVersion());
    }

    @Test
    public void healthySecondBundleSurvivesNextLaunchAndRetainsRollbackCandidate() throws Exception {
        MemoryState state = new MemoryState();
        WebBundleStore store = newStore(state);
        createCompleteBundle(store, V1);
        createCompleteBundle(store, V2);

        store.beginPendingActivation(V1);
        store.markHealthy();
        store.beginPendingActivation(V2);
        store.markHealthy();

        File launch = store.prepareLaunch();
        assertEquals(store.bundleDirectory(V2).getCanonicalFile(), launch.getCanonicalFile());
        assertEquals(V2, store.getActiveVersion());
        assertEquals(V1, store.getPreviousVersion());
        assertNull(store.getPendingVersion());
    }

    @Test
    public void missingActiveBundleFallsBackToPackagedShell() throws Exception {
        MemoryState state = new MemoryState();
        WebBundleStore store = newStore(state);
        createCompleteBundle(store, V1);
        store.beginPendingActivation(V1);
        store.markHealthy();
        assertTrue(store.bundleDirectory(V1).delete() || !store.bundleDirectory(V1).exists());

        assertNull(store.prepareLaunch());
        assertNull(store.getActiveVersion());
        assertNull(store.getPendingVersion());
    }

    @Test
    public void unchangedVerifiedFileCanBeReusedButTamperedFileCannot() throws Exception {
        MemoryState state = new MemoryState();
        WebBundleStore store = newStore(state);
        createCompleteBundle(store, V1);
        File file = new File(store.bundleDirectory(V1), "chat.js");
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write("same-file".getBytes(StandardCharsets.UTF_8));
        }
        store.beginPendingActivation(V1);
        store.markHealthy();

        String hash = WebBundleManifest.sha256Hex(file);
        WebBundleManifest.Entry entry = new WebBundleManifest.Entry("chat.js", file.length(), hash);
        assertEquals(file.getCanonicalFile(), store.findReusableFile(entry).getCanonicalFile());

        try (FileOutputStream output = new FileOutputStream(file, true)) {
            output.write("tamper".getBytes(StandardCharsets.UTF_8));
        }
        assertNull(store.findReusableFile(entry));
    }
}
