@echo off
setlocal
set VLC_PATH=C:\Program Files\VideoLAN\VLC\vlc.exe
if not exist "%VLC_PATH%" set VLC_PATH=C:\Program Files (x86)\VideoLAN\VLC\vlc.exe
if not exist "%VLC_PATH%" (
  echo No se encontro VLC. Instale VLC o edite este archivo con la ruta correcta.
  pause
  exit /b 1
)
start "Qhali VLC PRO" "%VLC_PATH%" --extraintf=http --http-host 127.0.0.1 --http-port 8081 --http-password %VLC_PASSWORD% --network-caching=250 --file-caching=250 --disc-caching=250 --no-video-title-show --qt-minimal-view --no-embedded-video --one-instance --playlist-autostart --fullscreen
exit /b 0
