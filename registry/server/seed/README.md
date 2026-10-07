# Seed modules —verbatim copies of modules/examples/<type>/<type>.mam.
# The launcher publishes these on cold boot (see MAM_SEED_DIR).
# DO NOT EDIT HERE. Edit the originals and re-copy:
#   Copy-Item modules/examples/*/*.mam registry/server/seed/ -Include "[a-z]*.mam" -Force
# (then rebuild + republish the bundle / image)