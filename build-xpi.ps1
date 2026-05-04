$manifest = Get-Content "manifest.json" | ConvertFrom-Json
$name = ($manifest.name -replace '[^a-zA-Z0-9_-]+', '-').ToLower().Trim('-')
$version = $manifest.version
$output = "$name-v$version.xpi"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = (Get-Location).Path

$excludeNames = @(
    ".git",
    ".github",
    ".build-xpi",
    "tests",
    "create-zip.sh",
    "create-zip-bash.sh",
    "build-xpi.ps1"
)

$excludePatterns = @(
    "*.zip",
    "*.xpi",
    "*.DS_Store",
    "*.ndjson"
)

function Should-Skip($item) {
    foreach ($name in $excludeNames) {
        if ($item.Name -eq $name) {
            return $true
        }
    }

    foreach ($pattern in $excludePatterns) {
        if ($item.Name -like $pattern) {
            return $true
        }
    }

    return $false
}

if (Test-Path $output) {
    Remove-Item -LiteralPath $output -Force
}

$zip = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Create)

try {
    Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
        $file = $_

        $segments = $file.FullName.Substring($root.Length).TrimStart('\').Split('\')
        foreach ($segment in $segments) {
            if ($excludeNames -contains $segment) {
                return
            }
        }

        if (Should-Skip $file) {
            return
        }

        $entryName = ($file.FullName.Substring($root.Length).TrimStart('\')) -replace '\\', '/'
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
}
finally {
    $zip.Dispose()
}

Write-Output "Created $output"
