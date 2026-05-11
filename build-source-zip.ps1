Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$output = "pesquisa-social-source-v1.13.8.zip"
$root = (Get-Location).Path

$includePaths = @(
    "manifest.json",
    "popup",
    "js",
    "modules",
    "images",
    "fonts",
    "inc",
    "LICENSE",
    "README.md",
    "FORK-NOTICE.md",
    "SOURCE-CODE-README.md",
    "build-xpi.ps1"
)

if (Test-Path $output) {
    Remove-Item -LiteralPath $output -Force
}

$zip = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Create)

try {
    foreach ($path in $includePaths) {
        $fullPath = Join-Path $root $path

        if (Test-Path $fullPath -PathType Leaf) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip,
                $fullPath,
                ($path -replace '\\', '/'),
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
            continue
        }

        if (Test-Path $fullPath -PathType Container) {
            Get-ChildItem -LiteralPath $fullPath -Recurse -File | ForEach-Object {
                $entryName = $_.FullName.Substring($root.Length).TrimStart('\') -replace '\\', '/'
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $zip,
                    $_.FullName,
                    $entryName,
                    [System.IO.Compression.CompressionLevel]::Optimal
                ) | Out-Null
            }
        }
    }
}
finally {
    $zip.Dispose()
}

Write-Output "Created $output"
