import os
import zipfile
from pathlib import Path


EXCLUDED_ADDON_DIRECTORIES = {".git", "node_modules", "tests", "__pycache__"}


def package_addon(extension_root, archive_path):
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zipped:
        for current_root, directory_names, file_names in os.walk(extension_root):
            directory_names[:] = [
                directory_name
                for directory_name in directory_names
                if directory_name not in EXCLUDED_ADDON_DIRECTORIES
            ]

            for file_name in file_names:
                file_path = Path(current_root, file_name)
                zipped.write(file_path, file_path.relative_to(extension_root))