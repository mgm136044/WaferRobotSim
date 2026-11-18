#!/bin/bash
# 더블클릭하면 이 컴퓨터에서 시뮬레이터를 띄우고, 같은 Wi-Fi의 팀원이 접속할 주소를 보여 줍니다.
cd "$(dirname "$0")"
PORT=8090
NODE=""
for c in node "$HOME/.aside/runtime/bin/node" /usr/local/bin/node /opt/homebrew/bin/node; do
  if command -v "$c" >/dev/null 2>&1; then NODE="$c"; break; fi
done
if [ -n "$NODE" ]; then
  "$NODE" tools/serve.mjs $PORT &
else
  echo "node가 없어 python3 로 띄웁니다"
  (cd web && python3 -m http.server $PORT --bind 0.0.0.0) &
  sleep 1
  echo "이 컴퓨터: http://localhost:$PORT/"
  ipconfig getifaddr en0 2>/dev/null | sed "s#^#같은 네트워크: http://#; s#\$#:$PORT/#"
fi
sleep 1
open "http://localhost:$PORT/"
wait
