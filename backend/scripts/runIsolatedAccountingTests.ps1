param(
  [string]$TestFile
)

$ErrorActionPreference = "Stop"
$backendDirectory = Split-Path -Parent $PSScriptRoot
Push-Location $backendDirectory

try {
  if ($env:RUN_DATABASE_INTEGRATION_TESTS -ne "1") {
    throw "Set RUN_DATABASE_INTEGRATION_TESTS=1 only after independently verifying the isolated MySQL target."
  }

  & node .\scripts\assertDatabaseToolTarget.js integration
  if ($LASTEXITCODE -ne 0) {
    throw "Integration database target validation failed; no tests were started."
  }

  if ([string]::IsNullOrWhiteSpace($TestFile)) {
    & npm test
  } else {
    & node --test $TestFile
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Accounting test run failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
