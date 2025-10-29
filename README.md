
# Play UP — Render-ready package (v4)

## Änderungen ggü. v3
- Altes (lokales) Treuepunkte-Widget entfernt.
- Neues Lifetime-Treuepunkte-Panel bleibt unten in der Seite.
- Server tracked jetzt zusätzlich `products`:
  DATA.products = {
    "Pommes": { qty: 12, revenue: 48.00 },
    "Cola 0.5L": { qty: 7, revenue: 17.50 }
  }
  -> wird bei jedem recordSale(grund,betrag) aktualisiert.
  -> broadcast via 'products:update'.
  -> Client ruft buildProductStatsChart(), renderProductStatsTable(), etc. auf Basis von state.products.
- Umsatz pro Produkt ist jetzt global synchronisiert & persistent.

## Endpunkte
GET  /api/config
POST /api/config

GET  /api/sales
POST /api/sales
POST /api/sales/entry         { grund, betrag, ts? }

GET  /api/products            -> { produktName: {qty, revenue}, ... }

GET    /api/loyalty
POST   /api/loyalty           { name, points }
DELETE /api/loyalty           { name }

## Socket Events
- 'config:update'   -> state.config
- 'sales:update'    -> state.sales      (umsatz/tagesumsatz)
- 'products:update' -> state.products   (umsatz pro produkt)
- 'loyalty:update'  -> state.loyalty    (treuepunkte lifetime)

## Client State
window.__SERVER_STATE = {
  sales: {},
  products: {},
  config: {},
  loyalty: {}
}

- loadSales() wurde überschrieben -> nutzt server state.
- loadProductStats() hinzugefügt -> nutzt server state.
- recordSale() überschrieben -> POST /api/sales/entry und dann originalRecordSale() für Bon-Flow.
- Seiten/activeTab wird NICHT synchronisiert.

## Lokal starten
npm install
npm start
http://localhost:3000

## Render deploy
Build Command: npm install
Start Command: npm start
Persistent Disk aktivieren, damit data.json gespeichert bleibt.
