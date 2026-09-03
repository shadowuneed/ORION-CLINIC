$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$runtimeRoot = Join-Path $projectRoot ".orion-runtime"
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$wavPath = Join-Path $runtimeRoot "synthetic-stt-check.wav"

Add-Type -AssemblyName System.Speech
$synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$sessionId = $null
try {
    $synthesizer.SelectVoice("Microsoft Irina Desktop")
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
        16000,
        [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
        [System.Speech.AudioFormat.AudioChannel]::Mono
    )
    $synthesizer.SetOutputToWaveFile($wavPath, $format)
    $synthesizer.Speak(
        "Здравствуйте. У меня болит голова второй день и поднялась температура."
    )
    $synthesizer.SetOutputToNull()

    $session = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:3101/v1/sessions" `
        -ContentType "application/json" `
        -Body '{"doctorFirst":true}'
    $sessionId = $session.sessionId
    $raw = & curl.exe -sS -X POST "http://127.0.0.1:3101/v1/transcribe" `
        -F "audio=@$wavPath;type=audio/wav" `
        -F "session_id=$sessionId" `
        -F "utterance_index=0"
    if ($LASTEXITCODE -ne 0) { throw "Synthetic transcription request failed." }
    $result = $raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$result.text)) {
        throw "The speech model returned an empty transcript."
    }
    [pscustomobject]@{
        text = $result.text
        role = $result.speaker.label
        roleStatus = $result.speaker.status
        durationMs = $result.durationMs
        processingMs = $result.processingMs
        languageDetection = $result.languageDetection
    } | ConvertTo-Json -Depth 4
} finally {
    $synthesizer.Dispose()
    if ($null -ne $sessionId) {
        Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:3101/v1/sessions/$sessionId" -ErrorAction SilentlyContinue | Out-Null
    }
    Remove-Item -LiteralPath $wavPath -Force -ErrorAction SilentlyContinue
}
