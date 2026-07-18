Set-Location $PSScriptRoot
Start-Process "http://localhost:8080"
if (Get-Command py -ErrorAction SilentlyContinue) { py -m http.server 8080 } else { python -m http.server 8080 }
