#!/bin/bash
set -e

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

export DISPLAY=:99
Xvfb :99 -screen 0 1024x768x16 -ac &
sleep 2

fluxbox &
sleep 1
x11vnc -display :99 -forever -shared -rfbport 5900 \
  -passwd "$VNC_PASSWORD" \
  -ncache 0 -nowf -noxdamage -wait 20 -defer 20 &
sleep 1

websockify --web=/usr/share/novnc 0.0.0.0:6080 localhost:5900 &

exec node server.js
