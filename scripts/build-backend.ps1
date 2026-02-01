# Build script for compiling the Python backend with Nuitka (Windows)
# This script compiles main.py into a standalone binary

$ErrorActionPreference = "Stop"

Write-Host "Building Python backend with Nuitka..." -ForegroundColor Green

# Get the project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

Set-Location $ProjectRoot

$Platform = "win"
$OutputDir = Join-Path $ProjectRoot "backend-dist" $Platform
$BinaryName = "backend.exe"

Write-Host "Platform: $Platform" -ForegroundColor Yellow
Write-Host "Output directory: $OutputDir" -ForegroundColor Yellow

# Create output directory
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

Write-Host "Running Nuitka..." -ForegroundColor Green

# Run Nuitka via uv
uv run python -m nuitka `
    --standalone `
    --onefile `
    --output-filename="$BinaryName" `
    --output-dir="$OutputDir" `
    `
    --include-package=backend `
    --include-package=zynk `
    --include-package=agno_toolset `
    `
    --include-package=fastapi `
    --include-package=uvicorn `
    --include-package=starlette `
    --include-package=pydantic `
    --include-package=pydantic_core `
    --include-package=sqlalchemy `
    --include-package=litellm `
    --include-package=httpx `
    --include-package=anyio `
    --include-package=mcp `
    --include-package=agno `
    --include-package=rich `
    --include-package=cryptography `
    --include-package=dotenv `
    --include-package=duckduckgo_search `
    --include-package=requests `
    `
    --include-data-dir=zynk/zynk=zynk `
    --include-data-dir=agno-toolset/src/agno_toolset=agno_toolset `
    `
    --follow-imports `
    --assume-yes-for-downloads `
    `
    --disable-console `
    `
    main.py

$BinaryPath = Join-Path $OutputDir $BinaryName

if (Test-Path $BinaryPath) {
    Write-Host "Build successful!" -ForegroundColor Green
    Write-Host "Binary location: $BinaryPath" -ForegroundColor Green
    
    $Size = (Get-Item $BinaryPath).Length / 1MB
    Write-Host "Binary size: $([math]::Round($Size, 2)) MB" -ForegroundColor Green
} else {
    Write-Host "Build failed! Binary not found." -ForegroundColor Red
    exit 1
}

Write-Host "Done!" -ForegroundColor Green
