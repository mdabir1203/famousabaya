# AbaYa Track — System Diagrams

Open `index.html` in a browser. It's a single self-contained page that uses
Mermaid 10 (loaded from jsDelivr CDN) to render 13 diagrams covering:

1. What the app is
2. High-level topology (3 lanes: kiosk / admin / CEO)
3. Runtime components
4. The factory server (`server.js`) — internal map
5. The Cloudflare Worker — internal map
6. Data flow: Excel → catalog → kiosk
7. Session lifecycle (sequence)
8. Dispatch service (material logistics)
9. Persistence & offline story
10. API surface (REST + Socket.IO + Worker)
11. Security & deployment
12. Ops & maintenance
13. Risks & technical debt

The page is read-only documentation; nothing in `server.js` or `cloudflare/`
references it. To regenerate after a refactor, edit the Mermaid blocks in
`index.html` and reload the page.
