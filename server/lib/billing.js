/* lintasJB NMS — billing helpers (lisensi, harga kustom, metode pembayaran) */
import { randomToken } from './secret.js';

/** Metode pembayaran yang didukung. Fee dihitung di server agar total konsisten. */
export const PAYMENT_METHODS = [
  {
    id: 'qris',
    label: 'QRIS',
    group: 'QRIS',
    icon: 'qris',
    feeType: 'percent',
    feeValue: 0.7,
    description: 'Satu QR untuk semua bank dan e-wallet.',
  },
  {
    id: 'bca',
    label: 'Transfer BCA',
    group: 'Transfer Bank',
    icon: 'building',
    feeType: 'flat',
    feeValue: 0,
    account: 'bca',
  },
  {
    id: 'bni',
    label: 'Transfer BNI',
    group: 'Transfer Bank',
    icon: 'building',
    feeType: 'flat',
    feeValue: 0,
    account: 'bni',
  },
  {
    id: 'bri',
    label: 'Transfer BRI',
    group: 'Transfer Bank',
    icon: 'building',
    feeType: 'flat',
    feeValue: 0,
    account: 'bri',
  },
  {
    id: 'mandiri',
    label: 'Transfer Mandiri',
    group: 'Transfer Bank',
    icon: 'building',
    feeType: 'flat',
    feeValue: 0,
    account: 'mandiri',
  },
  {
    id: 'va_bca',
    label: 'Virtual Account BCA',
    group: 'Virtual Account',
    icon: 'credit-card',
    feeType: 'flat',
    feeValue: 4000,
    vaPrefix: '8808',
  },
  {
    id: 'va_bni',
    label: 'Virtual Account BNI',
    group: 'Virtual Account',
    icon: 'credit-card',
    feeType: 'flat',
    feeValue: 4000,
    vaPrefix: '8818',
  },
  {
    id: 'va_mandiri',
    label: 'Virtual Account Mandiri',
    group: 'Virtual Account',
    icon: 'credit-card',
    feeType: 'flat',
    feeValue: 4000,
    vaPrefix: '8828',
  },
  {
    id: 'gopay',
    label: 'GoPay',
    group: 'E-Wallet',
    icon: 'wallet',
    feeType: 'percent',
    feeValue: 1.5,
  },
  {
    id: 'ovo',
    label: 'OVO',
    group: 'E-Wallet',
    icon: 'wallet',
    feeType: 'percent',
    feeValue: 1.5,
  },
  {
    id: 'dana',
    label: 'DANA',
    group: 'E-Wallet',
    icon: 'wallet',
    feeType: 'percent',
    feeValue: 1.5,
  },
  {
    id: 'shopeepay',
    label: 'ShopeePay',
    group: 'E-Wallet',
    icon: 'wallet',
    feeType: 'percent',
    feeValue: 1.5,
  },
  {
    id: 'alfamart',
    label: 'Alfamart',
    group: 'Gerai Retail',
    icon: 'store',
    feeType: 'flat',
    feeValue: 5000,
  },
  {
    id: 'indomaret',
    label: 'Indomaret',
    group: 'Gerai Retail',
    icon: 'store',
    feeType: 'flat',
    feeValue: 5000,
  },
];

export const DEFAULT_BILLING = {
  merchantName: 'DIKI PRISKI',
  merchantCity: 'Kuningan',
  merchantId: 'ID1023289176993',
  supportEmail: 'kmskuningannet@gmail.com',
  supportPhone: '0838-2454-0083',
  ewalletNumber: '0838-2454-0083',
  accounts: {
    bca: { number: 'saat ini tidak tersedia', holder: 'PT Lintas Jaringan Bersama' },
    bni: { number: '2020214867', holder: 'DIKI PRISKI' },
    bri: { number: '427501033415534', holder: 'DIKI PRISKI' },
    mandiri: { number: '1340026200161', holder: 'DIKI PRISKI' },
  },
  note: 'Pembayaran diverifikasi manual oleh tim billing. Untuk integrasi payment gateway otomatis, hubungi tim lintasJB.',
};

export const PRICE_SUGGESTIONS = {
  starter: 4500000,
  professional: 12000000,
  enterprise: 35000000,
  trial: 0,
};

export function billingConfig(settings) {
  const s = settings?.billing || {};
  return {
    ...DEFAULT_BILLING,
    ...s,
    accounts: { ...DEFAULT_BILLING.accounts, ...(s.accounts || {}) },
    note: s.note || DEFAULT_BILLING.note,
  };
}

export function methodById(id) {
  return PAYMENT_METHODS.find((m) => m.id === id) || null;
}

export function roundRupiah(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

export function methodFee(method, subtotal) {
  if (!method) return 0;
  if (method.feeType === 'percent') {
    return roundRupiah((Number(subtotal) * Number(method.feeValue)) / 100);
  }
  return roundRupiah(method.feeValue);
}

export function formatRupiah(value) {
  return `Rp ${roundRupiah(value).toLocaleString('id-ID')}`;
}

export function invoiceNumber(db) {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const seq = (db.orders || []).filter((o) => String(o.invoiceNo || '').includes(`/INV/${ym}/`)).length + 1;
  return `LJB/INV/${ym}/${String(seq).padStart(4, '0')}`;
}

export function orderCode(method) {
  const digits = () => String(Math.floor(Math.random() * 10));
  const block = (n) => Array.from({ length: n }, digits).join('');
  if (method?.id?.startsWith('va_')) return `${method.vaPrefix}${block(10)}`;
  if (method?.group === 'Gerai Retail') return `LJB${block(11)}`;
  return `LJB-${randomToken(5).toUpperCase()}`;
}

/* ------------------------------------------------------------------ QRIS */

function tlv(id, value) {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(input) {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Membuat payload QRIS bergaya EMVCo (mode demo). Nominal terkunci sesuai tagihan
 * sehingga pelanggan tidak perlu mengetik ulang saat memindai.
 */
export function buildQrisPayload({ merchantName, merchantCity, merchantId, amount, invoiceNo }) {
  const name = String(merchantName || 'lintasJB').slice(0, 25);
  const city = String(merchantCity || 'Kuningan').slice(0, 15);
  const account = tlv('00', 'ID.CO.QRIS.DEMO.WWW');
  const merchant = tlv('01', '936000000000000001') + tlv('02', String(merchantId || 'ID1023289176993').slice(0, 25)) + tlv('03', 'UMI');
  const payload =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('26', account + merchant) +
    tlv('52', '5812') +
    tlv('53', '360') +
    tlv('54', String(Math.round(Number(amount) || 0))) +
    tlv('58', 'ID') +
    tlv('59', name) +
    tlv('60', city) +
    tlv('62', tlv('05', String(invoiceNo || '').slice(-20))) +
    '6304';
  return `${payload}${crc16(payload)}`;
}

/* ------------------------------------------------------------ instructions */

export function paymentInstructions({ method, order, config }) {
  const total = formatRupiah(order.total);
  const invoice = order.invoiceNo;
  const note = config.note;
  const base = [`Nominal harus tepat ${total}.`, `Cantumkan kode ${invoice} pada keterangan pembayaran.`];
  if (!method) return base;
  if (method.id === 'qris') {
    return [
      'Buka aplikasi mobile banking atau e-wallet apa pun yang mendukung QRIS.',
      'Pilih menu Scan QRIS, lalu pindai kode QR pada halaman ini.',
      `Nominal ${total} sudah terisi otomatis. Periksa nama merchant sebelum membayar.`,
      'Simpan bukti pembayaran; admin akan memverifikasi dan mengaktifkan lisensi.',
      note,
    ];
  }
  if (method.account) {
    const acc = config.accounts?.[method.account] || {};
    return [
      `Transfer ${total} ke rekening ${method.label.replace('Transfer ', '')} ${acc.number || '—'} a.n. ${acc.holder || config.merchantName}.`,
      ...base.slice(1),
      note,
    ];
  }
  if (method.id.startsWith('va_')) {
    return [
      `Buka m-banking / e-wallet, pilih menu Virtual Account ${method.label.replace('Virtual Account ', '')}.`,
      `Masukkan nomor VA ${order.payment.code}.`,
      `Bayar sesuai nominal ${total}.`,
      ...base.slice(1),
      note,
    ];
  }
  if (method.group === 'E-Wallet') {
    return [
      `Buka aplikasi ${method.label} dan pilih Kirim / Transfer.`,
      `Kirim ${total} ke nomor ${config.ewalletNumber}.`,
      ...base.slice(1),
      note,
    ];
  }
  if (method.group === 'Gerai Retail') {
    return [
      `Datang ke kasir ${method.label} terdekat.`,
      `Sebutkan kode pembayaran ${order.payment.code}.`,
      `Bayar ${total} dan simpan struk.`,
      note,
    ];
  }
  return [...base, note];
}
