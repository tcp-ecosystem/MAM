# deploy/mam-hub — production bundle branch (artifact only, no source)
#
# main = source of truth (code, docs, tests).
# deploy/mam-hub = exactly one file: mam-hub.tar.gz, the tested bundle.
# Rebuilt by registry/server/scripts/build-bundle on every release.
# Sprite/fly/VPS download it with:
#   curl -sL https://raw.githubusercontent.com/tcp-ecosystem/MAM/deploy/mam-hub/mam-hub.tar.gz | tar xz
