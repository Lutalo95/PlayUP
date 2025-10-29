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

  // ===  LIVE UPDATES BROADCASTS ===
  io.emit('sales:update', DATA.sales);
  io.emit('products:update', DATA.products);

  // Sende Rush Hour Update
  const rushHourData = calculateRushHourData();
  io.emit('rush-hour:update', rushHourData);
  
  // Sende Top Products Update
  const topProducts = calculateTopProducts('all');
  io.emit('top-products:update', topProducts);

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
  const oldPoints = Number(DATA.loyalty[name] || 0);
  const pointsToAdd = Number(points || 0);
  const newPoints = oldPoints + pointsToAdd;
  DATA.loyalty[name] = newPoints;

  persist();

  // Berechne Level für Broadcasting
  const oldLevel = calculateLevelForPoints(oldPoints);
  const newLevel = calculateLevelForPoints(newPoints);

  // Erstelle vollständige Update-Daten
  const loyaltyUpdate = {
    type: 'loyalty_points_update',
    timestamp: new Date().toISOString(),
    action: 'add',
    customer: {
      name: name,
      points: newPoints,
      pointsChange: pointsToAdd,
      level: newLevel
    },
    allCustomers: Object.entries(DATA.loyalty).map(([n, p]) => ({
      name: n,
      points: p,
      level: calculateLevelForPoints(p)
    })),
    statistics: calculateLoyaltyStatistics(),
    levelUp: oldLevel !== newLevel
  };

  io.emit('loyalty:update', loyaltyUpdate);

  res.json({ok:true, loyalty:DATA.loyalty, update: loyaltyUpdate});
});

app.delete('/api/loyalty', (req,res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name required" });

  if (DATA.loyalty && DATA.loyalty[name] !== undefined){
    delete DATA.loyalty[name];
  }

  persist();

  // Erstelle Update-Daten für Löschung
  const loyaltyUpdate = {
    type: 'loyalty_points_update',
    timestamp: new Date().toISOString(),
    action: 'remove',
    customer: {
      name: name
    },
    allCustomers: Object.entries(DATA.loyalty).map(([n, p]) => ({
      name: n,
      points: p,
      level: calculateLevelForPoints(p)
    })),
    statistics: calculateLoyaltyStatistics()
  };

  io.emit('loyalty:update', loyaltyUpdate);

  res.json({ok:true, loyalty:DATA.loyalty});
});

// ---------- RUSH HOUR ANALYSE ----------
app.get('/api/rush-hour', (req, res) => {
  const data = calculateRushHourData();
  res.json(data);
});

// ---------- TOP PRODUKTE ----------
app.get('/api/top-products', (req, res) => {
  const period = req.query.period || 'all'; // today, week, month, all
  const data = calculateTopProducts(period);
  res.json(data);
});

// ---------- STATS LÖSCHEN - ERWEITERT ----------
app.delete('/api/stats', (req, res) => {
  const { scope } = req.body || {};
  
  let deletedCount = 0;
  let affectedSales = false;
  let affectedProducts = false;
  
  switch(scope) {
    case 'all':
      deletedCount = Object.keys(DATA.sales).length + Object.keys(DATA.products).length;
      affectedSales = Object.keys(DATA.sales).length > 0;
      affectedProducts = Object.keys(DATA.products).length > 0;
      DATA.sales = {};
      DATA.products = {};
      break;
      
    case 'products':
      deletedCount = Object.keys(DATA.products).length;
      affectedProducts = true;
      DATA.products = {};
      break;
      
    case 'today':
      const today = getTodayKey();
      if (DATA.sales[today]) {
        deletedCount = DATA.sales[today].entries.length;
        affectedSales = true;
        delete DATA.sales[today];
      }
      break;
      
    case 'week':
      const now = new Date();
      for (let i = 0; i < 7; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const key = getDateKey(date);
        if (DATA.sales[key]) {
          deletedCount += DATA.sales[key].entries.length;
          delete DATA.sales[key];
          affectedSales = true;
        }
      }
      break;
      
    case 'month':
      const nowMonth = new Date();
      for (let i = 0; i < 30; i++) {
        const date = new Date(nowMonth);
        date.setDate(date.getDate() - i);
        const key = getDateKey(date);
        if (DATA.sales[key]) {
          deletedCount += DATA.sales[key].entries.length;
          delete DATA.sales[key];
          affectedSales = true;
        }
      }
      break;
  }
  
  persist();
  
  const statsDeleted = {
    type: 'stats_deleted',
    timestamp: new Date().toISOString(),
    scope: scope,
    affectedRecords: deletedCount,
    success: true
  };
  
  // === LIVE UPDATES BROADCASTS ===
  io.emit('stats:deleted', statsDeleted);
  
  if (affectedSales) {
    io.emit('sales:update', DATA.sales);
    
    // Aktualisiere auch Rush Hour nach Sales-Löschung
    const rushHourData = calculateRushHourData();
    io.emit('rush-hour:update', rushHourData);
  }
  
  if (affectedProducts) {
    io.emit('products:update', DATA.products);
    
    // Aktualisiere Top Products
    const topProducts = calculateTopProducts('all');
    io.emit('top-products:update', topProducts);
  }
  
  res.json({ 
    success: true, 
    deletedCount,
    affectedSales,
    affectedProducts
  });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateLevelForPoints(points) {
  if (points >= 200) return 'Platinum';
  if (points >= 150) return 'Gold';
  if (points >= 75) return 'Silver';
  return 'Bronze';
}

function calculateLoyaltyStatistics() {
  const customers = Object.entries(DATA.loyalty);
  const totalCustomers = customers.length;
  const totalPointsGiven = customers.reduce((sum, [_, points]) => sum + points, 0);
  const averagePoints = totalCustomers > 0 ? totalPointsGiven / totalCustomers : 0;
  
  const topCustomer = customers.length > 0
    ? customers.reduce((max, [name, points]) => 
        points > max.points ? { name, points } : max, 
        { name: customers[0][0], points: customers[0][1] }
      )
    : null;
  
  return {
    totalCustomers,
    totalPointsGiven,
    averagePoints,
    topCustomer
  };
}

function calculateRushHourData() {
  const hourlyTotals = Array(24).fill(0);
  const hourlyCounts = Array(24).fill(0);
  
  Object.values(DATA.sales).forEach(day => {
    if (day.entries) {
      day.entries.forEach(entry => {
        if (entry.ts) {
          const hour = new Date(entry.ts).getHours();
          hourlyTotals[hour] += entry.betrag || 0;
          hourlyCounts[hour] += 1;
        }
      });
    }
  });
  
  const topHours = hourlyTotals
    .map((revenue, hour) => ({ hour, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3);
  
  const currentHour = new Date().getHours();
  
  return {
    type: 'rush_hour_update',
    timestamp: new Date().toISOString(),
    hourlyData: hourlyTotals,
    hourlyCounts: hourlyCounts,
    topHours: topHours,
    currentHour: currentHour,
    currentHourRevenue: hourlyTotals[currentHour]
  };
}

function calculateTopProducts(period) {
  let sales = [];
  const now = new Date();
  
  switch(period) {
    case 'today':
      const today = getTodayKey();
      if (DATA.sales[today]) {
        sales = DATA.sales[today].entries || [];
      }
      break;
    case 'week':
      // Letzte 7 Tage
      for (let i = 0; i < 7; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const key = getDateKey(date);
        if (DATA.sales[key]) {
          sales = sales.concat(DATA.sales[key].entries || []);
        }
      }
      break;
    case 'month':
      // Letzter Monat
      for (let i = 0; i < 30; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const key = getDateKey(date);
        if (DATA.sales[key]) {
          sales = sales.concat(DATA.sales[key].entries || []);
        }
      }
      break;
    default: // 'all'
      Object.values(DATA.sales).forEach(day => {
        if (day.entries) {
          sales = sales.concat(day.entries);
        }
      });
  }
  
  const productStats = {};
  sales.forEach(entry => {
    if (entry.grund) {
      if (!productStats[entry.grund]) {
        productStats[entry.grund] = {
          name: entry.grund,
          quantity: 0,
          revenue: 0
        };
      }
      productStats[entry.grund].quantity += 1;
      productStats[entry.grund].revenue += entry.betrag || 0;
    }
  });
  
  const totalRevenue = Object.values(productStats).reduce((sum, p) => sum + p.revenue, 0);
  
  const sortedProducts = Object.values(productStats)
    .map(p => ({
      ...p,
      percentage: totalRevenue > 0 ? (p.revenue / totalRevenue * 100).toFixed(1) : 0,
      trend: 'stable' // TODO: Implement trend calculation
    }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);
  
  return {
    type: 'top_products_update',
    timestamp: new Date().toISOString(),
    period,
    products: sortedProducts,
    totalProducts: Object.keys(productStats).length,
    totalRevenue
  };
}

function getTodayKey() {
  const now = new Date();
  return getDateKey(now);
}

function getDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// ============================================
// SOCKET.IO CONNECTION
// ============================================

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  
  // Sende initiale Daten
  socket.emit('config:update', DATA.config || {});
  socket.emit('sales:update', DATA.sales || {});
  socket.emit('products:update', DATA.products || {});
  
  // Sende Loyalty-Daten im erweiterten Format
  const loyaltyUpdate = {
    type: 'loyalty_points_update',
    timestamp: new Date().toISOString(),
    action: 'init',
    allCustomers: Object.entries(DATA.loyalty).map(([name, points]) => ({
      name,
      points,
      level: calculateLevelForPoints(points)
    })),
    statistics: calculateLoyaltyStatistics()
  };
  socket.emit('loyalty:update', loyaltyUpdate);
  
  // Sende Rush Hour Daten
  const rushHourData = calculateRushHourData();
  socket.emit('rush-hour:update', rushHourData);
  
  // Sende Top Products
  const topProducts = calculateTopProducts('all');
  socket.emit('top-products:update', topProducts);
  
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// fallback => SPA
app.get('*', (req,res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('Server listening on', PORT));