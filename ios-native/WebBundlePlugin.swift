import Capacitor
import CryptoKit
import Foundation

@objc(WebBundlePlugin)
public final class WebBundlePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WebBundlePlugin"
    public let jsName = "WebBundle"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "syncAndActivate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "markHealthy", returnType: CAPPluginReturnPromise),
    ]

    private let worker = DispatchQueue(label: "com.chat.dizychat.web-bundle")
    private static let schemaVersion = 1
    private static let entryPath = "login.html"
    private static let maxFiles = 32
    private static let maxFileBytes = 8 * 1024 * 1024
    private static let maxTotalBytes = 32 * 1024 * 1024
    private static let maxManifestBytes = 256 * 1024
    private static let activeVersionKey = "dizychat.ios.webbundle.active"
    private static let pendingVersionKey = "dizychat.ios.webbundle.pending"
    private static let manifestFileName = ".dizy-manifest.json"

    private static let requiredCorePaths: Set<String> = [
        "app-config.js",
        "auth-v2-client.js",
        "chat.css",
        "chat.js",
        "embedded-call-view.css",
        "embedded-call-view.js",
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
        "public-auth.css",
    ]

    private struct ManifestEntry: Codable {
        let path: String
        let size: Int
        let sha256: String
    }

    private struct Manifest: Codable {
        let schemaVersion: Int
        let entryPath: String
        let bundleVersion: String
        let files: [ManifestEntry]
    }

    private enum BundleError: LocalizedError {
        case invalidBackend
        case invalidManifest(String)
        case http(Int)
        case redirected
        case oversized
        case verification(String)
        case missingActiveBundle

        var errorDescription: String? {
            switch self {
            case .invalidBackend: return "Web bundle backend must be an HTTPS origin"
            case .invalidManifest(let reason): return "Invalid web bundle manifest: \(reason)"
            case .http(let status): return "Web bundle request returned HTTP \(status)"
            case .redirected: return "Web bundle redirects are not allowed"
            case .oversized: return "Web bundle response exceeded its size limit"
            case .verification(let path): return "Web bundle verification failed: \(path)"
            case .missingActiveBundle: return "No healthy offline web bundle is available"
            }
        }
    }

    @objc public func syncAndActivate(_ call: CAPPluginCall) {
        let backendRaw = call.getString("backendUrl") ?? ""
        worker.async { [weak self] in
            guard let self = self else { return }
            do {
                let backend = try Self.validateBackendOrigin(backendRaw)
                do {
                    let manifest = try self.fetchManifest(backend)
                    let bundle = try self.prepareVerifiedBundle(backend: backend, manifest: manifest)
                    UserDefaults.standard.set(manifest.bundleVersion, forKey: Self.pendingVersionKey)
                    self.activate(call: call, bundle: bundle, version: manifest.bundleVersion)
                } catch {
                    if let fallback = try? self.healthyActiveBundle() {
                        self.activate(call: call, bundle: fallback.url, version: fallback.version)
                    } else {
                        throw error
                    }
                }
            } catch {
                call.reject("Unable to update DizyChat web bundle", nil, error)
            }
        }
    }

    @objc public func markHealthy(_ call: CAPPluginCall) {
        worker.async {
            let defaults = UserDefaults.standard
            let pending = (defaults.string(forKey: Self.pendingVersionKey) ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !pending.isEmpty {
                defaults.set(pending, forKey: Self.activeVersionKey)
                defaults.removeObject(forKey: Self.pendingVersionKey)
                self.removeOldBundles(keeping: pending)
            }
            let active = defaults.string(forKey: Self.activeVersionKey) ?? ""
            call.resolve(["version": active])
        }
    }

    private func activate(call: CAPPluginCall, bundle: URL, version: String) {
        let currentPath = bridge?.config.appLocation.standardizedFileURL.path ?? ""
        let targetPath = bundle.standardizedFileURL.path
        if currentPath == targetPath {
            call.resolve(["version": version, "reloading": false])
            return
        }

        call.resolve(["version": version, "reloading": true])
        DispatchQueue.main.async { [weak self] in
            guard let bridge = self?.bridge else { return }
            bridge.setServerBasePath(targetPath)
            bridge.webView?.load(URLRequest(url: bridge.config.serverURL))
        }
    }

    private func fetchManifest(_ backend: URL) throws -> Manifest {
        let url = try endpoint(backend, path: "/api/mobile-web/manifest")
        let data = try fetch(url, maxBytes: Self.maxManifestBytes)
        let manifest: Manifest
        do {
            manifest = try JSONDecoder().decode(Manifest.self, from: data)
        } catch {
            throw BundleError.invalidManifest("JSON")
        }
        try Self.validateManifest(manifest)
        return manifest
    }

    private func prepareVerifiedBundle(backend: URL, manifest: Manifest) throws -> URL {
        let target = try bundleDirectory(manifest.bundleVersion)
        if Self.bundleMatchesManifest(target, manifest: manifest) {
            return target
        }

        let fm = FileManager.default
        try? fm.removeItem(at: target)
        let staging = target.deletingLastPathComponent()
            .appendingPathComponent(".staging-\(manifest.bundleVersion)-\(UUID().uuidString)", isDirectory: true)
        try? fm.removeItem(at: staging)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)

        do {
            for entry in manifest.files {
                let url = try endpoint(backend, path: "/api/mobile-web/assets/\(entry.path)")
                let data = try fetch(url, maxBytes: min(entry.size, Self.maxFileBytes) + 1)
                guard data.count == entry.size,
                      Self.sha256(data) == entry.sha256 else {
                    throw BundleError.verification(entry.path)
                }

                let destination = try Self.resolveInside(staging, relativePath: entry.path)
                try fm.createDirectory(
                    at: destination.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try data.write(to: destination, options: .atomic)
            }

            guard Self.bundleMatchesManifest(staging, manifest: manifest) else {
                throw BundleError.verification("complete bundle")
            }

            let encoded = try JSONEncoder().encode(manifest)
            try encoded.write(
                to: staging.appendingPathComponent(Self.manifestFileName),
                options: .atomic
            )

            try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fm.moveItem(at: staging, to: target)
            return target
        } catch {
            try? fm.removeItem(at: staging)
            throw error
        }
    }

    private func healthyActiveBundle() throws -> (url: URL, version: String) {
        let version = (UserDefaults.standard.string(forKey: Self.activeVersionKey) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.isSha256(version) else { throw BundleError.missingActiveBundle }
        let directory = try bundleDirectory(version)
        let manifestURL = directory.appendingPathComponent(Self.manifestFileName)
        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(Manifest.self, from: data),
              manifest.bundleVersion == version,
              (try? Self.validateManifest(manifest)) != nil,
              Self.bundleMatchesManifest(directory, manifest: manifest) else {
            throw BundleError.missingActiveBundle
        }
        return (directory, version)
    }

    private func removeOldBundles(keeping version: String) {
        guard let root = try? bundlesRoot(),
              let entries = try? FileManager.default.contentsOfDirectory(
                at: root,
                includingPropertiesForKeys: nil
              ) else { return }
        for entry in entries {
            let name = entry.lastPathComponent
            if name == version || name.hasPrefix(".staging-") { continue }
            try? FileManager.default.removeItem(at: entry)
        }
    }

    private func bundlesRoot() throws -> URL {
        let fm = FileManager.default
        let base = try fm.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let root = base
            .appendingPathComponent("DizyChat", isDirectory: true)
            .appendingPathComponent("WebBundles", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func bundleDirectory(_ version: String) throws -> URL {
        guard Self.isSha256(version) else {
            throw BundleError.invalidManifest("bundleVersion")
        }
        return try bundlesRoot().appendingPathComponent(version, isDirectory: true)
    }

    private func endpoint(_ backend: URL, path: String) throws -> URL {
        guard var parts = URLComponents(url: backend, resolvingAgainstBaseURL: false) else {
            throw BundleError.invalidBackend
        }
        parts.path = path
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else { throw BundleError.invalidBackend }
        return url
    }

    private func fetch(_ url: URL, maxBytes: Int) throws -> Data {
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<Data, Error>?
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 20
        request.setValue("application/json, application/octet-stream;q=0.9, */*;q=0.1", forHTTPHeaderField: "Accept")

        URLSession.shared.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if let error = error {
                result = .failure(error)
                return
            }
            guard let http = response as? HTTPURLResponse else {
                result = .failure(BundleError.http(0))
                return
            }
            guard http.statusCode == 200 else {
                result = .failure(BundleError.http(http.statusCode))
                return
            }
            guard http.url == url else {
                result = .failure(BundleError.redirected)
                return
            }
            let payload = data ?? Data()
            guard payload.count <= maxBytes else {
                result = .failure(BundleError.oversized)
                return
            }
            result = .success(payload)
        }.resume()

        _ = semaphore.wait(timeout: .now() + 25)
        guard let result = result else {
            throw URLError(.timedOut)
        }
        return try result.get()
    }

    private static func validateBackendOrigin(_ raw: String) throws -> URL {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: value),
              parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else {
            throw BundleError.invalidBackend
        }
        parts.path = "/"
        guard let url = parts.url else { throw BundleError.invalidBackend }
        return url
    }

    private static func validateManifest(_ manifest: Manifest) throws {
        guard manifest.schemaVersion == schemaVersion else {
            throw BundleError.invalidManifest("schemaVersion")
        }
        guard manifest.entryPath == entryPath, isSafeRelativePath(manifest.entryPath) else {
            throw BundleError.invalidManifest("entryPath")
        }
        guard isSha256(manifest.bundleVersion) else {
            throw BundleError.invalidManifest("bundleVersion")
        }
        guard !manifest.files.isEmpty, manifest.files.count <= maxFiles else {
            throw BundleError.invalidManifest("file count")
        }

        var seen = Set<String>()
        var total = 0
        for entry in manifest.files {
            guard requiredCorePaths.contains(entry.path),
                  isSafeRelativePath(entry.path),
                  seen.insert(entry.path).inserted else {
                throw BundleError.invalidManifest("file path")
            }
            guard entry.size >= 0, entry.size <= maxFileBytes else {
                throw BundleError.invalidManifest("file size")
            }
            guard isSha256(entry.sha256) else {
                throw BundleError.invalidManifest("file hash")
            }
            total += entry.size
            guard total <= maxTotalBytes else {
                throw BundleError.invalidManifest("total size")
            }
        }
        guard seen == requiredCorePaths else {
            throw BundleError.invalidManifest("core files")
        }
    }

    private static func bundleMatchesManifest(_ directory: URL, manifest: Manifest) -> Bool {
        let fm = FileManager.default
        guard fm.fileExists(atPath: directory.path) else { return false }
        for entry in manifest.files {
            guard let file = try? resolveInside(directory, relativePath: entry.path),
                  let attrs = try? fm.attributesOfItem(atPath: file.path),
                  let size = attrs[.size] as? NSNumber,
                  size.intValue == entry.size,
                  let data = try? Data(contentsOf: file),
                  sha256(data) == entry.sha256 else {
                return false
            }
        }
        return fm.fileExists(atPath: directory.appendingPathComponent(entryPath).path)
            && fm.fileExists(atPath: directory.appendingPathComponent("index.html").path)
    }

    private static func resolveInside(_ root: URL, relativePath: String) throws -> URL {
        guard isSafeRelativePath(relativePath) else {
            throw BundleError.invalidManifest("unsafe path")
        }
        let rootPath = root.standardizedFileURL.path
        let resolved = root.appendingPathComponent(relativePath).standardizedFileURL
        let resolvedPath = resolved.path
        guard resolvedPath.hasPrefix(rootPath + "/") else {
            throw BundleError.invalidManifest("path traversal")
        }
        return resolved
    }

    private static func isSafeRelativePath(_ value: String) -> Bool {
        if value.isEmpty || value.hasPrefix("/") || value.contains("\\") { return false }
        guard value.range(
            of: "^[A-Za-z0-9._%\\-/]+$",
            options: .regularExpression
        ) != nil else { return false }
        guard let decoded = value.removingPercentEncoding,
              !decoded.isEmpty,
              !decoded.hasPrefix("/"),
              !decoded.contains("\\"),
              decoded.range(
                of: "^[A-Za-z0-9._\\-/]+$",
                options: .regularExpression
              ) != nil else { return false }
        for part in decoded.split(separator: "/", omittingEmptySubsequences: false) {
            if part.isEmpty || part == "." || part == ".." { return false }
        }
        return true
    }

    private static func isSha256(_ value: String) -> Bool {
        value.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
