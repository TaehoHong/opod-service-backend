#!/usr/bin/env bash
set -euo pipefail

host=taeho@121.141.156.200
port=300
key="$HOME/personal/credentials/home_server_key.pem"
remote_dir=/home/taeho/opod-backend
remote_docker="ssh://$host:$port"
image=opod-service-backend:latest

echo "[1/3] VPS에서 linux/amd64 이미지 빌드"
ssh-agent sh -c '
  ssh-add "$1" >/dev/null 2>&1
  docker --host "$2" build --platform linux/amd64 -f docker/Dockerfile -t "$3" .
' sh "$key" "$remote_docker" "$image"

echo "[2/3] api 재시작 (컨테이너 시작 시 prisma migrate deploy 자동 실행)"
ssh -i "$key" -p "$port" "$host" bash -s -- "$remote_dir" <<'REMOTE'
set -euo pipefail
cd "$1"
docker compose up -d --no-build api

echo "[3/3] 헬스체크"
for _ in $(seq 1 30); do
  if docker exec opod-service-backend node -e \
      "fetch('http://127.0.0.1:7000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "배포 완료: healthy"
    exit 0
  fi
  sleep 2
done

echo "헬스체크 실패 — 최근 로그" >&2
docker logs --tail 40 opod-service-backend >&2
exit 1
REMOTE
