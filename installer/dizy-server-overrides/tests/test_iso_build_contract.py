from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        raise AssertionError(f"missing production file: {rel}")
    return path.read_text(encoding="utf-8")


class IsoBuildContractTests(unittest.TestCase):
    def test_builder_verifies_official_ubuntu_24044_before_remastering(self):
        text = read("scripts/build-iso.sh")
        self.assertIn('UBUNTU_VERSION="24.04.4"', text)
        self.assertIn('BASE_NAME="ubuntu-${UBUNTU_VERSION}-live-server-amd64.iso"', text)
        self.assertIn("https://releases.ubuntu.com/24.04", text)
        self.assertIn("SHA256SUMS", text)
        self.assertIn('awk -v name="$BASE_NAME"', text)
        self.assertIn('$2 == "*" name || $2 == name', text)
        self.assertIn("sha256sum -c", text)

    def test_builder_preserves_original_boot_images_and_maps_dizy_payload(self):
        text = read("scripts/build-iso.sh")
        self.assertIn("-boot_image any replay", text)
        self.assertIn('/dizy', text)
        self.assertIn('/boot/grub/grub.cfg', text)
        self.assertIn('/md5sum.txt', text)

    def test_iso_verifier_checks_roles_boot_catalog_and_8gb_fit(self):
        text = read("tests/verify_iso.sh")
        self.assertIn("for role in inspect trades chat both plain", text)
        self.assertIn('grep -Fq "dizy.role=$role"', text)
        self.assertIn("report_el_torito", text)
        self.assertIn("7500000000", text)
        self.assertIn("/dizy/SHA256SUMS", text)

    def test_actions_workflow_runs_tests_builds_verifies_and_uploads_iso(self):
        text = read(".github/workflows/build-dizy-server-installer.yml")
        self.assertIn("python3 -m unittest discover", text)
        self.assertIn("build-iso.sh", text)
        self.assertIn("verify_iso.sh", text)
        self.assertIn("actions/upload-artifact@", text)
        self.assertIn("compression-level: 0", text)


if __name__ == "__main__":
    unittest.main()
