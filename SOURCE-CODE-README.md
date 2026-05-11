# Source Code Package for Mozilla Review

This archive contains the source code used to build the Firefox extension
"Pesquisa Social".

## Extension identity

- Add-on name: Pesquisa Social
- Add-on ID: pesquisa-social@local
- Fork contact: danilo-f.marinho@hotmail.com

## Origin and license

This project is a modified fork of Zeeschuimer.

- Original project: https://github.com/digitalmethodsinitiative/zeeschuimer
- Original copyright: Stijn Peeters
- License for MPL-covered files: Mozilla Public License 2.0

See these files in the source package:

- `LICENSE`
- `FORK-NOTICE.md`

## Build environment

- Operating system used to produce the submitted package: Windows
- Shell used: PowerShell
- Archive/build script: `build-xpi.ps1`
- Required software: PowerShell with .NET support for `System.IO.Compression`

No Node.js bundling, transpilation, or webpack build is required for this
extension package.

## How to reproduce the submitted XPI

1. Extract this source code package.
2. Open PowerShell in the project root.
3. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-xpi.ps1
```

4. The script creates:

```text
pesquisa-social-v1.13.8.xpi
```

## Notes for reviewers

- The package includes third-party assets already present in the repository,
  such as Font Awesome and font files.
- The submitted extension package excludes local data exports and other build
  artifacts such as `.ndjson`, `.xpi`, and `.zip` files.
