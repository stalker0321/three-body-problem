# Deployment Notes

## Production

- Domain: `fallingworlds.com`
- Public URLs:
  - `https://fallingworlds.com`
  - `https://www.fallingworlds.com`
- Host-specific values such as server IP, SSH username, absolute paths, and service names should stay in a private ops note, not in this repository.

## Runtime Topology

- `Caddy` terminates HTTP/HTTPS on `:80/:443`.
- Node app listens only on `127.0.0.1:8080`.
- `Caddy` reverse-proxies requests to `127.0.0.1:8080`.
- Public access to `:8080` is blocked in UFW.

## DNS

```text
A      @      <server-ip>
CNAME  www    fallingworlds.com
TTL    300
```

## Firewall

- allow `22/tcp` with rate limit
- allow `80/tcp`
- allow `443/tcp`
- do not expose `8080/tcp`

## Deploy

From the repo root:

```bash
./deploy.sh
```

The deploy script:

- pushes `main` to `origin`
- connects to the production host
- updates the app directory on the server
- restarts the app service

## Important Caddy Note

The frontend uses `EventSource` on `/api/stream`.

Do not apply compression to `/api/stream`. If `text/event-stream` is gzip-compressed by the reverse proxy, browser updates become bursty and the simulation looks like it is running at very low FPS.

Keep `/api/stream` on a dedicated reverse-proxy route with `flush_interval -1`, and only enable `encode gzip zstd` for normal page/API traffic.
