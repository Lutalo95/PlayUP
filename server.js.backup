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
    methods: ["GET","POST","DELETE","PUT"]
  }
});

const DATA_FILE = path.join(__dirname, 'data.json');
let DATA = { 
  sales: {}, 
  config: {}, 
  loyalty: {}, 
  products: {},
  calculatorStates: {},
  settings: {
    theme: 'PlayUp Farben',
    darkMode: false,
    welcomeShown: false,
    activeTab: 1
  }
};

// Lade Daten beim Start
try {
  if (fs.existsSync(DATA_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE));
    DATA = {
      sales: loaded.sales || {},
      config: loaded.config || {},
      loyalty: loaded.loyalty || {},
      products: loaded.products || {},
      calculatorStates: loaded.calculatorStates || {},
      settings: loaded.settings || DATA.settings
    };
    console.log('✅ Daten geladen:', {
      sales: Object.keys(DATA.sales).length + ' Tage',
      products: Object.keys(DATA.products).length + ' Produkte',
      loyalty: Object.keys(DATA.loyalty).length + ' Kunden',
      calculatorStates: Object.keys(DATA.calculatorStates).length + ' Tabs'
    });
  }
} catch(e){
  console.error('❌ Fehler beim Laden der Daten:', e);
}

function persist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DATA, null, 2));
    console.log('💾 Daten gespeichert');
  } catch(e){
    console.error('❌ Fehler beim Speichern:', e);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// SETTINGS / EINSTELLUNGEN
// ============================================

app.get('/api/settings', (req, res) => {
  res.json(DATA.settings);
});

app.post('/api/settings', (req, res) => {
  DATA.settings = { ...DATA.settings, ...req.body };
  persist();
  io.emit('settings:update', DATA.settings);
  res.json({ ok: true, settings: DATA.settings });
});

// ============================================
// CALCULATOR STATES
// ============================================

app.get('/api/calculator-states', (req, res) => {
  res.json(DATA.calculatorStates);
});

app.post('/api/calculator-states', (req, res) => {
  const { tab, state } = req.body;
  if (!tab) return res.status(400).json({ error: 'Tab required' });
  
  DATA.calculatorStates[tab] = state;
  persist();
  
  io.emit('calculator:update', { tab, state });
  res.json({ ok: true, calculatorStates: DATA.calculatorStates });
});

app.get('/api/calculator-states/:tab', (req, res) => {
  const tab = req.params.tab;
  res.json(DATA.calculatorStates[tab] || null);
});

// ============================================
// CONFIG
// ============================================

app.get('/api/config', (req,res) => {
  res.json(DATA.config || {});
});

app.post('/api/config', (req,res) => {
  DATA.config = req.body || {};
  persist();
  io.emit('config:update', DATA.config);
  res.json({ok:true});
});

// ============================================
// SALES / UMSATZ - KORRIGIERT
// ============================================

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

  console.log('📝 Neuer Verkauf:', { grund, betrag, key });

  if (!DATA.sales[key]) DATA.sales[key] = { total:0, entries:[] };
  const amount = Number(betrag || 0);
  DATA.sales[key].total += amount;
  const entryTs = ts || Date.now();
  DATA.sales[key].entries.push({ grund, betrag: amount, ts: entryTs });

  // Extrahiere einzelne Produkte - KORRIGIERT
  let productsUpdated = [];
  if (grund) {
    const products = parseProductsFromGrund(grund);
    console.log('🔍 Gefundene Produkte:', products);
    
    if (products.length > 0) {
      products.forEach(product => {
        const productName = product.name;
        const quantity = product.qty;
        const totalQty = products.reduce((sum, p) => sum + p.qty, 0);
        const revenueForProduct = totalQty > 0 ? (amount * quantity / totalQty) : amount;
        
        if (!DATA.products[productName]) {
          DATA.products[productName] = { qty: 0, revenue: 0 };
        }
        DATA.products[productName].qty += quantity;
        DATA.products[productName].revenue = Math.round((DATA.products[productName].revenue + revenueForProduct) * 100) / 100;
        
        productsUpdated.push({
          name: productName,
          qty: quantity,
          revenue: Math.round(revenueForProduct * 100) / 100
        });
        
        console.log(`  ✅ ${productName}: +${quantity}x, +${revenueForProduct.toFixed(2)}$ (Total: ${DATA.products[productName].qty}x, ${DATA.products[productName].revenue.toFixed(2)}$)`);
      });
    }
  }

  persist();

  console.log('✅ Verkauf gespeichert:', {
    day: key,
    amount: amount,
    productsUpdated: productsUpdated.length,
    totalProducts: Object.keys(DATA.products).length
  });

  // Emit updates
  io.emit('sales:update', DATA.sales);
  io.emit('products:update', DATA.products);
  io.emit('rush-hour:update', calculateRushHourData());
  io.emit('top-products:update', calculateTopProducts('all'));

  res.json({
    ok: true,
    day: key,
    sales: DATA.sales[key],
    productStats: DATA.products,
    productsUpdated: productsUpdated
  });
});

// ============================================
// ERWEITERTE STATISTIKEN
// ============================================

app.get('/api/statistics/overview', (req, res) => {
  const { period, startDate, endDate } = req.query;
  const stats = calculateStatistics(period, startDate, endDate);
  res.json(stats);
});

app.get('/api/statistics/products', (req, res) => {
  const { period, startDate, endDate } = req.query;
  const stats = calculateProductStatistics(period, startDate, endDate);
  res.json(stats);
});

app.get('/api/statistics/timeline', (req, res) => {
  const { groupBy, startDate, endDate } = req.query;
  const timeline = calculateTimeline(groupBy || 'day', startDate, endDate);
  res.json(timeline);
});

// ============================================
// PRODUCTS
// ============================================

app.get('/api/products', (req,res) => {
  console.log('📊 Produkt-Anfrage - Aktuell:', Object.keys(DATA.products).length, 'Produkte');
  res.json(DATA.products || {});
});

// ============================================
// LOYALTY / TREUEPUNKTE
// ============================================

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

  const oldLevel = calculateLevelForPoints(oldPoints);
  const newLevel = calculateLevelForPoints(newPoints);

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

// ============================================
// RUSH HOUR ANALYSE
// ============================================

app.get('/api/rush-hour', (req, res) => {
  const data = calculateRushHourData();
  res.json(data);
});

// ============================================
// TOP PRODUKTE
// ============================================

app.get('/api/top-products', (req, res) => {
  const period = req.query.period || 'all';
  const data = calculateTopProducts(period);
  res.json(data);
});

// ============================================
// STATS LÖSCHEN
// ============================================

app.delete('/api/stats', (req, res) => {
  const { scope } = req.body || {};
  
  let deletedCount = 0;
  let affectedSales = false;
  let affectedProducts = false;
  
  console.log('🗑️ Lösche Statistiken:', scope);
  
  switch(scope) {
    case 'all':
      deletedCount = Object.keys(DATA.sales).length + Object.keys(DATA.products).length;
      affectedSales = Object.keys(DATA.sales).length > 0;
      affectedProducts = Object.keys(DATA.products).length > 0;
      DATA.sales = {};
      DATA.products = {};
      console.log('  ✅ Alle Daten gelöscht');
      break;
      
    case 'products':
      deletedCount = Object.keys(DATA.products).length;
      affectedProducts = true;
      DATA.products = {};
      console.log('  ✅ Produktstatistiken gelöscht');
      break;
      
    case 'today':
      const today = getTodayKey();
      if (DATA.sales[today]) {
        deletedCount = DATA.sales[today].entries.length;
        affectedSales = true;
        delete DATA.sales[today];
        console.log('  ✅ Heutige Verkäufe gelöscht');
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
      console.log('  ✅ Wöchentliche Verkäufe gelöscht');
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
      console.log('  ✅ Monatliche Verkäufe gelöscht');
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
  
  io.emit('stats:deleted', statsDeleted);
  
  if (affectedSales) {
    io.emit('sales:update', DATA.sales);
    io.emit('rush-hour:update', calculateRushHourData());
  }
  
  if (affectedProducts) {
    io.emit('products:update', DATA.products);
    io.emit('top-products:update', calculateTopProducts('all'));
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

function parseProductsFromGrund(grund) {
  const products = [];
  
  // Regex Pattern für "5x Pop UP" oder "2x Burn UP"
  const regex = /(\d+)x\s*([^+|]+?)(?=\s*(?:\+|\||$))/gi;
  let match;
  
  while ((match = regex.exec(grund)) !== null) {
    const qty = parseInt(match[1]);
    const name = match[2].trim();
    
    // Filter out dates, person counts, and too short names
    if (name && 
        !name.match(/^\d{1,2}\.\d{1,2}\.?$/) &&  // Nicht "31.10."
        !name.match(/^\d+P$/) &&                   // Nicht "2P"
        !name.match(/^(Essen|Trinken|Coins|Sticker|Figuren)$/i) && // Nicht Kategorien
        name.length > 1) {
      products.push({ name, qty });
    }
  }
  
  console.log(`  🔎 Parse: "${grund}" → ${products.length} Produkte:`, products);
  return products;
}

function filterSalesByDateRange(startDate, endDate) {
  const filtered = {};
  const start = startDate ? new Date(startDate) : new Date('2000-01-01');
  const end = endDate ? new Date(endDate) : new Date();
  
  Object.keys(DATA.sales).forEach(dateKey => {
    const date = new Date(dateKey);
    if (date >= start && date <= end) {
      filtered[dateKey] = DATA.sales[dateKey];
    }
  });
  
  return filtered;
}

function calculateStatistics(period, startDate, endDate) {
  const salesData = filterSalesByDateRange(startDate, endDate);
  const dates = Object.keys(salesData).sort();
  
  if (dates.length === 0) {
    return {
      totalRevenue: 0,
      totalTransactions: 0,
      averageTransaction: 0,
      totalDays: 0,
      averagePerDay: 0,
      firstSale: null,
      lastSale: null,
      bestDay: null,
      worstDay: null,
      dateRange: { start: null, end: null }
    };
  }
  
  let totalRevenue = 0;
  let totalTransactions = 0;
  let bestDay = { date: null, revenue: 0 };
  let worstDay = { date: null, revenue: Infinity };
  
  dates.forEach(date => {
    const dayData = salesData[date];
    totalRevenue += dayData.total;
    totalTransactions += dayData.entries.length;
    
    if (dayData.total > bestDay.revenue) {
      bestDay = { date, revenue: dayData.total };
    }
    if (dayData.total < worstDay.revenue) {
      worstDay = { date, revenue: dayData.total };
    }
  });
  
  const averageTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
  const averagePerDay = dates.length > 0 ? totalRevenue / dates.length : 0;
  
  return {
    type: 'statistics_overview',
    timestamp: new Date().toISOString(),
    period: period || 'custom',
    dateRange: {
      start: dates[0],
      end: dates[dates.length - 1]
    },
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalTransactions,
    averageTransaction: Math.round(averageTransaction * 100) / 100,
    totalDays: dates.length,
    averagePerDay: Math.round(averagePerDay * 100) / 100,
    firstSale: dates[0],
    lastSale: dates[dates.length - 1],
    bestDay: bestDay.date ? bestDay : null,
    worstDay: worstDay.date !== null && worstDay.revenue !== Infinity ? worstDay : null
  };
}

function calculateProductStatistics(period, startDate, endDate) {
  const salesData = filterSalesByDateRange(startDate, endDate);
  const productStats = {};
  
  Object.values(salesData).forEach(day => {
    if (day.entries) {
      day.entries.forEach(entry => {
        if (entry.grund) {
          const products = parseProductsFromGrund(entry.grund);
          products.forEach(product => {
            if (!productStats[product.name]) {
              productStats[product.name] = {
                name: product.name,
                quantity: 0,
                revenue: 0,
                transactions: 0
              };
            }
            productStats[product.name].quantity += product.qty;
            productStats[product.name].transactions += 1;
            
            const totalQty = products.reduce((sum, p) => sum + p.qty, 0);
            const revenueForProduct = totalQty > 0 ? (entry.betrag * product.qty / totalQty) : 0;
            productStats[product.name].revenue += revenueForProduct;
          });
        }
      });
    }
  });
  
  const totalRevenue = Object.values(productStats).reduce((sum, p) => sum + p.revenue, 0);
  
  const sorted = Object.values(productStats)
    .map(p => ({
      ...p,
      revenue: Math.round(p.revenue * 100) / 100,
      percentage: totalRevenue > 0 ? Math.round((p.revenue / totalRevenue * 100) * 10) / 10 : 0,
      avgPrice: p.quantity > 0 ? Math.round((p.revenue / p.quantity) * 100) / 100 : 0
    }))
    .sort((a, b) => b.revenue - a.revenue);
  
  return {
    type: 'product_statistics',
    timestamp: new Date().toISOString(),
    period: period || 'custom',
    totalProducts: sorted.length,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    products: sorted
  };
}

function calculateTimeline(groupBy, startDate, endDate) {
  const salesData = filterSalesByDateRange(startDate, endDate);
  const dates = Object.keys(salesData).sort();
  
  if (dates.length === 0) {
    return {
      type: 'timeline',
      groupBy,
      data: []
    };
  }
  
  let grouped = {};
  
  if (groupBy === 'day') {
    dates.forEach(date => {
      grouped[date] = {
        period: date,
        revenue: salesData[date].total,
        transactions: salesData[date].entries.length
      };
    });
  } else if (groupBy === 'week') {
    dates.forEach(dateKey => {
      const date = new Date(dateKey);
      const weekStart = getWeekStart(date);
      const weekKey = getDateKey(weekStart);
      
      if (!grouped[weekKey]) {
        grouped[weekKey] = {
          period: `KW ${getWeekNumber(weekStart)} ${weekStart.getFullYear()}`,
          revenue: 0,
          transactions: 0
        };
      }
      grouped[weekKey].revenue += salesData[dateKey].total;
      grouped[weekKey].transactions += salesData[dateKey].entries.length;
    });
  } else if (groupBy === 'month') {
    dates.forEach(dateKey => {
      const date = new Date(dateKey);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!grouped[monthKey]) {
        grouped[monthKey] = {
          period: monthKey,
          revenue: 0,
          transactions: 0
        };
      }
      grouped[monthKey].revenue += salesData[dateKey].total;
      grouped[monthKey].transactions += salesData[dateKey].entries.length;
    });
  }
  
  const timeline = Object.keys(grouped).sort().map(key => ({
    ...grouped[key],
    revenue: Math.round(grouped[key].revenue * 100) / 100
  }));
  
  return {
    type: 'timeline',
    timestamp: new Date().toISOString(),
    groupBy,
    dateRange: {
      start: dates[0],
      end: dates[dates.length - 1]
    },
    data: timeline
  };
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

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
      const products = parseProductsFromGrund(entry.grund);
      products.forEach(product => {
        if (!productStats[product.name]) {
          productStats[product.name] = {
            name: product.name,
            quantity: 0,
            revenue: 0
          };
        }
        productStats[product.name].quantity += product.qty;
        const totalQty = products.reduce((sum, p) => sum + p.qty, 0);
        const revenueForProduct = totalQty > 0 ? (entry.betrag * product.qty / totalQty) : 0;
        productStats[product.name].revenue += revenueForProduct;
      });
    }
  });
  
  const totalRevenue = Object.values(productStats).reduce((sum, p) => sum + p.revenue, 0);
  
  const sortedProducts = Object.values(productStats)
    .map(p => ({
      ...p,
      revenue: Math.round(p.revenue * 100) / 100,
      percentage: totalRevenue > 0 ? (p.revenue / totalRevenue * 100).toFixed(1) : 0,
      trend: 'stable'
    }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);
  
  return {
    type: 'top_products_update',
    timestamp: new Date().toISOString(),
    period,
    products: sortedProducts,
    totalProducts: Object.keys(productStats).length,
    totalRevenue: Math.round(totalRevenue * 100) / 100
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
  console.log('🔌 Socket connected:', socket.id);
  
  // Sende initiale Daten
  socket.emit('config:update', DATA.config || {});
  socket.emit('sales:update', DATA.sales || {});
  socket.emit('products:update', DATA.products || {});
  socket.emit('settings:update', DATA.settings || {});
  socket.emit('calculator:init', DATA.calculatorStates || {});
  
  // Loyalty-Daten
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
  
  // Rush Hour & Top Products
  socket.emit('rush-hour:update', calculateRushHourData());
  socket.emit('top-products:update', calculateTopProducts('all'));
  
  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected:', socket.id);
  });
});

// Fallback für SPA
app.get('*', (req,res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   🎮 Play UP Server v1.8.0 FIXED         ║
  ║   🚀 Running on http://localhost:${PORT}   ║
  ║                                           ║
  ║   ✅ Vollständige Persistenz aktiv       ║
  ║   📊 Statistiken jetzt synchronisiert    ║
  ║   🔴 Live-Updates aktiviert              ║
  ║   🐛 Produkt-Tracking korrigiert         ║
  ╚═══════════════════════════════════════════╝
  `);
});