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

    def test_preflight_copies_bundled_runtime_off_cdrom_before_execution(self):
        text = read("dizy/preflight.sh")
        self.assertIn('runtime_source=/cdrom/dizy/nvme-runtime', text)
        self.assertIn('runtime=/run/dizy-nvme-runtime', text)
        self.assertIn('cp -a "$runtime_source/." "$runtime/"', text)
        copy_pos = text.index('cp -a "$runtime_source/." "$runtime/"')
        exec_pos = text.index('exec "$runtime/ld-linux-x86-64.so.2"')
        self.assertLess(copy_pos, exec_pos)


if __name__ == "__main__":
    unittest.main()
