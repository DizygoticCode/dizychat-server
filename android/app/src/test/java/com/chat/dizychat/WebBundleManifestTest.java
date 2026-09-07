package com.chat.dizychat;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class WebBundleManifestTest {
    private static final String VERSION = "a".repeat(64);

    private static List<WebBundleManifest.Entry> validEntries() {
        List<WebBundleManifest.Entry> entries = new ArrayList<>();
        for (String path : WebBundleManifest.REQUIRED_CORE_PATHS) {
            entries.add(new WebBundleManifest.Entry(path, 10L, "b".repeat(64)));
        }
        return entries;
    }

    @Test
    public void acceptsOnlySchemaOneCompleteSafeCoreManifest() {
        WebBundleManifest manifest = new WebBundleManifest(1, "login.html", VERSION, validEntries());
        assertEquals(1, manifest.getSchemaVersion());
        assertEquals("login.html", manifest.getEntryPath());
        assertEquals(VERSION, manifest.getBundleVersion());
        assertEquals(WebBundleManifest.REQUIRED_CORE_PATHS.size(), manifest.getFiles().size());
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsTraversalPath() {
        List<WebBundleManifest.Entry> entries = validEntries();
        entries.set(0, new WebBundleManifest.Entry("nested/../secret.js", 10L, "b".repeat(64)));
        new WebBundleManifest(1, "login.html", VERSION, entries);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsDuplicatePaths() {
        List<WebBundleManifest.Entry> entries = validEntries();
        entries.add(entries.get(0));
        new WebBundleManifest(1, "login.html", VERSION, entries);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsMissingRequiredCoreFile() {
        List<WebBundleManifest.Entry> entries = validEntries();
        entries.remove(0);
        new WebBundleManifest(1, "login.html", VERSION, entries);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsOversizeBundle() {
        List<WebBundleManifest.Entry> entries = validEntries();
        entries.set(0, new WebBundleManifest.Entry(entries.get(0).getPath(), WebBundleManifest.MAX_FILE_BYTES + 1L, "b".repeat(64)));
        new WebBundleManifest(1, "login.html", VERSION, entries);
    }

    @Test
    public void pathGuardRejectsEncodedAndAbsoluteTraversal() {
        assertTrue(WebBundleManifest.isSafeRelativePath("mobile-runtime.js"));
        assertTrue(WebBundleManifest.isSafeRelativePath("nested/file.css"));
        for (String unsafe : new String[] {
                "", "/login.html", "../secret", "nested/../secret", "nested\\file.js",
                "%2e%2e/secret", "nested/%2e%2e/secret", "https://evil.example/x.js"}) {
            assertFalse(unsafe, WebBundleManifest.isSafeRelativePath(unsafe));
        }
    }

    @Test
    public void sha256VerificationDetectsTampering() throws Exception {
        File file = File.createTempFile("dizychat-bundle", ".js");
        file.deleteOnExit();
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write("verified".getBytes(StandardCharsets.UTF_8));
        }
        String hash = WebBundleManifest.sha256Hex(file);
        WebBundleManifest.Entry entry = new WebBundleManifest.Entry("chat.js", file.length(), hash);
        assertTrue(WebBundleManifest.verifyFile(file, entry));

        try (FileOutputStream output = new FileOutputStream(file, true)) {
            output.write("tampered".getBytes(StandardCharsets.UTF_8));
        }
        assertFalse(WebBundleManifest.verifyFile(file, entry));
        assertNotEquals(hash, WebBundleManifest.sha256Hex(file));
    }
}
