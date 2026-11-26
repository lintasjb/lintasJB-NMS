/* lintasJB NMS — lisensi & pembayaran (harga kustom, QRIS, transfer, VA, e-wallet, retail) */
import express from 'express';
import QRCode from 'qrcode';
import { getDb, save } from '../lib/store.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { generateLicense, licenseStatus, PLANS } from '../lib/license.js';
import { pricingOf } from '../lib/pricing.js';
import { pushActivity } from '../lib/faults.js';
import { emitEvent } from '../lib/events.js';
import { randomToken } from '../lib/secret.js';
import {
  PAYMENT_METHODS,
  PRICE_SUGGESTIONS,
  billingConfig,
  buildQrisPayload,
  formatRupiah,
  invoiceNumber,
  methodById,
  methodFee,
  orderCode,
  paymentInstructions,
  roundRupiah,
} from '../lib/billing.js';
import { asyncHandler, clampNumber, cleanText, httpError, requireFields } from './helpers.js';

const router = express.Router();

const isAdmin = (user) => ['superadmin', 'admin'].includes(user?.role);
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;

function refreshStatus(order) {
  if (order.status === 'pending' && order.expiresAt && new Date(order.expiresAt).getTime() < Date.now()) {
    order.status = 'expired';
  }
  return order;
}

function serialize(db, order, user) {
  refreshStatus(order);
  const method = methodById(order.method);
  const config = billingConfig(db.settings);
  const canManage = isAdmin(user);
  const payment = {
    code: order.payment?.code || null,
    qr: method?.id === 'qris',
  };
  return {
    id: order.id,
    invoiceNo: order.invoiceNo,
    projectId: order.projectId,
    userId: order.userId,
    customer: order.customer,
    email: order.email,
    phone: order.phone,
    plan: order.plan,
    planLabel: PLANS[order.plan]?.label || order.plan,
    months: order.months,
    maxNodes: order.maxNodes,
    subtotal: order.subtotal,
    subtotalLabel: formatRupiah(order.subtotal),
    fee: order.fee,
    feeLabel: formatRupiah(order.fee),
    total: order.total,
    totalLabel: formatRupiah(order.total),
    method: order.method,
    methodLabel: method?.label || order.method,
    methodGroup: method?.group || 'Lainnya',
    status: order.status,
    createdAt: order.createdAt,
    expiresAt: order.expiresAt,
    paidAt: order.paidAt,
    licenseId: order.licenseId || null,
    licenseKey: canManage ? order.licenseKey || null : null,
    notes: order.notes || '',
    payment,
    instructions: paymentInstructions({ method, order, config }),
    config: {
      merchantName: config.merchantName,
      merchantCity: config.merchantCity,
      supportEmail: config.supportEmail,
      supportPhone: config.supportPhone,
      accounts: config.accounts,
      ewalletNumber: config.ewalletNumber,
      note: config.note,
    },
  };
}

router.get(
  '/billing/config',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const pricing = pricingOf(db.settings);
    const merged = new Map(
      Object.entries(PLANS).map(([id, plan]) => [
        id,
        { id, label: plan.label, maxNodes: plan.maxNodes, months: plan.months, monthly: null, yearly: null, currency: 'IDR' },
      ])
    );
    for (const item of pricing.plans) {
      const base = merged.get(item.id) || { id: item.id, months: 12, currency: 'IDR' };
      merged.set(item.id, {
        ...base,
        label: item.name || base.label,
        maxNodes: item.maxNodes,
        monthly: item.monthly,
        yearly: item.yearly,
        currency: 'IDR',
      });
    }
    const plans = [...merged.values()];
    const priceSuggestions = Object.fromEntries(
      plans.map((p) => [p.id, p.yearly || p.monthly || 0]).filter(([, value]) => value > 0)
    );
    res.json({
      methods: PAYMENT_METHODS,
      config: billingConfig(db.settings),
      priceSuggestions: Object.keys(priceSuggestions).length ? priceSuggestions : PRICE_SUGGESTIONS,
      plans,
      orders: (db.orders || [])
        .filter((o) => isAdmin(req.user) || o.userId === req.user.id)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 10)
        .map((o) => serialize(db, o, req.user)),
    });
  })
);

router.put(
  '/billing/config',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const body = req.body || {};
    const current = billingConfig(db.settings);
    const accounts = { ...current.accounts };
    if (body.accounts && typeof body.accounts === 'object') {
      for (const [key, value] of Object.entries(body.accounts)) {
        if (!['bca', 'bni', 'bri', 'mandiri'].includes(key) || !value || typeof value !== 'object') continue;
        accounts[key] = {
          number: cleanText(value.number, 40) || accounts[key].number,
          holder: cleanText(value.holder, 120) || accounts[key].holder,
        };
      }
    }
    db.settings.billing = {
      merchantName: cleanText(body.merchantName, 120) || current.merchantName,
      merchantCity: cleanText(body.merchantCity, 60) || current.merchantCity,
      merchantId: cleanText(body.merchantId, 40) || current.merchantId,
      supportEmail: cleanText(body.supportEmail, 120) || current.supportEmail,
      supportPhone: cleanText(body.supportPhone, 40) || current.supportPhone,
      ewalletNumber: cleanText(body.ewalletNumber, 40) || current.ewalletNumber,
      note: cleanText(body.note, 300) || current.note,
      accounts,
    };
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      action: 'billing.config',
      detail: 'Memperbarui data merchant & rekening pembayaran.',
    });
    save();
    res.json({ ok: true, config: billingConfig(db.settings), message: 'Data pembayaran disimpan.' });
  })
);

router.get(
  '/billing/orders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const projectId = String(req.query.projectId || '').trim();
    const orders = (db.orders || [])
      .filter((o) => (isAdmin(req.user) || o.userId === req.user.id))
      .filter((o) => !projectId || o.projectId === projectId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 50)
      .map((o) => serialize(db, o, req.user));
    res.json({ orders });
  })
);

router.post(
  '/billing/orders',
  requireAuth,
  requireRole('superadmin', 'admin', 'operator'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    requireFields(req.body, ['customer', 'email', 'method']);
    const method = methodById(String(req.body.method));
    if (!method) throw httpError(400, 'Metode pembayaran tidak dikenali.');
    const plan = PLANS[req.body.plan] ? String(req.body.plan) : 'professional';
    const months = clampNumber(req.body.months, 1, 120, PLANS[plan].months);
    const maxNodes = clampNumber(req.body.maxNodes, 1, 100000, PLANS[plan].maxNodes);
    const amount = roundRupiah(req.body.amount);
    if (amount < 10000) throw httpError(400, 'Harga minimal Rp 10.000.');
    if (amount > 1000000000) throw httpError(400, 'Harga maksimal Rp 1.000.000.000.');
    const subtotal = amount;
    const fee = methodFee(method, subtotal);
    const total = subtotal + fee;
    const now = new Date();
    const expires = new Date(now.getTime() + ORDER_TTL_MS);
    const order = {
      id: `ord_${randomToken(8)}`,
      invoiceNo: invoiceNumber(db),
      projectId: req.body.projectId || db.projects[0]?.id || null,
      userId: req.user.id,
      userName: req.user.name,
      customer: cleanText(req.body.customer, 120),
      email: cleanText(req.body.email, 160),
      phone: cleanText(req.body.phone, 40),
      plan,
      months,
      maxNodes,
      subtotal,
      fee,
      total,
      method: method.id,
      status: 'pending',
      notes: cleanText(req.body.notes, 400),
      payment: { code: orderCode(method) },
      activate: req.body.activate !== false,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };
    db.orders.push(order);
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: order.projectId,
      action: 'billing.order',
      detail: `Tagihan ${order.invoiceNo} · ${formatRupiah(total)} · ${method.label}.`,
    });
    save();
    emitEvent('billing', { order: { id: order.id, invoiceNo: order.invoiceNo, status: order.status }, actorId: req.user.id });
    res.status(201).json({
      order: serialize(db, order, req.user),
      message: `Tagihan ${order.invoiceNo} berhasil dibuat.`,
    });
  })
);

router.get(
  '/billing/orders/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const order = (db.orders || []).find((o) => o.id === req.params.id);
    if (!order) throw httpError(404, 'Tagihan tidak ditemukan.');
    if (!isAdmin(req.user) && order.userId !== req.user.id) throw httpError(403, 'Anda tidak memiliki akses ke tagihan ini.');
    res.json({ order: serialize(db, order, req.user) });
  })
);

router.get(
  '/billing/orders/:id/qr.png',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const order = (db.orders || []).find((o) => o.id === req.params.id);
    if (!order) throw httpError(404, 'Tagihan tidak ditemukan.');
    if (!isAdmin(req.user) && order.userId !== req.user.id) throw httpError(403, 'Anda tidak memiliki akses ke tagihan ini.');
    if (order.method !== 'qris') throw httpError(400, 'Tagihan ini bukan pembayaran QRIS.');
    const config = billingConfig(db.settings);
    const payload = buildQrisPayload({
      merchantName: config.merchantName,
      merchantCity: config.merchantCity,
      merchantId: config.merchantId,
      amount: order.total,
      invoiceNo: order.invoiceNo,
    });
    const png = await QRCode.toBuffer(payload, {
      type: 'png',
      width: 360,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1220', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(png);
  })
);

router.post(
  '/billing/orders/:id/pay',
  requireAuth,
  requireRole('superadmin', 'admin'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const order = (db.orders || []).find((o) => o.id === req.params.id);
    if (!order) throw httpError(404, 'Tagihan tidak ditemukan.');
    refreshStatus(order);
    if (order.status === 'paid') throw httpError(409, 'Tagihan ini sudah dibayar.');
    if (order.status === 'cancelled') throw httpError(409, 'Tagihan sudah dibatalkan.');
    if (order.status === 'expired') throw httpError(409, 'Tagihan sudah kedaluwarsa. Buat tagihan baru.');

    const generated = generateLicense({
      customer: order.customer,
      plan: order.plan,
      months: order.months,
      maxNodes: order.maxNodes,
    });
    const activate = req.body?.activate !== false && order.activate !== false;
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    order.paidBy = req.user.id;
    order.licenseId = generated.license.id;
    order.licenseKey = generated.key;
    if (activate) {
      db.license = { ...generated.license, key: generated.key };
    }
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: order.projectId,
      action: 'billing.paid',
      detail: `Pembayaran ${order.invoiceNo} (${formatRupiah(order.total)}) diverifikasi.`,
    });
    save();
    emitEvent('billing', { order: { id: order.id, invoiceNo: order.invoiceNo, status: order.status }, actorId: req.user.id });
    if (activate) emitEvent('license', { license: licenseStatus(db.license, db.nodes.length) });
    res.json({
      order: serialize(db, order, req.user),
      key: generated.key,
      license: generated.license,
      active: activate ? licenseStatus(db.license, db.nodes.length) : null,
      message: activate
        ? 'Pembayaran diverifikasi dan lisensi langsung diaktifkan.'
        : 'Pembayaran diverifikasi. Kunci lisensi siap diaktivasi manual.',
    });
  })
);

router.post(
  '/billing/orders/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const order = (db.orders || []).find((o) => o.id === req.params.id);
    if (!order) throw httpError(404, 'Tagihan tidak ditemukan.');
    if (!isAdmin(req.user) && order.userId !== req.user.id) throw httpError(403, 'Anda tidak memiliki akses ke tagihan ini.');
    refreshStatus(order);
    if (order.status === 'paid') throw httpError(409, 'Tagihan yang sudah dibayar tidak dapat dibatalkan.');
    if (order.status !== 'pending') throw httpError(409, 'Tagihan ini sudah tidak aktif.');
    order.status = 'cancelled';
    order.cancelledAt = new Date().toISOString();
    order.cancelledBy = req.user.id;
    pushActivity(db, {
      userId: req.user.id,
      userName: req.user.name,
      projectId: order.projectId,
      action: 'billing.cancel',
      detail: `Tagihan ${order.invoiceNo} dibatalkan.`,
    });
    save();
    emitEvent('billing', { order: { id: order.id, invoiceNo: order.invoiceNo, status: order.status }, actorId: req.user.id });
    res.json({ order: serialize(db, order, req.user), message: 'Tagihan dibatalkan.' });
  })
);

export default router;
