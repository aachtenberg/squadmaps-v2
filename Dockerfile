FROM nginx:alpine

# nginx config — small, rarely changes after initial setup.
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Lightweight image assets (flags, vehicle icons, unit silhouettes,
# minimap thumbnails) — a few MB total, change occasionally.
COPY assets/flags/ /usr/share/nginx/html/assets/flags/
COPY assets/vehicles/ /usr/share/nginx/html/assets/vehicles/
COPY assets/units/ /usr/share/nginx/html/assets/units/
COPY assets/thumbnails/ /usr/share/nginx/html/assets/thumbnails/

# NOTE: assets/maps/ (tile pyramids ~700MB) and data/heightmaps/ (~70MB)
# are gitignored — fetched at build time via download_*.sh and bind-mounted
# into the pod from a hostPath at runtime. Keeps the image small and the
# CI build self-contained.

# Translations and small reference data — moderate size, change rarely.
COPY data/translations.json data/translations.js data/unit_metadata.json \
     data/mortar_maps.json data/mortar_weapons.json \
     /usr/share/nginx/html/data/

# Static page entry + style + favicon — change occasionally.
COPY index.html app.css squadmaps-32.png /usr/share/nginx/html/

# Hot path: app code and the v10 layer database. These change every commit;
# isolate them in their own layers so an app.js edit doesn't repush data
# and a data refresh doesn't repush app.js.
COPY data/water_hazards.js data/strategy_guides.js /usr/share/nginx/html/data/
COPY app.js /usr/share/nginx/html/
COPY data/v10_data.js data/v10_data.json /usr/share/nginx/html/data/

# Pre-create hostPath mount targets so the empty image dirs exist for
# k8s to mount over them. (nginx will 404 if a request lands here before
# the mount populates, but the mount is set up before pod start.)
RUN mkdir -p /usr/share/nginx/html/assets/maps /usr/share/nginx/html/data/heightmaps

EXPOSE 80
