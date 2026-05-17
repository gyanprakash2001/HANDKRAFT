$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dirs = @('node_modules','mobile','server','Admin','android','.git','client','docs','.github')
foreach($d in $dirs) {
  $p = Join-Path $repoRoot $d
  if(Test-Path $p) {
    $size = (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $mb = [math]::Round($size/1MB,1)
    Write-Host "$d : $mb MB"
  }
}
$apks = Get-ChildItem (Join-Path $repoRoot '*.apk') -ErrorAction SilentlyContinue
foreach($f in $apks) {
  $mb = [math]::Round($f.Length/1MB,1)
  Write-Host "$($f.Name) : $mb MB"
}
