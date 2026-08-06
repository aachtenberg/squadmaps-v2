# Deploy notes

Operational gotchas for rolling out a new build. The high-level pipeline
(GHA → GHCR → deploy-repo bump → ArgoCD) lives in the [README](../README.md).

## The pipeline

```
push to main
  └─ build job          → ghcr.io/aachtenberg/squadmaps-v2:{main, sha-<sha7>, latest}
  └─ bump-deploy-repo   → commits newTag: sha-<sha7> into aachtenberg/squadmaps-deploy
                            └─ ArgoCD `squadmaps` Application → rollout
```

The manifest lives in the **private** repo
[squadmaps-deploy](https://github.com/aachtenberg/squadmaps-deploy) (it carries
the pinned node name, the `hostPath` layout, and the LAN NodePort). ArgoCD's
standalone `squadmaps` Application is registered in
`homelab-infra/k3s/base/argocd/applications/squadmaps.yml`.

Nothing needs to be run by hand. `maxSurge: 25%` + `maxUnavailable: 25%` on a
1-replica deployment means k3s spins up the new pod, waits for `/healthz` to
pass readiness, then kills the old one — zero-downtime in practice.

## Why the tag bump exists

This used to be manual, and the reason is worth keeping written down.

The Deployment pinned `ghcr.io/aachtenberg/squadmaps-v2:main` with
`imagePullPolicy: Always`. That sounds like it should auto-deploy on every
push — it doesn't. `Always` only re-checks the registry digest **when a pod
starts**. With a moving tag the Deployment spec is byte-identical between
builds, so nothing triggers a pod restart on its own.

ArgoCD didn't save us either: it reconciles **Git**, not the registry. An
unchanged manifest is a synced app, and a synced app gets left alone. So a
green build sat in GHCR indefinitely while the pod kept serving the old image,
and every deploy needed a hand-run `kubectl rollout restart`.

Committing an immutable `sha-` tag into the deploy repo makes each build a real
Git change, which is the one thing ArgoCD acts on.

## Rolling back

Edit `newTag` in `squadmaps-deploy/kustomization.yml` to an older `sha-<sha7>`
and push. ArgoCD rolls it out.

That pin holds only until the next push to squadmaps-v2's `main`, which
overwrites it — so for anything longer than a bisect, revert the code too.

## Verifying

```sh
# what ArgoCD thinks
kubectl get application squadmaps -n argocd \
  -o jsonpath='{.status.sync.status} {.status.health.status} {.status.sync.revision}'; echo

# image tag actually running
kubectl get deploy squadmaps -n apps \
  -o jsonpath='{.spec.template.spec.containers[0].image}'; echo

# resolved digest
kubectl get pod -n apps -l app.kubernetes.io/name=squadmaps \
  -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'; echo
```

## When a deploy doesn't land

Work down the chain — each step names the thing to check:

1. **Build green?** `gh run list -R aachtenberg/squadmaps-v2 --limit 1`
2. **Bump committed?** `gh api repos/aachtenberg/squadmaps-deploy/commits --jq '.[0].commit.message'`
   — if the build was green but no bump landed, `DEPLOY_PAT` is expired or
   unscoped. It needs `contents:write` on `aachtenberg/squadmaps-deploy`.
3. **ArgoCD synced?** If the app reads `Unknown`, ArgoCD can't clone the
   private deploy repo — check the `argocd-repo-squadmaps-deploy` credential
   (sealed in homelab-infra, rotated via `scripts/seal-secrets.sh`).
4. **Pod rolled but page unchanged?** Hard-reload. `index.html`, `app.js`,
   `app.css` are served `Cache-Control: no-cache, must-revalidate` (see
   [deploy/nginx.conf](../deploy/nginx.conf)) so the next page load picks up the
   new bundle, but an already-open tab may need a refresh.

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
