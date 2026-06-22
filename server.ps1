$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$port = if ($env:PORT) { [int]$env:PORT } else { 4173 }
$server = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)

$contentTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".svg"  = "image/svg+xml; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
}

try {
    $server.Start()
    Write-Host "KaraOki running at http://127.0.0.1:$port"
    Write-Host "Press Ctrl+C to stop."

    while ($true) {
        $client = $server.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            while (($header = $reader.ReadLine()) -ne "" -and $null -ne $header) { }

            $requestTarget = if ($requestLine -match "^GET\s+([^\s]+)") { $Matches[1] } else { "/" }
            $requestPath = $requestTarget.Split("?")[0]
            if ($requestPath -eq "/") { $requestPath = "/index.html" }

            $relativePath = [Uri]::UnescapeDataString($requestPath).TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
            $filePath = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $relativePath))
            $rootPath = [IO.Path]::GetFullPath($root) + [IO.Path]::DirectorySeparatorChar

            if ($filePath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase) -and [IO.File]::Exists($filePath)) {
                $status = "200 OK"
                $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
                $contentType = if ($contentTypes.ContainsKey($extension)) { $contentTypes[$extension] } else { "application/octet-stream" }
                $payload = [IO.File]::ReadAllBytes($filePath)
            }
            else {
                $status = "404 Not Found"
                $contentType = "text/plain; charset=utf-8"
                $payload = [Text.Encoding]::UTF8.GetBytes("Not found")
            }

            $headers = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($payload.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
            $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            $stream.Write($payload, 0, $payload.Length)
            $stream.Flush()
        }
        finally {
            $client.Close()
        }
    }
}
finally {
    $server.Stop()
}
