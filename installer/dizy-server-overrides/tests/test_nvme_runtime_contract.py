from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        raise AssertionError(f"missing production file: {rel}")
    return path.read_text(encoding="utf-8")


class NvmeRuntimeContractTests(unittest.TestCase):
    def test_builder_stages_self_contained_nvme_runtime(self):
        text = read("scripts/build-iso.sh")
        self.assertIn('command -v nvme', text)
        self.assertIn('nvme-runtime', text)
        self.assertIn('ldd "$NVME_SOURCE"', text)
        self.assertIn('cp -L', text)
        self.assertIn('ld-linux-x86-64.so.2', text)
        self.assertIn('--library-path', text)

    def test_preflight_uses_bundled_runtime_when_system_nvme_is_unusable(self):
        text = read("dizy/preflight.sh")
        self.assertIn('/cdrom/dizy/nvme-runtime', text)
        self.assertIn('Bundled nvme-cli runtime is missing', text)
        self.assertIn('Bundled nvme-cli loader is missing', text)
        self.assertIn('ld-linux-x86-64.so.2', text)
        self.assertIn('--library-path', text)
        self.assertIn('Bundled nvme-cli runtime cannot execute', text)


if __name__ == "__main__":
    unittest.main()
