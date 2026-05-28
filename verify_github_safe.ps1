$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path $PSScriptRoot).Path
$issues = New-Object System.Collections.Generic.List[string]

$vendorAllowlist = @(
  'crm/static/react.production.min.js',
  'crm/static/react-dom.production.min.js',
  'crm/static/babel.min.js',
  'crm/static/jspdf.umd.min.js',
  'crm/static/leaflet.js',
  'crm/static/leaflet.css'
)

$textExtensions = @(
  '.py', '.js', '.html', '.css', '.md', '.txt', '.json', '.ps1',
  '.env', '.yml', '.yaml', '.ini', '.cfg', '.toml', '.svg'
)

function Get-RelativePath([string]$fullPath) {
  $relative = $fullPath.Substring($repoRoot.Length).TrimStart('\')
  return $relative -replace '\\', '/'
}

function Is-RepoScanPath([string]$fullPath) {
  return $fullPath -notmatch '\\(\.git|__pycache__|\.pytest_cache|\.venv|venv|node_modules|dist|build)(\\|$)'
}

function Add-Issue([string]$message) {
  $issues.Add($message) | Out-Null
}

function Is-AllowlistedVendor([string]$relativePath) {
  return $vendorAllowlist -contains $relativePath
}

function Get-TextFiles {
  Get-ChildItem -Path $repoRoot -Recurse -File |
    Where-Object { Is-RepoScanPath $_.FullName } |
    Where-Object {
      $relative = Get-RelativePath $_.FullName
      $extension = [System.IO.Path]::GetExtension($_.Name).ToLowerInvariant()
      ($textExtensions -contains $extension -or $_.Name -eq '.env.example') -and
      $relative -ne 'verify_github_safe.ps1'
    }
}

function Test-DisallowedFiles {
  $filePatterns = @(
    @{ Pattern = '(^|/)\.env$'; Label = '.env file' },
    @{ Pattern = '(^|/).+\.env$'; Label = '.env file' },
    @{ Pattern = '\.(db|sqlite|sqlite3|db-wal|db-shm)$'; Label = 'database file' },
    @{ Pattern = '(^|/)(credentials|token)\.json$'; Label = 'credential token file' },
    @{ Pattern = '(^|/)client_secret[^/]*\.json$'; Label = 'client secret file' },
    @{ Pattern = '(^|/)google_credentials[^/]*\.json$'; Label = 'google credentials file' },
    @{ Pattern = '\.(pem|key|crt)$'; Label = 'certificate or key file' }
  )

  Get-ChildItem -Path $repoRoot -Recurse -File |
    Where-Object { Is-RepoScanPath $_.FullName } |
    ForEach-Object {
      $relative = Get-RelativePath $_.FullName
      if ($relative -eq 'crm/config/.env.example') {
        return
      }
      foreach ($rule in $filePatterns) {
        if ($relative -match $rule.Pattern) {
          Add-Issue("$($rule.Label): $relative")
          break
        }
      }
    }
}

function Test-HardcodedSecrets {
  $envValueAllowlist = @{
    'SECRET_KEY' = @('replace-with-generated-secret')
    'CRM_PASSWORD_HASH' = @('replace-with-werkzeug-password-hash')
    'GOOGLE_CLIENT_ID' = @('replace-me')
    'GOOGLE_CLIENT_SECRET' = @('replace-me')
    'HOME_BASE_ADDRESS' = @('replace-with-home-base-address')
    'WORKER_PICKUP_ADDRESS' = @('replace-with-worker-pickup-address')
  }

  foreach ($file in Get-TextFiles) {
    $relative = Get-RelativePath $file.FullName
    $lines = Get-Content -Path $file.FullName
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $line = $lines[$i]

      foreach ($key in $envValueAllowlist.Keys) {
        if ($line -match "^\s*$key=(.+)$") {
          $value = $Matches[1].Trim()
          if ($envValueAllowlist[$key] -notcontains $value) {
            Add-Issue("Non-placeholder $key in ${relative}:$($i + 1)")
          }
        } elseif ($line -match "(?i)\b$key\b\s*[:=]\s*['""]([^'""]+)['""]") {
          $value = $Matches[1].Trim()
          if ($envValueAllowlist[$key] -notcontains $value) {
            Add-Issue("Quoted non-placeholder $key in ${relative}:$($i + 1)")
          }
        }
      }

      if ($line -match "(?i)\b(refresh_token|access_token)\b\s*[:=]\s*['""]([^'""]+)['""]") {
        $value = $Matches[2].Trim()
        if ($value -and $value -notmatch '^(replace-me|placeholder|demo|test)$') {
          Add-Issue("Quoted token-like value in ${relative}:$($i + 1)")
        }
      }
    }
  }
}

function Test-BrandingAndLiveRefs {
  $patternTable = @(
    @{ Pattern = '(?i)clear\s*choice'; Label = 'old company branding' },
    @{ Pattern = '(?i)clearchoice'; Label = 'old compact branding' },
    @{ Pattern = '(?i)clearchoiceservices|clear-choice-services'; Label = 'old domain or namespace' },
    @{ Pattern = '(?i)anthony|tony de luca|de luca'; Label = 'old staff naming' },
    @{ Pattern = '(?i)\(414\)\s*436-1364|414-436-1364|\+14144361364|4144361364'; Label = 'old phone number' },
    @{ Pattern = '(?i)(^|[^a-z])uploads/|(^|[^a-z])/uploads/'; Label = 'live upload reference' },
    @{ Pattern = '(?i)(^|[^a-z])images-50/|(^|[^a-z])/images-50/'; Label = 'live media reference' }
  )

  foreach ($file in Get-TextFiles) {
    $relative = Get-RelativePath $file.FullName
    if (Is-AllowlistedVendor $relative) {
      continue
    }
    $lines = Get-Content -Path $file.FullName
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $line = $lines[$i]
      foreach ($rule in $patternTable) {
        if ($line -match $rule.Pattern) {
          Add-Issue("$($rule.Label) in ${relative}:$($i + 1)")
          break
        }
      }
    }
  }
}

function Test-SuspiciousCustomerData {
  foreach ($file in Get-TextFiles) {
    $relative = Get-RelativePath $file.FullName
    if (Is-AllowlistedVendor $relative) {
      continue
    }
    $lines = Get-Content -Path $file.FullName
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $line = $lines[$i]

      $emailMatches = [regex]::Matches($line, '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b')
      foreach ($emailMatch in $emailMatches) {
        $emailValue = $emailMatch.Value.ToLowerInvariant()
        if ($emailValue -notmatch '@example\.invalid$' -and
            $emailValue -notmatch '@example\.com$' -and
            $emailValue -notmatch '@localhost$') {
          Add-Issue("Unexpected email literal $emailValue in ${relative}:$($i + 1)")
        }
      }

      $phoneMatches = [regex]::Matches($line, '(?<!\d)(?:\+1\d{10}|\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4})(?!\d)')
      foreach ($phoneMatch in $phoneMatches) {
        $phoneValue = $phoneMatch.Value
        if ($phoneValue -notmatch '^\+1555010000\d$' -and
            $phoneValue -notmatch '^\(555\)\s*010-000\d$' -and
            $phoneValue -notmatch '^555-010-000\d$') {
          Add-Issue("Unexpected phone literal $phoneValue in ${relative}:$($i + 1)")
        }
      }

      if ($line -match '\b\d{1,5}\s+[A-Za-z0-9.\- ]+\s(?:St|Street|Rd|Road|Ave|Avenue|Ln|Lane|Blvd|Boulevard|Dr|Drive|Way|Terrace|Pl|Place)\b' -and
          $line -notmatch '(?i)demo|placeholder|replace-with|00000') {
        Add-Issue("Unexpected address-like literal in ${relative}:$($i + 1)")
      }
    }
  }
}

Test-DisallowedFiles
Test-HardcodedSecrets
Test-BrandingAndLiveRefs
Test-SuspiciousCustomerData

if ($issues.Count -gt 0) {
  Write-Host 'github_safe verification failed:' -ForegroundColor Red
  $issues | Sort-Object -Unique | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

Write-Host 'github_safe verification passed.' -ForegroundColor Green
