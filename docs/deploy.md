# Deploy notes

Operational gotchas for rolling out a new build. The high-level pipeline
(GHA → GHCR → k3s) and the manifest link live in the [README](../README.md).

## `:main` doesn't auto-redeploy

The deployment pulls `ghcr.io/aachtenberg/squadmaps-v2:main` with
`imagePullPolicy: Always`. That sounds like it should auto-deploy on every
push — it doesn't. `Always` only re-checks the registry digest **when a
pod starts**. With a moving tag the deployment spec doesn't change between
builds, so nothing triggers a pod restart on its own.

After the GHA build is green, kick a rollout:

```sh
ssh <k3s-host> 'kubectl rollout restart deployment/squadmaps -n apps'
ssh <k3s-host> 'kubectl rollout status deployment/squadmaps -n apps'
```

`maxSurge: 25%` + `maxUnavailable: 25%` on a 1-replica deployment means
k3s spins up the new pod, waits for `/healthz` to pass readiness, then
kills the old one — zero-downtime in practice.

## Pinning to an immutable build

`kubectl rollout restart` re-pulls the moving `:main` tag — fine for
forward rollouts, but you can't roll *back* to a known build that way.
For deterministic deploys (or to bisect a regression), set the image to
the sha tag the workflow stamped on every build:

```sh
ssh <k3s-host> \
  'kubectl set image deployment/squadmaps -n apps nginx=ghcr.io/aachtenberg/squadmaps-v2:sha-<short-sha>'
```

This changes the deployment spec, which guarantees a rollout.
`kubectl rollout undo deployment/squadmaps -n apps` reverts to the prior
ReplicaSet if the new one misbehaves.

## Verifying

```sh
# image digest actually in use (resolves :main to the pulled sha)
ssh <k3s-host> \
  'kubectl get pod -n apps -l app.kubernetes.io/name=squadmaps \
    -o jsonpath="{.items[0].status.containerStatuses[0].imageID}"; echo'
```

For UI changes, hard-reload the browser after the rollout — `index.html`,
`app.js`, `app.css` are served `Cache-Control: no-cache, must-revalidate`
(see [deploy/nginx.conf](../deploy/nginx.conf)) so the next page load
picks up the new bundle, but an already-open tab may need a refresh.

## Triggering a build without a code change

For base-image security updates or after fixing a broken workflow:

```sh
gh workflow run "Build and push container image" -R aachtenberg/squadmaps-v2
gh run list -R aachtenberg/squadmaps-v2 --limit 1
```
