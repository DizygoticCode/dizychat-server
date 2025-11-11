# Logo Asset Reference

This repository includes the original PNG toolbar logos under `public/`. The responsive toolbar styling in `public/chat.css` clamps the rendered logo size so it never exceeds its design footprint while still shrinking on extremely small viewports. The same PNG artwork is also copied into `public/uploads/` for runtime use when the server serves uploaded assets.

If you need to restore the branding assets from another checkout, copy the following files back into the repo and commit them:

- `public/logo.png`
- `public/logo-light.png`
- `public/logo-light-whitebg.png`
- `public/uploads/logo.png`

Once those assets are in place, the existing markup in `public/index.html` and the responsive rules in `public/chat.css` will continue to use them automatically.
