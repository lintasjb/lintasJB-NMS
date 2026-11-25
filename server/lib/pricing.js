/* =============================================================================
 * lintasJB NMS — daftar harga & paket (mata uang Rupiah)
 * Hanya superadmin yang boleh mengubah nilai ini (lihat routes/admin.js).
 * ========================================================================== */

export const DEFAULT_PRICING = {
  currency: 'IDR',
  updatedAt: null,
  plans: [
    {
      id: 'trial',
      name: 'Trial',
      monthly: 0,
      yearly: 0,
      maxNodes: 200,
      note: 'Uji coba 1 bulan, maksimal 200 node.',
    },
    {
      id: 'starter',
      name: 'Starter',
      monthly: 450000,
      yearly: 4500000,
      maxNodes: 300,
      note: 'Untuk jaringan FTTH skala kecil.',
    },
    {
      id: 'professional',
      name: 'Professional',
      monthly: 1200000,
      yearly: 12000000,
      maxNodes: 2500,
      note: 'Untuk ISP regional dengan ribuan ONT.',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      monthly: 3500000,
      yearly: 35000000,
      maxNodes: 100000,
      note: 'Untuk operator besar & multi-project.',
    },
  ],
};

function slugify(value, fallback) {
  const slug = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return slug || fallback;
}

function money(value) {
  const n = Math.round(Number(value) || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1_000_000_000, n);
}

/** Rapikan struktur harga agar selalu aman dipakai UI maupun API. */
export function normalizePricing(value) {
  const src = value && typeof value === 'object' ? value : {};
  const source = Array.isArray(src.plans) && src.plans.length ? src.plans : DEFAULT_PRICING.plans;
  const used = new Set();
  const plans = source.slice(0, 12).map((plan, index) => {
    let id = slugify(plan?.id || plan?.name, `plan-${index + 1}`);
    while (used.has(id)) id = `${id}-${index + 1}`;
    used.add(id);
    return {
      id,
      name: String(plan?.name || `Paket ${index + 1}`).slice(0, 40),
      monthly: money(plan?.monthly),
      yearly: money(plan?.yearly),
      maxNodes: Math.min(1_000_000, Math.round(Number(plan?.maxNodes) || 0)),
      note: String(plan?.note || '').slice(0, 140),
    };
  });
  return {
    currency: 'IDR',
    updatedAt: src.updatedAt || null,
    plans,
  };
}

export function pricingOf(settings) {
  return normalizePricing(settings?.pricing || DEFAULT_PRICING);
}
