$manifest = Get-Content "manifest.json" | ConvertFrom-Json
$name = ($manifest.name -replace '[^a-zA-Z0-9_-]+', '-').ToLower().Trim('-')
$version = $manifest.version
$output = "$name-v$version.xpi"
$zipOutput = "$name-v$version.zip"
$staging = Join-Path $PWD ".build-xpi"

if (Test-Path $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}

New-Item -ItemType Directory -Path $staging | Out-Null

$exclude = @(
    ".git",
    ".build-xpi",
    "tests",
    "*.zip",
    "*.xpi",
    "*.DS_Store",
    "__MACOSX",
    "create-zip.sh",
    "create-zip-bash.sh",
    "build-xpi.ps1"
)

Get-ChildItem -Force | Where-Object {
    $item = $_
    -not ($exclude | Where-Object {
        if ($_ -like "*`**" -or $_ -like "*?*") {
            $item.Name -like $_
        } else {
            $item.Name -eq $_
        }
    })
} | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $staging -Recurse -Force
}

if (Test-Path $output) {
    Remove-Item -LiteralPath $output -Force
}

if (Test-Path $zipOutput) {
    Remove-Item -LiteralPath $zipOutput -Force
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipOutput -Force
Move-Item -LiteralPath $zipOutput -Destination $output -Force
Remove-Item -LiteralPath $staging -Recurse -Force

Write-Output "Created $output"
