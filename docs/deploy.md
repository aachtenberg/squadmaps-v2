# Build & Deploy

How code in this repo gets to the live site, and how to roll out a new build.

## Pipeline at a glance

```
push to main → GitHub Actions (.github/workflows/build.yml)
             → docker buildx (linux/arm64 + linux/amd64)
             → ghcr.io/aachtenberg/squadmaps-v2:{latest, main, sha-XXXXXXX}
             → (manual) kubectl rollout restart on the k3s cluster
             → pod pulls the new :main digest and serves it
```

Push to `main` triggers a build; pushes that only touch `docs/`, `README.md`,
`scripts/`, or `.gitignore` are skipped (`paths-ignore` in the workflow).
`workflow_dispatch` is also enabled, so you can trigger a build manually from
the Actions tab without a commit.

The image is **multi-arch** — built for arm64 (raspberry pi) and amd64.

## Where it runs

| | |
|--|--|
| Cluster | k3s, 4 nodes, control-plane on `raspberrypi` |
| Namespace | `apps` |
| Deployment | `squadmaps` (1 replica) |
| Node pin | `kubernetes.io/hostname: raspberrypi` (host of the data volumes) |
| Image | `ghcr.io/aachtenberg/squadmaps-v2:main` (`imagePullPolicy: Always`) |
| Container | nginx serving `/usr/share/nginx/html` on port 80 |
| Health | `GET /healthz` (liveness + readiness) |
| Service (cluster) | `squadmaps` ClusterIP, port 80 |
| Service (external) | `squadmaps-external` NodePort `30084` |
| Ingress | none |
| GHCR auth | package is public; no `imagePullSecret` referenced |

The deployment is labeled `app.kubernetes.io/managed-by: homelab-infra` —
the manifest is owned by a separate `homelab-infra` repo, **not** this one.
This repo only ships the app + Dockerfile + nginx config; cluster manifests
live elsewhere.

### Hostpath data on `raspberrypi`

```
/var/lib/squadmaps/
├── maps/         ~700 MB   tile pyramids + single-image overlays
└── heightmaps/   ~70 MB    SquadCalc heightmap JSONs
```

Both are mounted read-only into the pod at `assets/maps/` and
`data/heightmaps/`. They're populated out-of-band by `download_tiles.sh` /
`download_assets.sh` (see [README.md](../README.md)) and are intentionally
gitignored. The deployment is pinned to the `raspberrypi` node because of
these hostPath mounts — moving the pod elsewhere requires moving the data
or switching to a real PV.

## Rolling out a new image

`imagePullPolicy: Always` does **not** auto-deploy new builds. It only
re-checks the registry digest when a pod starts. With `:main` (a moving
tag) the deployment spec doesn't change between builds, so nothing
triggers a pod restart on its own.

To pick up a new build:

```sh
ssh aachten@raspberrypi 'kubectl rollout restart deployment/squadmaps -n apps'
ssh aachten@raspberrypi 'kubectl rollout status deployment/squadmaps -n apps'
```

`maxSurge: 25%` + `maxUnavailable: 25%` on a 1-replica deployment means k3s
spins up the new pod, waits for `/healthz` to pass readiness, then kills
the old one — zero-downtime in practice.

To pin to an immutable build instead of restarting on the moving tag:

```sh
ssh aachten@raspberrypi \
  'kubectl set image deployment/squadmaps -n apps nginx=ghcr.io/aachtenberg/squadmaps-v2:sha-<short-sha>'
```

This changes the deployment spec, which guarantees a rollout. Use the
short SHA from the GHCR tag list (the workflow tags every build with
`sha-XXXXXXX`).

## Verifying a rollout

```sh
# pod restarted recently, status Running, image digest is the new one
ssh aachten@raspberrypi \
  'kubectl get pods -n apps -l app.kubernetes.io/name=squadmaps -o wide'

# image actually in use (resolves the moving tag to a digest)
ssh aachten@raspberrypi \
  'kubectl get pod -n apps -l app.kubernetes.io/name=squadmaps -o jsonpath="{.items[0].status.containerStatuses[0].imageID}"; echo'

# hit the live site through the NodePort
curl -sI http://raspberrypi:30084/healthz
```

For a UI change, hard-reload in the browser after the rollout — `index.html`,
`app.js`, `app.css` are served `Cache-Control: no-cache, must-revalidate`
(see [deploy/nginx.conf](../deploy/nginx.conf)) so the next page load picks
the new bundle up immediately, but an already-open tab may need a refresh.

## Triggering a build without a code change

```sh
gh workflow run "Build and push container image" -R aachtenberg/squadmaps-v2
gh run list -R aachtenberg/squadmaps-v2 --limit 1
```

Useful for rebuilding on a base-image security update or after fixing a
broken workflow.
