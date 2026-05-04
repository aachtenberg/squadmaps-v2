# SDK patches

Files in this directory are vendored copies of scripts that ship inside
the Squad SDK install but need local fixes for our extraction pipeline.
They aren't loaded automatically — copy them over the originals after
each SDK update.

## ExportLayers.py

Vendored from `<SDK_ROOT>/Squad/Content/Python/LevelScript/ExportLayers.py`.

Reapply with:

```bash
cp scripts/extraction/sdk_patches/ExportLayers.py \
   /mnt/e/epic/SquadEditor/Squad/Content/Python/LevelScript/ExportLayers.py
```

(Adjust the path if the SDK isn't at `E:\epic\SquadEditor`.)

### Why we patch it

Squad 10.4 shipped with three problems in this file:

1. Two `else:` blocks (the team1 and team2 faction-setup branches) had
   their bodies de-indented one level, so the `else:` body would never
   execute and the file failed to parse.
2. The `_asset_name` line at the bottom of each `else:` body was
   over-indented to match the broken `else:` block.
3. New `*_Automation` template layers (one per map) ship with an empty
   `TeamConfigs` array. The script accesses `Teams[0]` / `Teams[1]`
   unconditionally and crashes on those.

The patched copy fixes the indentation and adds a guard before the
team-1 read:

```python
Teams = asset.get_editor_property("TeamConfigs")
if len(Teams) < 2:
    unreal.log_warning("Skipping layer with %d TeamConfigs: %s" % (len(Teams), name))
    continue
```

If a future SDK update fixes any of these upstream, drop the vendored
copy.
