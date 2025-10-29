
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET","POST","DELETE"]
  }
});

const DATA_FILE = path.join(__dirname, 'data.json');
let DATA = { sales: {}, config: {}, loyalty: {}, products: {} };

/*
DATA.products = {
  "Pommes": { qty: 12, revenue: 48.00 },
  "Cola 0.5L": { qty: 7, revenue: 17.50 }
}
*/

try {
  if (fs.existsSync(DATA_FILE)) {
    DATA = JSON.parse(fs.readFileSync(DATA_FILE));
    if (!DATA.sales) DATA.sales = {};
    if (!DATA.config) DATA.config = {};
    if (!DATA.loyalty) DATA.loyalty = {};
    if (!DATA.products) DATA.products = {};
  }
} catch(e){
  console.error('load data', e);
}

function persist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DATA, null, 2));
  } catch(e){
    console.error(e);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- CONFIG ----------
app.get('/api/config', (req,res) => {
  res.json(DATA.config || {});
});

app.post('/api/config', (req,res) => {
  DATA.config = req.body || {};
  persist();
  io.emit('config:update', DATA.config);
  res.json({ok:true});
});

// ---------- SALES / Umsatz pro Tag ----------
/*
DATA.sales = {
  "2025-10-29": {
    total: 123.45,
    entries: [
      { grund:"Pommes", betrag:4, ts: 1730200000000 },
      ...
    ]
  }
}
*/
app.get('/api/sales', (req,res) => {
  res.json(DATA.sales || {});
});

app.post('/api/sales', (req,res) => {
  DATA.sales = req.body || {};
  persist();
  io.emit('sales:update', DATA.sales);
  res.json({ok:true});
});

app.post('/api/sales/entry', (req,res) => {
  const { grund, betrag, ts } = req.body || {};
  const time = new Date(ts || Date.now());
  const key = `${time.getFullYear()}-${String(time.getMonth()+1).padStart(2,'0')}-${String(time.getDate()).padStart(2,'0')}`;

  if (!DATA.sales[key]) DATA.sales[key] = { total:0, entries:[] };
  const amount = Number(betrag || 0);
  DATA.sales[key].total += amount;
  DATA.sales[key].entries.push({ grund, betrag: amount, ts: ts || Date.now() });

  // update product stats based on grund
  if (grund){
    if (!DATA.products[grund]) {
      DATA.products[grund] = { qty: 0, revenue: 0 };
    }
    DATA.products[grund].qty += 1;
    DATA.products[grund].revenue += amount;
  }

  persist();

  io.emit('sales:update', DATA.sales);
  io.emit('products:update', DATA.products);

  res.json({
    ok:true,
    day:key,
    sales:DATA.sales[key],
    productStats: DATA.products
  });
});

// ---------- PRODUCTS / Umsatz pro Produkt ----------
app.get('/api/products', (req,res) => {
  res.json(DATA.products || {});
});

// ---------- LOYALTY / Treuepunkte Lifetime ----------
/*
DATA.loyalty = {
  "Kunde A": 12,
  "Kunde B": 5
}
*/
app.get('/api/loyalty', (req,res) => {
  res.json(DATA.loyalty || {});
});

app.post('/api/loyalty', (req,res) => {
  const { name, points } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name required" });

  if (!DATA.loyalty) DATA.loyalty = {};
  const cur = Number(DATA.loyalty[name] || 0);
  DATA.loyalty[name] = cur + Number(points || 0);

  persist();
  io.emit('loyalty:update', DATA.loyalty);
  res.json({ok:true, loyalty:DATA.loyalty});
});

app.delete('/api/loyalty', (req,res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name required" });

  if (DATA.loyalty && DATA.loyalty[name] !== undefined){
    delete DATA.loyalty[name];
  }

  persist();
  io.emit('loyalty:update', DATA.loyalty);
  res.json({ok:true, loyalty:DATA.loyalty});
});

// fallback => SPA
app.get('*', (req,res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.emit('config:update', DATA.config || {});
  socket.emit('sales:update', DATA.sales || {});
  socket.emit('products:update', DATA.products || {});
  socket.emit('loyalty:update', DATA.loyalty || {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('Server listening on', PORT));
