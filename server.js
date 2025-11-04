require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
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

// MongoDB Configuration
const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'playup_kassenblatt';
let db;
let client;

// Connect to MongoDB Atlas
async function connectToDatabase() {
  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db(dbName);
    
    console.log('✅ Erfolgreich mit MongoDB Atlas verbunden!');
    console.log(`📊 Datenbank: ${dbName}`);
    
    // Create indexes for performance
    await db.collection('sales').createIndex({ timestamp: -1 });
    await db.collection('sales').createIndex({ date: 1 });
    await db.collection('loyalty').createIndex({ name: 1 }, { unique: true });
    await db.collection('products').createIndex({ name: 1 }, { unique: true });
    
    // Load initial stats
    const salesCount = await db.collection('sales').countDocuments();
    const productsCount = await db.collection('products').countDocuments();
    const loyaltyCount = await db.collection('loyalty').countDocuments();
    
    console.log('📈 Datenbestand:');
    console.log(`   - Verkäufe: ${salesCount}`);
    console.log(`   - Produkte: ${productsCount}`);
    console.log(`   - Treuekunden: ${loyaltyCount}`);
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB Verbindungsfehler:', error);
    console.error('💡 Prüfe deine .env Datei und Connection String!');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await client.close();
    console.log('\n✅ MongoDB Verbindung geschlossen');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fehler beim Schließen:', error);
    process.exit(1);
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// SETTINGS / EINSTELLUNGEN
// ============================================

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await db.collection('settings').findOne({ type: 'app_settings' });
    res.json(settings?.data || {
      theme: 'PlayUp Farben',
      darkMode: false,
      welcomeShown: false,
      activeTab: 1
    });
  } catch (error) {
    console.error('Fehler beim Laden der Einstellungen:', error);
    res.status(500).json({ error: 'Fehler beim Laden' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    await db.collection('settings').updateOne(
      { type: 'app_settings' },
      { $set: { type: 'app_settings', data: req.body, updatedAt: new Date() } },
      { upsert: true }
    );
    
    io.emit('settings:update', req.body);
    res.json({ ok: true, settings: req.body });
  } catch (error) {
    console.error('Fehler beim Speichern der Einstellungen:', error);
    res.status(500).json({ error: 'Fehler beim Speichern' });
  }
});

// ============================================
// CALCULATOR STATES
// ============================================

app.get('/api/calculator-states', async (req, res) => {
  try {
    const states = await db.collection('calculator_states').findOne({ type: 'states' });
    res.json(states?.data || {});
  } catch (error) {
    console.error('Fehler beim Laden der Calculator States:', error);
    res.status(500).json({ error: 'Fehler beim Laden' });
  }
});

app.post('/api/calculator-states', async (req, res) => {
  try {
    const { tab, state } = req.body;
    if (!tab) return res.status(400).json({ error: 'Tab required' });
    
    // Load existing states
    const existing = await db.collection('calculator_states').findOne({ type: 'states' });
    const allStates = existing?.data || {};
    allStates[tab] = state;
    
    await db.collection('calculator_states').updateOne(
      { type: 'states' },
      { $set: { type: 'states', data: allStates, updatedAt: new Date() } },
      { upsert: true }
    );
    
    io.emit('calculator:update', { tab, state });
    res.json({ ok: true, calculatorStates: allStates });
  } catch (error) {
    console.error('Fehler beim Speichern des Calculator State:', error);
    res.status(500).json({ error: 'Fehler beim Speichern' });
  }
});

app.get('/api/calculator-states/:tab', async (req, res) => {
  try {
    const tab = req.params.tab;
    const states = await db.collection('calculator_states').findOne({ type: 'states' });
    res.json(states?.data?.[tab] || null);
  } catch (error) {
    console.error('Fehler beim Laden des Tab State:', error);
    res.status(500).json({ error: 'Fehler beim Laden' });
  }
});

// ============================================
// CONFIG
// ============================================

app.get('/api/config', async (req, res) => {
  try {
    const config = await db.collection('config').findOne({ type: 'app_config' });
    res.json(config?.data || {});
  } catch (error) {
    console.error('Fehler beim Laden der Config:', error);
    res.status(500).json({ error: 'Fehler beim Laden' });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    await db.collection('config').updateOne(
      { type: 'app_config' },
      { $set: { type: 'app_config', data: req.body || {}, updatedAt: new Date() } },
      { upsert: true }
    );
    
    io.emit('config:update', req.body || {});
    res.json({ ok: true });
  } catch (error) {
    console.error('Fehler beim Speichern der Config:', error);
    res.status(500).json({ error: 'Fehler beim Speichern' });
  }
});

// ============================================
// SALES / VERKÄUFE - KORRIGIERT v2.0
// ============================================

app.get('/api/sales', async (req, res) => {
  try {
    const sales = await db.collection('sales')
      .find({})
      .sort({ timestamp: -1 })
      .toArray();
    
    res.json(sales);
  } catch (error) {
    console.error('Fehler beim Abrufen der Verkäufe:', error);
    res.status(500).json({ error: 'Fehler beim Abrufen' });
  }
});

app.post('/api/sales/entry', async (req, res) => {
  try {
    const { grund, betrag, ts } = req.body || {};
    const time = new Date(ts || Date.now());
    const dateKey = getDateKey(time);

    console.log('📝 Neuer Verkauf:', { grund, betrag, dateKey });

    const amount = Number(betrag || 0);
    
    // Create sale document
    const sale = {
      grund,
      betrag: amount,
      date: dateKey,
      timestamp: time,
      hour: time.getHours()
    };
    
    const result = await db.collection('sales').insertOne(sale);
    
    // Parse products
    let productsUpdated = [];
    if (grund) {
      const products = parseProductsFromGrund(grund);
      console.log('🔍 Gefundene Produkte:', products);
      
      if (products.length > 0) {
        for (const product of products) {
          const productName = product.name;
          const quantity = product.qty;
          const totalQty = products.reduce((sum, p) => sum + p.qty, 0);
          const revenueForProduct = totalQty > 0 ? (amount * quantity / totalQty) : amount;
          
          await db.collection('products').updateOne(
            { name: productName },
            { 
              $inc: { 
                qty: quantity, 
                revenue: Math.round(revenueForProduct * 100) / 100 
              },
              $set: { updatedAt: new Date() }
            },
            { upsert: true }
          );
          
          productsUpdated.push({
            name: productName,
            qty: quantity,
            revenue: Math.round(revenueForProduct * 100) / 100
          });
          
          console.log(`  ✅ ${productName}: +${quantity}x, +${revenueForProduct.toFixed(2)}$`);
        }
      }
    }

    console.log('✅ Verkauf gespeichert:', {
      id: result.insertedId,
      date: dateKey,
      amount: amount,
      productsUpdated: productsUpdated.length
    });

    // Emit updates
    io.emit('sales:update', { sale: { ...sale, _id: result.insertedId } });
    io.emit('products:update');
    io.emit('rush-hour:update', await calculateRushHourData());
    io.emit('top-products:update', await calculateTopProducts('all'));

    res.json({
      ok: true,
      saleId: result.insertedId.toString(),
      sale,
      productsUpdated
    });
  } catch (error) {
    console.error('Fehler beim Speichern des Verkaufs:', error);
    res.status(500).json({ error: 'Fehler beim Speichern' });
  }
});

// ============================================
// ERWEITERTE STATISTIKEN
// ============================================

app.get('/api/statistics/overview', async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const stats = await calculateStatistics(period, startDate, endDate);
    res.json(stats);
  } catch (error) {
    console.error('Fehler bei Statistik-Übersicht:', error);
    res.status(500).json({ error: 'Fehler beim Berechnen' });
  }
});

app.get('/api/statistics/products', async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const stats = await calculateProductStatistics(period, startDate, endDate);
    res.json(stats);
  } catch (error) {
    console.error('Fehler bei Produkt-Statistiken:', error);
    res.status(500).json({ error: 'Fehler beim Berechnen' });
  }
});

app.get('/api/statistics/timeline', async (req, res) => {
  try {
    const { groupBy, startDate, endDate } = req.query;
    const timeline = await calculateTimeline(groupBy || 'week', startDate, endDate);
    res.json(timeline);
  } catch (error) {
    console.error('Fehler bei Timeline:', error);
    res.status(500).json({ error: 'Fehler beim Berechnen' });
  }
});

// ============================================
// PRODUCTS
// ============================================

app.get('/api/products', async (req, res) => {
  try {
    const products = await db.collection('products').find({}).toArray();
    const productsObj = {};
    products.forEach(p => {
      productsObj[p.name] = { qty: p.qty, revenue: p.revenue };
    });
    console.log('📊 Produkt-Anfrage - Aktuell:', products.length, 'Produkte');
    res.json(productsObj);
  } catch (error) {
    console.error('Fehler beim Abrufen der Produkte:', error);
    res.status(500).json({ error: 'Fehler beim Abrufen' });
  }
});

// ============================================
// LOYALTY / TREUEPUNKTE
// ============================================

app.get('/api/loyalty', async (req, res) => {
  try {
    const customers = await db.collection('loyalty').find({}).toArray();
    const loyaltyData = {};
    customers.forEach(c => {
      loyaltyData[c.name] = c.points;
    });
    res.json(loyaltyData);
  } catch (error) {
    console.error('Fehler beim Laden der Treuepunkte:', error);
    res.status(500).json({ error: 'Fehler beim Laden' });
  }
});

app.post('/api/loyalty', async (req, res) => {
  try {
    const { name, points } = req.body || {};
    if (!name) return res.status(400).json({ error: "Name required" });

    const pointsToAdd = Number(points || 0);
    
    const existing = await db.collection('loyalty').findOne({ name });
    const oldPoints = existing ? existing.points : 0;
    const newPoints = oldPoints + pointsToAdd;
    
    await db.collection('loyalty').updateOne(
      { name },
      { $set: { name, points: newPoints, updatedAt: new Date() } },
      { upsert: true }
    );

    const oldLevel = calculateLevelForPoints(oldPoints);
    const newLevel = calculateLevelForPoints(newPoints);

    const allCustomers = await db.collection('loyalty').find({}).toArray();
    
    const loyaltyUpdate = {
      type: 'loyalty_points_update',
      timestamp: new Date().toISOString(),
      action: 'add',
      customer: {
        name,
        points: newPoints,
        pointsChange: pointsToAdd,
        level: newLevel
      },
      allCustomers: allCustomers.map(c => ({
        name: c.name,
        points: c.points,
        level: calculateLevelForPoints(c.points)
      })),
      statistics: await calculateLoyaltyStatistics(),
      levelUp: oldLevel !== newLevel
    };

    io.emit('loyalty:update', loyaltyUpdate);

    res.json({ ok: true, loyalty: { [name]: newPoints }, update: loyaltyUpdate });
  } catch (error) {
    console.error('Fehler beim Hinzufügen von Punkten:', error);
    res.status(500).json({ error: 'Fehler beim Hinzufügen' });
  }
});

app.delete('/api/loyalty', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "Name required" });

    await db.collection('loyalty').deleteOne({ name });

    const allCustomers = await db.collection('loyalty').find({}).toArray();
    
    const loyaltyUpdate = {
      type: 'loyalty_points_update',
      timestamp: new Date().toISOString(),
      action: 'remove',
      customer: { name },
      allCustomers: allCustomers.map(c => ({
        name: c.name,
        points: c.points,
        level: calculateLevelForPoints(c.points)
      })),
      statistics: await calculateLoyaltyStatistics()
    };

    io.emit('loyalty:update', loyaltyUpdate);

    res.json({ ok: true });
  } catch (error) {
    console.error('Fehler beim Löschen:', error);
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

// ============================================
// RUSH HOUR ANALYSE
// ============================================

app.get('/api/rush-hour', async (req, res) => {
  try {
    const data = await calculateRushHourData();
    res.json(data);
  } catch (error) {
    console.error('Fehler bei Rush Hour:', error);
    res.status(500).json({ error: 'Fehler beim Berechnen' });
  }
});

// ============================================
// TOP PRODUKTE
// ============================================

app.get('/api/top-products', async (req, res) => {
  try {
    const period = req.query.period || 'all';
    const data = await calculateTopProducts(period);
    res.json(data);
  } catch (error) {
    console.error('Fehler bei Top Products:', error);
    res.status(500).json({ error: 'Fehler beim Berechnen' });
  }
});

// ============================================
// STATS LÖSCHEN
// ============================================

app.delete('/api/stats', async (req, res) => {
  try {
    const { scope } = req.body || {};
    
    let deletedCount = 0;
    
    console.log('🗑️ Lösche Statistiken:', scope);
    
    switch(scope) {
      case 'all':
        const salesResult = await db.collection('sales').deleteMany({});
        const productsResult = await db.collection('products').deleteMany({});
        deletedCount = salesResult.deletedCount + productsResult.deletedCount;
        console.log('  ✅ Alle Daten gelöscht');
        break;
        
      case 'products':
        const prodResult = await db.collection('products').deleteMany({});
        deletedCount = prodResult.deletedCount;
        console.log('  ✅ Produktstatistiken gelöscht');
        break;
        
      case 'today':
        const today = getTodayKey();
        const todayResult = await db.collection('sales').deleteMany({ date: today });
        deletedCount = todayResult.deletedCount;
        console.log('  ✅ Heutige Verkäufe gelöscht');
        break;
        
      case 'week':
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekResult = await db.collection('sales').deleteMany({ 
          timestamp: { $gte: weekAgo } 
        });
        deletedCount = weekResult.deletedCount;
        console.log('  ✅ Wöchentliche Verkäufe gelöscht');
        break;
        
      case 'month':
        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        const monthResult = await db.collection('sales').deleteMany({ 
          timestamp: { $gte: monthAgo } 
        });
        deletedCount = monthResult.deletedCount;
        console.log('  ✅ Monatliche Verkäufe gelöscht');
        break;
    }
    
    io.emit('stats:deleted', { scope, deletedCount, success: true });
    io.emit('sales:update');
    io.emit('products:update');
    
    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('Fehler beim Löschen:', error);
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseProductsFromGrund(grund) {
  const products = [];
  const regex = /(\d+)x\s*([^+|]+?)(?=\s*(?:\+|\||$))/gi;
  let match;
  
  while ((match = regex.exec(grund)) !== null) {
    const qty = parseInt(match[1]);
    const name = match[2].trim();
    
    if (name && 
        !name.match(/^\d{1,2}\.\d{1,2}\.?$/) &&
        !name.match(/^\d+P$/) &&
        !name.match(/^(Essen|Trinken|Coins|Sticker|Figuren)$/i) &&
        name.length > 1) {
      products.push({ name, qty });
    }
  }
  
  return products;
}

async function calculateStatistics(period, startDate, endDate) {
  const query = buildDateQuery(startDate, endDate);
  const sales = await db.collection('sales').find(query).sort({ date: 1 }).toArray();
  
  if (sales.length === 0) {
    return {
      totalRevenue: 0,
      totalTransactions: 0,
      averageTransaction: 0,
      totalDays: 0,
      averagePerDay: 0,
      dateRange: { start: null, end: null }
    };
  }
  
  const totalRevenue = sales.reduce((sum, s) => sum + s.betrag, 0);
  const dates = [...new Set(sales.map(s => s.date))];
  
  let bestDay = { date: null, revenue: 0 };
  let worstDay = { date: null, revenue: Infinity };
  
  const dailyTotals = {};
  sales.forEach(s => {
    if (!dailyTotals[s.date]) dailyTotals[s.date] = 0;
    dailyTotals[s.date] += s.betrag;
  });
  
  Object.entries(dailyTotals).forEach(([date, revenue]) => {
    if (revenue > bestDay.revenue) bestDay = { date, revenue };
    if (revenue < worstDay.revenue) worstDay = { date, revenue };
  });
  
  return {
    type: 'statistics_overview',
    timestamp: new Date().toISOString(),
    period: period || 'custom',
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalTransactions: sales.length,
    averageTransaction: Math.round((totalRevenue / sales.length) * 100) / 100,
    totalDays: dates.length,
    averagePerDay: Math.round((totalRevenue / dates.length) * 100) / 100,
    dateRange: {
      start: dates[0],
      end: dates[dates.length - 1]
    },
    bestDay: bestDay.date ? bestDay : null,
    worstDay: worstDay.revenue !== Infinity ? worstDay : null
  };
}

async function calculateProductStatistics(period, startDate, endDate) {
  const query = buildDateQuery(startDate, endDate);
  const sales = await db.collection('sales').find(query).toArray();
  
  const productStats = {};
  
  sales.forEach(sale => {
    if (sale.grund) {
      const products = parseProductsFromGrund(sale.grund);
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
        const revenueForProduct = totalQty > 0 ? (sale.betrag * product.qty / totalQty) : 0;
        productStats[product.name].revenue += revenueForProduct;
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

async function calculateTimeline(groupBy, startDate, endDate) {
  const query = buildDateQuery(startDate, endDate);
  const sales = await db.collection('sales').find(query).sort({ date: 1 }).toArray();
  
  if (sales.length === 0) {
    return { groupBy, data: [] };
  }
  
  const grouped = {};
  
  sales.forEach(sale => {
    let key;
    const date = new Date(sale.date);
    
    if (groupBy === 'day') {
      key = sale.date;
    } else if (groupBy === 'week') {
      const weekStart = getWeekStart(date);
      key = `KW ${getWeekNumber(weekStart)} ${weekStart.getFullYear()}`;
    } else if (groupBy === 'month') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }
    
    if (!grouped[key]) {
      grouped[key] = { period: key, revenue: 0, transactions: 0 };
    }
    grouped[key].revenue += sale.betrag;
    grouped[key].transactions += 1;
  });
  
  const timeline = Object.values(grouped).map(g => ({
    ...g,
    revenue: Math.round(g.revenue * 100) / 100
  }));
  
  return {
    type: 'timeline',
    timestamp: new Date().toISOString(),
    groupBy,
    dateRange: {
      start: sales[0].date,
      end: sales[sales.length - 1].date
    },
    data: timeline
  };
}

async function calculateRushHourData() {
  const sales = await db.collection('sales').find({}).toArray();
  const hourlyTotals = Array(24).fill(0);
  const hourlyCounts = Array(24).fill(0);
  
  sales.forEach(sale => {
    if (sale.hour !== undefined) {
      hourlyTotals[sale.hour] += sale.betrag;
      hourlyCounts[sale.hour] += 1;
    }
  });
  
  const topHours = hourlyTotals
    .map((revenue, hour) => ({ hour, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3);
  
  return {
    type: 'rush_hour_update',
    timestamp: new Date().toISOString(),
    hourlyData: hourlyTotals,
    hourlyCounts,
    topHours,
    currentHour: new Date().getHours(),
    currentHourRevenue: hourlyTotals[new Date().getHours()]
  };
}

async function calculateTopProducts(period) {
  let query = {};
  const now = new Date();
  
  switch(period) {
    case 'today':
      query.date = getTodayKey();
      break;
    case 'week':
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      query.timestamp = { $gte: weekAgo };
      break;
    case 'month':
      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 30);
      query.timestamp = { $gte: monthAgo };
      break;
  }
  
  const sales = await db.collection('sales').find(query).toArray();
  
  const productStats = {};
  sales.forEach(sale => {
    if (sale.grund) {
      const products = parseProductsFromGrund(sale.grund);
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
        const revenueForProduct = totalQty > 0 ? (sale.betrag * product.qty / totalQty) : 0;
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

async function calculateLoyaltyStatistics() {
  const customers = await db.collection('loyalty').find({}).toArray();
  const totalCustomers = customers.length;
  const totalPointsGiven = customers.reduce((sum, c) => sum + c.points, 0);
  const averagePoints = totalCustomers > 0 ? totalPointsGiven / totalCustomers : 0;
  
  const topCustomer = customers.length > 0
    ? customers.reduce((max, c) => 
        c.points > max.points ? c : max, 
        customers[0]
      )
    : null;
  
  return {
    totalCustomers,
    totalPointsGiven,
    averagePoints,
    topCustomer: topCustomer ? { name: topCustomer.name, points: topCustomer.points } : null
  };
}

function calculateLevelForPoints(points) {
  if (points >= 200) return 'Platinum';
  if (points >= 150) return 'Gold';
  if (points >= 75) return 'Silver';
  return 'Bronze';
}

function buildDateQuery(startDate, endDate) {
  const query = {};
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = startDate;
    if (endDate) query.date.$lte = endDate;
  }
  return query;
}

function getTodayKey() {
  return getDateKey(new Date());
}

function getDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
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

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
  try {
    await db.admin().ping();
    const salesCount = await db.collection('sales').countDocuments();
    res.json({ 
      status: 'ok', 
      database: 'connected',
      timestamp: new Date(),
      stats: {
        sales: salesCount
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      database: 'disconnected',
      error: error.message 
    });
  }
});

// ============================================
// SOCKET.IO
// ============================================

io.on('connection', async (socket) => {
  console.log('🔌 Socket connected:', socket.id);
  
  // Send initial data
  try {
    const config = await db.collection('config').findOne({ type: 'app_config' });
    socket.emit('config:update', config?.data || {});
    
    const settings = await db.collection('settings').findOne({ type: 'app_settings' });
    socket.emit('settings:update', settings?.data || {});
    
    const calcStates = await db.collection('calculator_states').findOne({ type: 'states' });
    socket.emit('calculator:init', calcStates?.data || {});
    
    // Products
    const products = await db.collection('products').find({}).toArray();
    const productsObj = {};
    products.forEach(p => {
      productsObj[p.name] = { qty: p.qty, revenue: p.revenue };
    });
    socket.emit('products:update', productsObj);
    
    // Loyalty
    const customers = await db.collection('loyalty').find({}).toArray();
    const loyaltyUpdate = {
      type: 'loyalty_points_update',
      timestamp: new Date().toISOString(),
      action: 'init',
      allCustomers: customers.map(c => ({
        name: c.name,
        points: c.points,
        level: calculateLevelForPoints(c.points)
      })),
      statistics: await calculateLoyaltyStatistics()
    };
    socket.emit('loyalty:update', loyaltyUpdate);
    
    // Rush Hour & Top Products
    socket.emit('rush-hour:update', await calculateRushHourData());
    socket.emit('top-products:update', await calculateTopProducts('all'));
    
  } catch (error) {
    console.error('Error sending initial data:', error);
  }
  
  socket.on('disconnect', () => {
    console.log('❌ Socket disconnected:', socket.id);
  });
});

// Fallback für SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

connectToDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`
  ╔═══════════════════════════════════════════╗
  ║   🎮 Play UP Server v2.0.0               ║
  ║   🚀 Running on http://localhost:${PORT}   ║
  ║                                           ║
  ║   ☁️  MongoDB Atlas verbunden            ║
  ║   📊 Alle Features aktiv                 ║
  ║   🔴 Live-Updates aktiviert              ║
  ║   ✅ Copy-Logik korrigiert               ║
  ╚═══════════════════════════════════════════╝
    `);
  });
}).catch(error => {
  console.error('❌ Server konnte nicht gestartet werden:', error);
  process.exit(1);
});