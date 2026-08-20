import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for PDF uploads

// Debug middleware - log all requests
app.use((req, res, next) => {
  next();
});

// Load environment variables for local development (.env.local wins for brand overrides)
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

// Import real API handlers (only import what exists)
import loginHandler from './api/login.js';
import brandConfigHandler from './api/brand-config.js';
import orgThemeHandler from './api/org-theme.js';
import phoneResourcesHandler from './api/phone-resources.js';
import notificationPreferencesHandler from './api/notifications/preferences.js';
import notificationTestHandler from './api/notifications/test.js';
import paymentsHandler from './api/payments.js';
import paymentCatalogHandler from './api/payment-catalog.js';
import convertPDFHandler from './api/documents/convert-pdf-to-json.js';
import convertDocHandler from './api/documents/convert-doc-to-images.js';
import measureFieldPositionsHandler from './api/documents/measure-field-positions.js';

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Development API server is running' });
});

app.get('/api/brand-config', async (req, res) => {
  try {
    await brandConfigHandler(req, res);
  } catch (error) {
    console.error('Brand config error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/api/org-theme', async (req, res) => {
  try {
    await orgThemeHandler(req, res);
  } catch (error) {
    console.error('Org theme error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.put('/api/org-theme', async (req, res) => {
  try {
    await orgThemeHandler(req, res);
  } catch (error) {
    console.error('Org theme error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/api/phone-resources', async (req, res) => {
  try {
    await phoneResourcesHandler(req, res);
  } catch (error) {
    console.error('Phone resources error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.put('/api/phone-resources', async (req, res) => {
  try {
    await phoneResourcesHandler(req, res);
  } catch (error) {
    console.error('Phone resources error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.delete('/api/phone-resources', async (req, res) => {
  try {
    await phoneResourcesHandler(req, res);
  } catch (error) {
    console.error('Phone resources error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/api/notifications/preferences', async (req, res) => {
  try {
    await notificationPreferencesHandler(req, res);
  } catch (error) {
    console.error('Notification preferences error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.put('/api/notifications/preferences', async (req, res) => {
  try {
    await notificationPreferencesHandler(req, res);
  } catch (error) {
    console.error('Notification preferences error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.post('/api/notifications/test', async (req, res) => {
  try {
    await notificationTestHandler(req, res);
  } catch (error) {
    console.error('Notification test error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/api/payments', async (req, res) => {
  try {
    await paymentsHandler(req, res);
  } catch (error) {
    console.error('Payments error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    await paymentsHandler(req, res);
  } catch (error) {
    console.error('Payments error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.put('/api/payments', async (req, res) => {
  try {
    await paymentsHandler(req, res);
  } catch (error) {
    console.error('Payments error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.get('/api/payment-catalog', async (req, res) => {
  try {
    await paymentCatalogHandler(req, res);
  } catch (error) {
    console.error('Payment catalog error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.post('/api/payment-catalog', async (req, res) => {
  try {
    await paymentCatalogHandler(req, res);
  } catch (error) {
    console.error('Payment catalog error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Real API routes - Convert Vercel serverless functions to Express routes
app.post('/api/login', async (req, res) => {
  try {
    await loginHandler(req, res);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// PDF to JSON conversion route
app.post('/api/documents/convert-pdf-to-json', async (req, res) => {
  try {
    await convertPDFHandler(req, res);
  } catch (error) {
    console.error('PDF conversion error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// DOC to images conversion route
app.post('/api/documents/convert-doc-to-images', async (req, res) => {
  try {
    await convertDocHandler(req, res);
  } catch (error) {
    console.error('DOC conversion error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Per-page blank position measurement (second pass after schema import)
app.post('/api/documents/measure-field-positions', async (req, res) => {
  try {
    await measureFieldPositionsHandler(req, res);
  } catch (error) {
    console.error('Measure field positions error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Catch-all route for debugging
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: `Route ${req.method} ${req.originalUrl} not found` 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Development API server running at http://localhost:${PORT}`);
});

export default app;
