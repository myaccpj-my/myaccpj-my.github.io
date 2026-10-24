/* =========================================================
   UPLOAD FOTO TOKO
   - Foto dikompres + diberi watermark di browser sebelum dikirim
   - Hasil foto disimpan ke Google Drive
   - Spreadsheet "UPLOAD FOTO":
       WAKTU UPLOAD | KODE TOKO | NAMA SITE | LINK GAMBAR | SHIFT | STATUS
     STATUS = TEPAT WAKTU / TERLAMBAT (dihitung dari jadwal toko)
   - Panel "Status Hari Ini" membaca sheet UPLOAD FOTO,
     jadi bisa menampilkan hari-hari sebelumnya juga.
========================================================= */

/* =========================================================
   KONFIGURASI  -->  EDIT DI SINI
========================================================= */

const UPLOAD_CFG = Object.freeze({
  SPREADSHEET_ID: '15RPBu77rKCrTEp9l-6d5YX3qL-1ik-r1X77rYcSUa-M',
  SHEET_NAME: 'UPLOAD FOTO',
  FOLDER_NAME: 'UPLOAD FOTO TOKO',
  FOLDER_PROP_KEY: 'UPLOAD_FOLDER_ID',
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  MAX_COMPRESSED_BYTES: 500 * 1024,
  LOCK_WAIT_MS: 30000,

  // Perlindungan karena web app dibuka ANYONE_ANONYMOUS
  RATE_LIMIT_WINDOW_SEC: 60,   // jendela waktu hitung upload
  RATE_LIMIT_PER_STORE: 6,     // maks upload per toko per jendela
  RATE_LIMIT_GLOBAL: 40,       // maks upload semua toko per jendela
  DUPLICATE_WINDOW_SEC: 120,   // foto identik (toko+shift) ditolak selama ini

  // ---- KETEPATAN WAKTU ----
  // Toleransi (menit) setelah jadwal. Lewat dari ini = TERLAMBAT.
  TOLERANCE_OPENING_MIN: 15,   // OPENING: jadwal + 15 menit
  TOLERANCE_CLOSING_MIN: 60,   // CLOSING: jadwal + 60 menit

  TIME_ZONE: 'Asia/Jakarta',
  TZ_OFFSET_HOURS: 7,          // harus sesuai TIME_ZONE (dipakai membaca tanggal berbentuk teks)

  // "Hari" dihitung mulai jam ini. Upload closing setelah tengah malam
  // (sebelum jam ini) tetap dihitung sebagai hari sebelumnya.
  DAY_START_HOUR: 7,

  // ---- PANEL STATUS ----
  STATUS_HISTORY_DAYS: 30,     // berapa hari ke belakang yang bisa dilihat
  LOG_READ_ROWS: 3000,         // jumlah baris terakhir sheet yang dibaca
  STATUS_CACHE_PREFIX: 'status_',
  STATUS_CACHE_SEC: 60,        // cache hari ini
  STATUS_PAST_CACHE_SEC: 600,  // cache hari-hari sebelumnya
  THUMB_CACHE_SEC: 21600,
  MAX_PREVIEW_BYTES: 2 * 1024 * 1024,

  // Bentuk link foto yang ditulis ke kolom LINK GAMBAR:
  //   'thumbnail' = link gambar langsung (tampil di browser HP, tidak layar hitam)
  //   'viewer'    = halaman viewer Google Drive biasa
  PHOTO_LINK_STYLE: 'thumbnail'
});

const UPLOAD_STORES = Object.freeze({
  F780: 'CHATIME AZKO KUDUS',
  F359: 'CHATIME MALL CIPUTRA SEMARANG',
  F431: 'CHATIME AZKO MAJAPAHIT',
  F471: 'CHATIME AZKO SILIWANGI',
  F514: 'CHATIME TRANS SRONDOL',
  F589: 'CHATIME PARAGON SEMARANG',
  F644: 'CHATIME DP MALL SEMARANG',
  F651: 'CHATIME JAVA MALL SEMARANG',
  F754: 'CHATIME QUEEN CITY MALL',
  F33F: 'CHATIME RUKO TEMBALANG',
  F33G: 'CHATIME RUKO PAMULARSIH',
  F33T: 'CHATIME SUPERINDO KEDUNGMUNDU',
  F37C: 'CHATIME KIOS NGALIYAN',
  F559: 'CHATIME PASIFIC MALL TEGAL',
  F32D: 'CHATIME YOGYA SLAWI',
  F37F: 'CHATIME BREBES MALL',
  F34Q: 'CHATIME TRANS PEKALONGAN',
  F36W: 'CHATIME 23 SEMARANG MALL',
  F37T: 'CHATIME GOORI DEMAK',
  F33A: 'CHATIME AZKO JEPARA PEMUDA'
});

// JADWAL TOKO (format jam "HH:mm", 24 jam). Ubah di sini bila jadwal berubah.
const UPLOAD_SCHEDULE = Object.freeze({
  F780: { open: '09:00', close: '21:30' },
  F359: { open: '10:00', close: '22:00' },
  F431: { open: '09:00', close: '23:00' },
  F471: { open: '09:00', close: '22:00' },
  F514: { open: '10:00', close: '21:30' },
  F589: { open: '10:00', close: '22:00' },
  F644: { open: '10:00', close: '22:00' },
  F651: { open: '10:00', close: '21:30' },
  F754: { open: '10:00', close: '22:00' },
  F33F: { open: '08:00', close: '23:00' },
  F33G: { open: '08:00', close: '22:00' },
  F33T: { open: '08:30', close: '21:30' },
  F37C: { open: '09:00', close: '22:00' },
  F559: { open: '10:00', close: '22:00' },
  F32D: { open: '08:00', close: '21:30' },
  F37F: { open: '09:00', close: '21:30' },
  F34Q: { open: '10:00', close: '22:00' },
  F36W: { open: '10:00', close: '22:00' },
  F37T: { open: '08:30', close: '21:30' },
  F33A: { open: '09:00', close: '22:00' }
});

const UPLOAD_HEADERS = Object.freeze([
  'WAKTU UPLOAD',
  'KODE TOKO',
  'NAMA SITE',
  'LINK GAMBAR',
  'SHIFT',
  'STATUS'
]);

const UPLOAD_DATE_FORMAT = 'dd/MM/yyyy HH:mm:ss';

/* =========================================================
   WEB APP
========================================================= */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('UPLOAD FOTO TOKO')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getUploadStores() {
  return Object.keys(UPLOAD_STORES)
    .sort()
    .map(function(code) {
      const sched = UPLOAD_SCHEDULE[code] || {};
      return {
        code: code,
        name: UPLOAD_STORES[code],
        open: sched.open || '',
        close: sched.close || ''
      };
    });
}

/**
 * Jalankan sekali dari editor Apps Script.
 * Membuat folder Drive dan memastikan header tersedia.
 * Tidak menghapus data lama.
 */
function setupUploadFoto() {
  const sheet = getUploadSheet_();

  sheet.setFrozenRows(1);
  sheet.getRange('A:A').setNumberFormat(UPLOAD_DATE_FORMAT);
  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 270);
  sheet.setColumnWidth(4, 180);
  sheet.setColumnWidth(5, 120);
  sheet.setColumnWidth(6, 140);

  getOrCreateUploadFolder_(true);

  return 'Setup berhasil. Folder Drive dan header sudah siap.';
}

function testUploadConfig() {
  const ss = SpreadsheetApp.openById(UPLOAD_CFG.SPREADSHEET_ID);
  const folder = getOrCreateUploadFolder_(true);

  const noSchedule = Object.keys(UPLOAD_STORES).filter(function(code) {
    return !UPLOAD_SCHEDULE[code];
  });

  return {
    spreadsheet: ss.getName(),
    sheet: UPLOAD_CFG.SHEET_NAME,
    folder: folder.getName(),
    stores: Object.keys(UPLOAD_STORES).length,
    tokoTanpaJadwal: noSchedule
  };
}

/** Hapus cache ID folder (pakai jika folder Drive dipindah / diganti). */
function resetFolderCache() {
  PropertiesService.getScriptProperties()
    .deleteProperty(UPLOAD_CFG.FOLDER_PROP_KEY);

  return 'Cache folder dihapus. Upload berikutnya akan mencari folder lagi.';
}

/* =========================================================
   HELPER: SPREADSHEET
========================================================= */

/** Ambil sheet upload (buat jika belum ada) dan pastikan header benar. */
function getUploadSheet_() {
  const ss = SpreadsheetApp.openById(UPLOAD_CFG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(UPLOAD_CFG.SHEET_NAME);
  let created = false;

  if (!sheet) {
    sheet = ss.insertSheet(UPLOAD_CFG.SHEET_NAME);
    created = true;
  }

  // Cek header hanya sekali per 10 menit (hemat panggilan ke Spreadsheet).
  let headerOk = false;
  const cache = CacheService.getScriptCache();

  try {
    headerOk = !created && cache.get('upload_headers_ok') === '1';
  } catch (e) {}

  if (!headerOk) {
    ensureUploadHeaders_(sheet);

    try {
      cache.put('upload_headers_ok', '1', 600);
    } catch (e) {}
  }

  return sheet;
}

/** Tulis header hanya jika belum sesuai (tidak menimpa tanpa perlu). */
function ensureUploadHeaders_(sheet) {
  const cols = UPLOAD_HEADERS.length;

  if (sheet.getMaxColumns() < cols) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      cols - sheet.getMaxColumns()
    );
  }

  const range = sheet.getRange(1, 1, 1, cols);
  const current = range.getValues()[0];

  const same = UPLOAD_HEADERS.every(function(header, i) {
    return String(current[i]).trim() === header;
  });

  if (!same) {
    range.setValues([UPLOAD_HEADERS.slice()]).setFontWeight('bold');
  }
}

/* =========================================================
   HELPER: DRIVE
========================================================= */

/**
 * Ambil folder upload. ID folder disimpan di Script Properties
 * supaya tidak salah pilih jika ada beberapa folder bernama sama.
 */
function getOrCreateUploadFolder_(verify) {
  const props = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty(UPLOAD_CFG.FOLDER_PROP_KEY);

  if (cachedId) {
    try {
      const cached = DriveApp.getFolderById(cachedId);

      // Saat upload biasa cukup percaya ID (lebih cepat).
      // Verifikasi penuh hanya saat setup / test.
      if (
        !verify ||
        (!cached.isTrashed() && cached.getName() === UPLOAD_CFG.FOLDER_NAME)
      ) {
        return cached;
      }
    } catch (e) {
      // ID tidak valid lagi, cari / buat ulang di bawah.
    }
  }

  let folder = null;
  const folders = DriveApp.getFoldersByName(UPLOAD_CFG.FOLDER_NAME);

  while (folders.hasNext()) {
    const candidate = folders.next();

    if (!candidate.isTrashed()) {
      folder = candidate;
      break;
    }
  }

  if (!folder) {
    folder = DriveApp.createFolder(UPLOAD_CFG.FOLDER_NAME);
  }

  props.setProperty(UPLOAD_CFG.FOLDER_PROP_KEY, folder.getId());
  return folder;
}

/* =========================================================
   HELPER: GAMBAR
========================================================= */

/** Kenali tipe gambar dari isi file (bukan hanya dari header data URL). */
function detectImageType_(bytes) {
  // JPEG: FF D8 (byte bertanda: -1, -40)
  if (bytes.length > 3 && bytes[0] === -1 && bytes[1] === -40) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47
  if (
    bytes.length > 8 &&
    bytes[0] === -119 && bytes[1] === 80 &&
    bytes[2] === 78 && bytes[3] === 71
  ) {
    return { mime: 'image/png', ext: 'png' };
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes.length > 12 &&
    bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 &&
    bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  return null;
}

/** Ubah data URL menjadi bytes + tipe gambar, dengan validasi. */
function parseImageDataUrl_(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');

  if (commaIndex === -1) {
    throw new Error('Format foto tidak valid.');
  }

  const header = dataUrl.substring(0, commaIndex);

  if (!/^data:image\/[a-z0-9.+-]+;base64$/i.test(header)) {
    throw new Error('Foto harus berupa gambar (JPG, PNG, atau WEBP).');
  }

  const base64 = dataUrl.substring(commaIndex + 1).replace(/\s/g, '');

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('Data foto tidak valid.');
  }

  // Tolak lebih awal bila jelas terlalu besar, sebelum didecode.
  const maxChars = Math.ceil(UPLOAD_CFG.MAX_COMPRESSED_BYTES / 3) * 4 + 8;

  if (base64.length > maxChars) {
    throw new Error(
      'Ukuran foto hasil kompresi masih lebih dari 500 KB. Coba pilih foto lain.'
    );
  }

  const bytes = Utilities.base64Decode(base64);

  if (!bytes.length) {
    throw new Error('File foto kosong.');
  }

  if (bytes.length > UPLOAD_CFG.MAX_COMPRESSED_BYTES) {
    throw new Error(
      'Ukuran foto hasil kompresi masih lebih dari 500 KB. Coba pilih foto lain.'
    );
  }

  const type = detectImageType_(bytes);

  if (!type) {
    throw new Error('Foto harus berupa gambar (JPG, PNG, atau WEBP).');
  }

  return { bytes: bytes, mime: type.mime, ext: type.ext };
}

/* =========================================================
   HELPER: RATE LIMIT & ANTI-DUPLIKAT
========================================================= */

/**
 * Cek batas upload dan foto kembar memakai CacheService.
 * Dipanggil di dalam lock, jadi hitungan aman dari balapan.
 * Jika cache bermasalah, upload tetap diizinkan (fail-open).
 */
function checkUploadLimits_(storeCode, shift, bytes) {
  const windowMs = UPLOAD_CFG.RATE_LIMIT_WINDOW_SEC * 1000;
  const bucket = Math.floor(Date.now() / windowMs);

  const state = {
    storeKey: 'rl_s_' + storeCode + '_' + bucket,
    globalKey: 'rl_g_' + bucket,
    dupKey: null,
    storeCount: 0,
    globalCount: 0
  };

  try {
    const cache = CacheService.getScriptCache();
    const hash = Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes)
    );

    state.dupKey = 'dup_' + storeCode + '_' + shift + '_' + hash;

    const counts = cache.getAll([state.storeKey, state.globalKey, state.dupKey]);
    state.storeCount = Number(counts[state.storeKey] || 0);
    state.globalCount = Number(counts[state.globalKey] || 0);

    if (counts[state.dupKey]) {
      throw new Error('Foto yang sama baru saja diunggah. Pilih foto lain bila memang berbeda.');
    }
  } catch (e) {
    if (e && /Foto yang sama/.test(e.message)) throw e;
    console.warn('Cache tidak tersedia, pembatasan dilewati: ' + e.message);
    return state;
  }

  if (
    state.storeCount >= UPLOAD_CFG.RATE_LIMIT_PER_STORE ||
    state.globalCount >= UPLOAD_CFG.RATE_LIMIT_GLOBAL
  ) {
    throw new Error('Terlalu banyak upload dalam waktu singkat. Tunggu sebentar lalu coba lagi.');
  }

  return state;
}

/** Catat upload yang sukses ke hitungan batas dan penanda duplikat. */
function recordUpload_(state) {
  try {
    const cache = CacheService.getScriptCache();
    const ttl = Math.max(
      UPLOAD_CFG.RATE_LIMIT_WINDOW_SEC * 2,
      UPLOAD_CFG.DUPLICATE_WINDOW_SEC
    );
    const entries = {};

    entries[state.storeKey] = String(state.storeCount + 1);
    entries[state.globalKey] = String(state.globalCount + 1);

    if (state.dupKey) {
      entries[state.dupKey] = '1';
    }

    cache.putAll(entries, ttl);

    // Data status hari ini berubah setelah upload, jadi cache-nya dibuang.
    cache.remove(statusCacheKey_(businessDateIso_(new Date())));
  } catch (e) {
    console.warn('Gagal mencatat batas upload: ' + e.message);
  }
}

/* =========================================================
   HELPER: WAKTU, HARI & KETEPATAN WAKTU
========================================================= */

/** "09:30" -> 570 menit. null bila format salah. */
function hhmmToMinutes_(text) {
  const m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;

  const hour = Number(m[1]);
  const minute = Number(m[2]);

  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Menit sejak 00:00 (WIB). Sebelum DAY_START_HOUR ditambah 24 jam (hari operasional yang sama). */
function minutesOfBusinessDay_(date) {
  const parts = Utilities.formatDate(date, UPLOAD_CFG.TIME_ZONE, 'HH:mm').split(':');
  const hour = Number(parts[0]);
  let minutes = hour * 60 + Number(parts[1]);

  if (hour < UPLOAD_CFG.DAY_START_HOUR) minutes += 1440;
  return minutes;
}

/** Tanggal operasional (yyyy-MM-dd); hari berganti setiap DAY_START_HOUR (07.00 WIB). */
function businessDateIso_(date) {
  const shifted = new Date(date.getTime() - UPLOAD_CFG.DAY_START_HOUR * 3600000);
  return Utilities.formatDate(shifted, UPLOAD_CFG.TIME_ZONE, 'yyyy-MM-dd');
}

/** Validasi "yyyy-MM-dd" (tanggal kalender nyata). Hasil '' bila tidak valid. */
function normalizeDateIso_(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));

  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return text;
}

/** Geser tanggal "yyyy-MM-dd" sebanyak N hari. */
function shiftIso_(iso, days) {
  const p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)).toISOString().slice(0, 10);
}

/** "2026-10-24" -> "24/10/2026" */
function isoToDisplay_(iso) {
  const p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}

/** Ubah nilai sel jadi Date. Mendukung Date asli dan teks "dd/MM/yyyy HH:mm:ss" atau "MM/dd/yyyy ...". */
function toDate_(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  const text = String(value || '').trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;

  const a = Number(m[1]);
  const b = Number(m[2]);
  let day = a;
  let month = b;

  if (a <= 12 && b > 12) {     // jelas format bulan/hari
    month = a;
    day = b;
  }                            // selain itu dianggap hari/bulan (format sheet ini)

  const dt = new Date(Date.UTC(
    Number(m[3]), month - 1, day,
    Number(m[4]) - UPLOAD_CFG.TZ_OFFSET_HOURS, Number(m[5]), Number(m[6] || 0)
  ));

  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * Hitung TEPAT WAKTU / TERLAMBAT.
 * OPENING terlambat bila lewat jadwal + TOLERANCE_OPENING_MIN,
 * CLOSING terlambat bila lewat jadwal + TOLERANCE_CLOSING_MIN.
 * diff = selisih menit terhadap jadwal (negatif = lebih awal).
 */
function calcUploadStatus_(storeCode, shift, date) {
  const sched = UPLOAD_SCHEDULE[storeCode];
  if (!sched) return { status: '', diff: 0 };

  let target = hhmmToMinutes_(shift === 'CLOSING' ? sched.close : sched.open);
  if (target === null) return { status: '', diff: 0 };

  // Jadwal tutup lewat tengah malam (mis. 00:30) dihitung di hari yang sama.
  if (target < UPLOAD_CFG.DAY_START_HOUR * 60) target += 1440;

  const tolerance = shift === 'CLOSING'
    ? UPLOAD_CFG.TOLERANCE_CLOSING_MIN
    : UPLOAD_CFG.TOLERANCE_OPENING_MIN;

  const diff = minutesOfBusinessDay_(date) - target;

  return {
    status: diff > tolerance ? 'TERLAMBAT' : 'TEPAT WAKTU',
    diff: diff
  };
}

/* =========================================================
   PANEL STATUS (membaca sheet UPLOAD FOTO)
========================================================= */

function statusCacheKey_(iso) {
  return UPLOAD_CFG.STATUS_CACHE_PREFIX + iso;
}

/** Ringkas satu shift satu toko dari catatan upload. */
function summarizeShift_(code, shift, rec) {
  if (!rec) return { done: false, time: '', status: '', diff: 0, photo: '' };

  const calc = calcUploadStatus_(code, shift, rec.first.ts);
  let status = calc.status;

  // Utamakan STATUS yang tersimpan di sheet (tidak berubah walau jadwal diedit kemudian).
  if (rec.first.stored.indexOf('TERLAMBAT') === 0) status = 'TERLAMBAT';
  else if (rec.first.stored.indexOf('TEPAT') === 0) status = 'TEPAT WAKTU';

  return {
    done: true,
    time: Utilities.formatDate(rec.first.ts, UPLOAD_CFG.TIME_ZONE, 'HH:mm'),
    status: status,
    diff: calc.diff,
    photo: rec.last.url
  };
}

/**
 * Susun status semua toko untuk satu hari dari baris-baris log.
 * Jam & status memakai upload PERTAMA hari itu; foto memakai upload TERAKHIR
 * (jika toko upload ulang, foto terbaru yang tampil).
 */
function buildStatusFromRows_(rows, iso) {
  const found = {};

  rows.forEach(function(row) {
    const ts = toDate_(row[0]);
    if (!ts || businessDateIso_(ts) !== iso) return;

    const code = String(row[1] || '').trim().toUpperCase();
    const shift = String(row[4] || '').trim().toUpperCase();

    if (!Object.prototype.hasOwnProperty.call(UPLOAD_STORES, code)) return;
    if (shift !== 'OPENING' && shift !== 'CLOSING') return;

    const key = code + '|' + shift;
    const rec = found[key] || (found[key] = { first: null, last: null });

    const item = {
      ts: ts,
      url: String(row[3] || '').trim(),
      stored: String(row[5] || '').trim().toUpperCase()
    };

    if (!rec.first || ts < rec.first.ts) rec.first = item;
    if (!rec.last || ts >= rec.last.ts) rec.last = item;
  });

  return Object.keys(UPLOAD_STORES).map(function(code) {
    const sched = UPLOAD_SCHEDULE[code] || {};
    const o = summarizeShift_(code, 'OPENING', found[code + '|OPENING']);
    const c = summarizeShift_(code, 'CLOSING', found[code + '|CLOSING']);

    return {
      code: code,
      name: UPLOAD_STORES[code],
      openSched: sched.open || '',
      closeSched: sched.close || '',
      openDone: o.done,
      openTime: o.time,
      openStatus: o.status,
      openDiff: o.diff,
      openPhoto: o.photo,
      closeDone: c.done,
      closeTime: c.time,
      closeStatus: c.status,
      closeDiff: c.diff,
      closePhoto: c.photo
    };
  });
}

/**
 * Dipanggil halaman untuk panel "Status Hari Ini".
 * dateIso: "yyyy-MM-dd" atau kosong (= hari ini).
 */
function getStatusByDate(dateIso, forceRefresh) {
  try {
    const todayIso = businessDateIso_(new Date());
    const minIso = shiftIso_(todayIso, -UPLOAD_CFG.STATUS_HISTORY_DAYS);

    let iso = normalizeDateIso_(dateIso) || todayIso;
    if (iso > todayIso) iso = todayIso;
    if (iso < minIso) iso = minIso;

    const cache = CacheService.getScriptCache();
    const cacheKey = statusCacheKey_(iso);

    if (!forceRefresh) {
      try {
        const cached = cache.get(cacheKey);

        if (cached) {
          const payload = JSON.parse(cached);
          payload.today = todayIso;
          payload.minDate = minIso;
          return payload;
        }
      } catch (e) {}
    }

    const sheet = getUploadSheet_();
    const lastRow = sheet.getLastRow();
    const count = Math.max(0, Math.min(lastRow - 1, UPLOAD_CFG.LOG_READ_ROWS));

    const rows = count
      ? sheet.getRange(lastRow - count + 1, 1, count, UPLOAD_HEADERS.length).getValues()
      : [];

    const result = {
      success: true,
      dateIso: iso,
      date: isoToDisplay_(iso),
      today: todayIso,
      minDate: minIso,
      updatedAt: Utilities.formatDate(new Date(), UPLOAD_CFG.TIME_ZONE, 'HH:mm:ss'),
      stores: buildStatusFromRows_(rows, iso)
    };

    try {
      const json = JSON.stringify(result);

      if (json.length < 95000) {
        cache.put(
          cacheKey,
          json,
          iso === todayIso ? UPLOAD_CFG.STATUS_CACHE_SEC : UPLOAD_CFG.STATUS_PAST_CACHE_SEC
        );
      }
    } catch (e) {}

    return result;

  } catch (err) {
    console.error('getStatusByDate gagal: ' + (err && err.stack ? err.stack : err));
    return { success: false, message: err && err.message ? err.message : String(err) };
  }
}

/** Dipertahankan agar versi halaman lama tetap jalan. */
function getStatusHariIni(forceRefresh) {
  return getStatusByDate('', forceRefresh);
}

/* =========================================================
   THUMBNAIL & PREVIEW FOTO
========================================================= */

function cleanFileId_(fileId) {
  const id = String(fileId || '').trim();

  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    throw new Error('ID foto tidak valid.');
  }

  return id;
}

/** Hanya file di dalam folder upload yang boleh dibuka (cegah akses file lain di Drive). */
function getUploadFile_(id) {
  const file = DriveApp.getFileById(id);
  const folderId = getOrCreateUploadFolder_().getId();
  const parents = file.getParents();

  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return file;
  }

  throw new Error('Foto tidak ditemukan.');
}

function blobToDataUrl_(blob) {
  const type = blob.getContentType() || 'image/jpeg';
  return 'data:' + type + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function getFotoThumb(fileId) {
  try {
    const id = cleanFileId_(fileId);
    const cache = CacheService.getScriptCache();
    const key = 'thumb_' + id;

    try {
      const cached = cache.get(key);
      if (cached) return { success: true, dataUrl: cached };
    } catch (e) {}

    const file = getUploadFile_(id);
    let blob = null;

    try { blob = file.getThumbnail(); } catch (e) {}
    if (!blob && file.getSize() <= 150 * 1024) blob = file.getBlob();

    if (!blob) return { success: false, message: 'Thumbnail tidak tersedia.' };

    const dataUrl = blobToDataUrl_(blob);

    try {
      if (dataUrl.length < 90000) cache.put(key, dataUrl, UPLOAD_CFG.THUMB_CACHE_SEC);
    } catch (e) {}

    return { success: true, dataUrl: dataUrl };

  } catch (err) {
    return { success: false, message: err && err.message ? err.message : String(err) };
  }
}

function getFotoPreview(fileId) {
  try {
    const file = getUploadFile_(cleanFileId_(fileId));

    if (file.getSize() > UPLOAD_CFG.MAX_PREVIEW_BYTES) {
      return { success: false, message: 'Foto terlalu besar untuk preview. Gunakan "Buka di tab baru".' };
    }

    return { success: true, dataUrl: blobToDataUrl_(file.getBlob()) };

  } catch (err) {
    return { success: false, message: err && err.message ? err.message : String(err) };
  }
}

/* =========================================================
   UPLOAD UTAMA
========================================================= */

/** Link foto yang disimpan di sheet (lihat UPLOAD_CFG.PHOTO_LINK_STYLE). */
function photoLink_(file) {
  if (UPLOAD_CFG.PHOTO_LINK_STYLE === 'viewer') return file.getUrl();
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600';
}

/**
 * payload:
 * {
 *   storeCode: "F36W",
 *   shift: "OPENING" atau "CLOSING",
 *   base64: "data:image/jpeg;base64,..."
 * }
 */
function uploadFoto(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Data upload tidak valid.');
  }

  const storeCode = String(payload.storeCode || '').trim().toUpperCase();
  const shift = String(payload.shift || '').trim().toUpperCase();
  const dataUrl = String(payload.base64 || '');

  if (!Object.prototype.hasOwnProperty.call(UPLOAD_STORES, storeCode)) {
    throw new Error('Kode toko tidak valid.');
  }

  if (shift !== 'OPENING' && shift !== 'CLOSING') {
    throw new Error('Pilih OPENING atau CLOSING.');
  }

  const image = parseImageDataUrl_(dataUrl);

  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(UPLOAD_CFG.LOCK_WAIT_MS);
  } catch (lockError) {
    throw new Error('Server sedang sibuk. Coba lagi beberapa detik lagi.');
  }

  let file = null;

  try {
    const limits = checkUploadLimits_(storeCode, shift, image.bytes);

    const sheet = getUploadSheet_();
    const folder = getOrCreateUploadFolder_();

    // Satu waktu yang sama dipakai untuk nama file, status, dan isi spreadsheet.
    const now = new Date();
    const punctual = calcUploadStatus_(storeCode, shift, now);

    const timestamp = Utilities.formatDate(
      now,
      UPLOAD_CFG.TIME_ZONE,
      'yyyyMMdd_HHmmss'
    );

    const fileName = [storeCode, shift, timestamp].join('_') + '.' + image.ext;
    const blob = Utilities.newBlob(image.bytes, image.mime, fileName);
    file = folder.createFile(blob);

    // Link Drive dapat dibuka oleh orang yang punya akses ke file.
    // Tidak mengubah izin file menjadi publik.
    const fileUrl = photoLink_(file);
    const siteName = UPLOAD_STORES[storeCode];

    const nextRow = Math.max(sheet.getLastRow() + 1, 2);

    if (nextRow > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), nextRow - sheet.getMaxRows());
    }

    sheet.getRange(nextRow, 1, 1, UPLOAD_HEADERS.length).setValues([[
      now,
      storeCode,
      siteName,
      fileUrl,
      shift,
      punctual.status
    ]]);

    // Pastikan baris benar-benar tersimpan sebelum lock dilepas,
    // supaya upload berikutnya tidak menimpa baris yang sama.
    SpreadsheetApp.flush();
    recordUpload_(limits);

    return {
      success: true,
      message: 'Upload berhasil!',
      storeCode: storeCode,
      siteName: siteName,
      shift: shift,
      status: punctual.status,
      diffMinutes: punctual.diff,
      fileUrl: fileUrl,
      url: fileUrl, // dibaca oleh tombol "Buka foto yang tersimpan" di halaman
      sizeBytes: image.bytes.length,
      sizeKB: Math.round(image.bytes.length / 1024)
    };

  } catch (err) {
    console.error('uploadFoto gagal: ' + (err && err.stack ? err.stack : err));

    // Hapus file yang baru dibuat jika penulisan spreadsheet gagal.
    if (file) {
      try {
        file.setTrashed(true);
      } catch (cleanupError) {
        // Biarkan error utama tetap terlihat.
      }
    }

    // Halaman sudah menambahkan awalan "Upload gagal:", jadi tidak diulang di sini.
    throw new Error(err && err.message ? err.message : String(err));

  } finally {
    lock.releaseLock();
  }
}

/**
 * Rekap terlambat dan belum upload untuk rentang tanggal pilihan (maks. 31 hari).
 * Setiap toko dihitung satu kali per tanggal untuk shift aktif.
 */
function getUploadHistorySummary(fromIso, toIso, shift) {
  try {
    const from = normalizeDateIso_(fromIso);
    const to = normalizeDateIso_(toIso);
    const normalizedShift = String(shift || 'OPENING').toUpperCase();
    if (!from || !to || from > to) throw new Error('Rentang tanggal rekap tidak valid.');
    if (normalizedShift !== 'OPENING' && normalizedShift !== 'CLOSING') {
      throw new Error('Shift rekap tidak valid.');
    }

    const maxDays = 31;
    const days = Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
    if (days < 1 || days > maxDays) throw new Error('Rekap hanya mendukung rentang 1–31 hari.');

    const sheet = getUploadSheet_();
    const lastRow = sheet.getLastRow();
    const count = Math.max(0, Math.min(lastRow - 1, UPLOAD_CFG.LOG_READ_ROWS));
    const rows = count
      ? sheet.getRange(lastRow - count + 1, 1, count, UPLOAD_HEADERS.length).getValues()
      : [];

    let late = 0, missing = 0, onTime = 0;
    const lateSet = {}, missingSet = {};
    const todayIso = businessDateIso_(new Date());

    for (let offset = 0; offset < days; offset++) {
      const iso = shiftIso_(from, offset);
      const stores = buildStatusFromRows_(rows, iso);
      stores.forEach(function(store) {
        const done = normalizedShift === 'CLOSING' ? store.closeDone : store.openDone;
        const status = normalizedShift === 'CLOSING' ? store.closeStatus : store.openStatus;
        const sched = UPLOAD_SCHEDULE[store.code] || {};
        const scheduleText = normalizedShift === 'CLOSING' ? sched.close : sched.open;

        if (done) {
          if (status === 'TERLAMBAT') {
            late++;
            lateSet[store.code + ' · ' + store.name] = true;
          } else if (status === 'TEPAT WAKTU') {
            onTime++;
          }
        } else {
          // Rekap riwayat menghitung toko yang belum upload pada tanggal yang dipilih,
          // termasuk hari ini. Jangan menunda hitungan hanya karena jadwal belum lewat.
          missing++;
          missingSet[store.code + ' · ' + store.name] = true;
        }
      });
    }

    return {
      success: true,
      from: isoToDisplay_(from),
      to: isoToDisplay_(to),
      days: days,
      shift: normalizedShift,
      late: late,
      missing: missing,
      onTime: onTime,
      lateStores: Object.keys(lateSet),
      missingStores: Object.keys(missingSet)
    };
  } catch (err) {
    console.error('getUploadHistorySummary gagal: ' + (err && err.stack ? err.stack : err));
    return { success: false, message: err && err.message ? err.message : String(err) };
  }
}
