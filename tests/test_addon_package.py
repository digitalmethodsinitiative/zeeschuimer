import tempfile
import unittest
import zipfile
from pathlib import Path

from addon_package import package_addon


class PackageAddonTests(unittest.TestCase):
    def test_excludes_node_modules(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            extension_root = Path(temporary_directory, "extension")
            extension_root.mkdir()
            (extension_root / "manifest.json").write_text("{}")
            node_module_file = extension_root / "node_modules" / ".bin" / "inaccessible"
            node_module_file.parent.mkdir(parents=True)
            node_module_file.write_text("ignored")

            archive_path = Path(temporary_directory, "zeeschuimer.xpi")
            package_addon(extension_root, archive_path)

            with zipfile.ZipFile(archive_path) as zipped:
                self.assertEqual(zipped.namelist(), ["manifest.json"])