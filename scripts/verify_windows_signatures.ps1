param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$files = @(Get-ChildItem -LiteralPath $Path -Recurse -File | Where-Object { $_.Extension -in '.exe', '.msi' })
if ($files.Count -eq 0) { throw 'No Windows executables or installers found for signature verification.' }
foreach ($file in $files) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
        throw "Invalid or untrusted Authenticode signature: $($file.Name). Publication stopped."
    }
    if ($null -eq $signature.TimeStamperCertificate) {
        throw "Missing trusted timestamp: $($file.Name). Publication stopped."
    }
    Write-Output "Verified signed and timestamped file: $($file.Name)"
}
