# Admin uploads and R2 (decision)

## Current default (recommended for most factories)

- **Employee and catalog images** are uploaded on the **factory PC** via [public/asset-upload.html](../public/asset-upload.html) (`/asset-upload`), stored under `public/uploads/`, and referenced from Excel / barcode matching.
- **Pros:** Large files stay off Worker CPU limits; no extra R2 billing; works fully offline on LAN.
- **Cons:** CEO cannot upload from the public internet without VPN/Tailscale to the factory host.

## Optional future: `admin.farewellabaya.com` + R2

The architecture plan allows a second Pages app or Worker routes that issue **presigned PUT** URLs to **Cloudflare R2**, mirroring keys by employee barcode / item barcode.

- Uncomment **`[[r2_buckets]]`** in [cloudflare/wrangler.toml](../cloudflare/wrangler.toml) and create the bucket in the dashboard.
- Add Worker endpoints for minting presigned URLs (short TTL) and store **`photo_url` / `icon`** keys in D1 if the CEO path needs global media.

**Decision:** keep factory **`asset-upload.html`** as the default; add R2 only if you need cloud-side admin uploads without touching the factory PC.
