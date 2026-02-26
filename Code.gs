const CONFIG = {
  SPREADSHEET_ID: "", // Optional. If empty, script creates a spreadsheet automatically.
  SHEET_NAME: "Bookings",
  WORK_START: "10:00",
  WORK_END: "20:00"
};

const SCRIPT_PROP_SPREADSHEET_ID = "auto_spreadsheet_id";

const HEADERS = [
  "booking_id",
  "created_at",
  "updated_at",
  "status",
  "date",
  "time",
  "end_time",
  "duration_min",
  "service",
  "client_name",
  "phone",
  "comment",
  "tg_user_id",
  "tg_username",
  "tg_init_data"
];

const STATUS_ACTIVE = "active";
const STATUS_ARRIVED = "arrived";
const STATUS_NO_SHOW = "no_show";
const STATUS_COMPLETED = "completed";
const STATUS_CANCELED = "canceled";
const ALLOWED_STATUSES = [
  STATUS_ACTIVE,
  STATUS_ARRIVED,
  STATUS_NO_SHOW,
  STATUS_COMPLETED,
  STATUS_CANCELED
];

function doGet(e) {
  return route_(e, "GET");
}

function doPost(e) {
  return route_(e, "POST");
}

function route_(e, method) {
  const p = parseParams_(e);
  const action = str_(p.action).toLowerCase();

  try {
    if (!action) return json_({ ok: false, error: "missing_action" });

    if (action === "health") {
      const sheet = ensureSheet_();
      return json_({ ok: true, sheet_name: sheet.getName() });
    }

    if (action === "busy") {
      const date = str_(p.date);
      if (!isIsoDate_(date)) return json_({ ok: true, intervals: [] });
      return json_({ ok: true, intervals: getBusyIntervals_(date) });
    }

    if (action === "my") {
      const phone = normalizePhone_(p.phone);
      if (!isPhoneValid_(phone)) return json_({ ok: false, error: "invalid_phone" });
      return json_({ ok: true, items: getMyBookings_(phone) });
    }

    if (action === "add") {
      if (method !== "POST") return json_({ ok: false, error: "method_not_allowed" });
      return json_(addBooking_(p));
    }

    if (action === "cancel") {
      if (method !== "POST") return json_({ ok: false, error: "method_not_allowed" });
      return json_(cancelBooking_(p));
    }

    if (action === "update_status") {
      if (method !== "POST") return json_({ ok: false, error: "method_not_allowed" });
      return json_(updateBookingStatus_(p));
    }

    return json_({ ok: false, error: "unknown_action" });
  } catch (error) {
    return json_({
      ok: false,
      error: "server_error",
      message: String(error && error.message ? error.message : error)
    });
  }
}

function addBooking_(p) {
  const service = str_(p.service);
  const date = str_(p.date);
  const time = normalizeTime_(p.time);
  const clientName = normalizeSingleLine_(p.client_name);
  const phone = normalizePhone_(p.phone);
  const comment = normalizeSingleLine_(p.comment);
  const durationMin = durationByService_(service);

  if (!service) return { ok: false, error: "missing_service" };
  if (!isIsoDate_(date)) return { ok: false, error: "invalid_date" };
  if (!isValidTime_(time)) return { ok: false, error: "invalid_time" };
  if (!clientName) return { ok: false, error: "missing_name" };
  if (!isPhoneValid_(phone)) return { ok: false, error: "invalid_phone" };

  const start = timeToMin_(time);
  const end = start + durationMin;
  if (start < timeToMin_(CONFIG.WORK_START) || end > timeToMin_(CONFIG.WORK_END)) {
    return { ok: false, error: "outside_working_hours" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    // Important: this automatically creates sheet tab if it doesn't exist.
    const sheet = ensureSheet_();
    const meta = readHeaderMeta_(sheet);
    const rows = readRows_(sheet, meta);

    if (hasOverlap_(rows, date, start, end)) {
      return { ok: false, error: "slot_busy" };
    }

    const nowIso = new Date().toISOString();
    const bookingId = makeBookingId_();

    const rowObj = {
      booking_id: bookingId,
      created_at: nowIso,
      updated_at: nowIso,
      status: "active",
      date: date,
      time: time,
      end_time: minToTime_(end),
      duration_min: durationMin,
      service: service,
      client_name: clientName,
      phone: phone,
      comment: comment,
      tg_user_id: str_(p.tg_user_id),
      tg_username: str_(p.tg_username),
      tg_init_data: str_(p.tg_init_data)
    };

    const row = meta.headers.map(function (h) {
      return Object.prototype.hasOwnProperty.call(rowObj, h) ? rowObj[h] : "";
    });

    sheet.appendRow(row);
    return { ok: true, booking_id: bookingId };
  } finally {
    lock.releaseLock();
  }
}

function cancelBooking_(p) {
  const bookingId = str_(p.booking_id);
  const phone = normalizePhone_(p.phone);

  if (!bookingId) return { ok: false, error: "missing_booking_id" };
  if (!isPhoneValid_(phone)) return { ok: false, error: "invalid_phone" };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const sheet = ensureSheet_();
    const meta = readHeaderMeta_(sheet);
    const rows = readRows_(sheet, meta);

    let found = null;
    for (var i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (str_(r.booking_id) === bookingId && normalizePhone_(r.phone) === phone) {
        found = r;
        break;
      }
    }

    if (!found) return { ok: false, error: "not_found" };
    if (normalizeStatus_(found.status) === STATUS_CANCELED) return { ok: true, already: true };

    setCellByHeader_(sheet, meta, found._row, "status", STATUS_CANCELED);
    setCellByHeader_(sheet, meta, found._row, "updated_at", new Date().toISOString());

    // If this was the only booking row, remove the whole bookings sheet.
    if (shouldDeleteSheetAfterCancel_(rows, found)) {
      deleteSheetSafely_(sheet);
      return { ok: true, sheet_deleted: true };
    }

    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function updateBookingStatus_(p) {
  const bookingId = str_(p.booking_id);
  const phone = normalizePhone_(p.phone);
  const nextStatus = normalizeStatus_(p.status);

  if (!bookingId) return { ok: false, error: "missing_booking_id" };
  if (!isPhoneValid_(phone)) return { ok: false, error: "invalid_phone" };
  if (!nextStatus || ALLOWED_STATUSES.indexOf(nextStatus) === -1) {
    return { ok: false, error: "invalid_status" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const sheet = ensureSheet_();
    const meta = readHeaderMeta_(sheet);
    const rows = readRows_(sheet, meta);

    let found = null;
    for (var i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (str_(r.booking_id) === bookingId && normalizePhone_(r.phone) === phone) {
        found = r;
        break;
      }
    }

    if (!found) return { ok: false, error: "not_found" };

    const currentStatus = normalizeStatus_(found.status);
    if (currentStatus === nextStatus) {
      return { ok: true, unchanged: true, status: nextStatus };
    }

    setCellByHeader_(sheet, meta, found._row, "status", nextStatus);
    setCellByHeader_(sheet, meta, found._row, "updated_at", new Date().toISOString());

    if (nextStatus === STATUS_CANCELED && shouldDeleteSheetAfterCancel_(rows, found)) {
      deleteSheetSafely_(sheet);
      return { ok: true, status: nextStatus, sheet_deleted: true };
    }

    return { ok: true, status: nextStatus };
  } finally {
    lock.releaseLock();
  }
}

function getBusyIntervals_(date) {
  const sheet = ensureSheet_();
  const meta = readHeaderMeta_(sheet);
  const rows = readRows_(sheet, meta);

  const out = [];
  for (var i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (str_(r.date) !== date) continue;
    if (normalizeStatus_(r.status) === STATUS_CANCELED) continue;

    const start = normalizeTime_(r.time);
    const startMin = timeToMin_(start);
    if (!Number.isFinite(startMin)) continue;

    let end = normalizeTime_(r.end_time);
    if (!isValidTime_(end)) {
      const duration = toInt_(r.duration_min, durationByService_(r.service));
      end = minToTime_(startMin + duration);
    }

    out.push({
      start: start,
      end: end,
      duration_min: toInt_(r.duration_min, durationByService_(r.service))
    });
  }

  out.sort(function (a, b) {
    return timeToMin_(a.start) - timeToMin_(b.start);
  });

  return out;
}

function getMyBookings_(phone) {
  const sheet = ensureSheet_();
  const meta = readHeaderMeta_(sheet);
  const rows = readRows_(sheet, meta);

  const out = [];
  for (var i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (normalizePhone_(r.phone) !== phone) continue;

    out.push({
      booking_id: str_(r.booking_id),
      service: str_(r.service),
      date: str_(r.date),
      time: normalizeTime_(r.time),
      duration_min: toInt_(r.duration_min, durationByService_(r.service)),
      status: normalizeStatus_(r.status),
      created_at: str_(r.created_at)
    });
  }

  out.sort(function (a, b) {
    return dateTimeKey_(b.date, b.time) - dateTimeKey_(a.date, a.time);
  });
  return out;
}

function ensureSheet_() {
  const ss = getOrCreateSpreadsheet_();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }
  ensureHeaders_(sheet);
  return sheet;
}

function getOrCreateSpreadsheet_() {
  if (str_(CONFIG.SPREADSHEET_ID)) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }

  const props = PropertiesService.getScriptProperties();
  const savedId = str_(props.getProperty(SCRIPT_PROP_SPREADSHEET_ID));
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (_) {
      // fallback below
    }
  }

  const ss = SpreadsheetApp.create("Barbershop Bookings");
  props.setProperty(SCRIPT_PROP_SPREADSHEET_ID, ss.getId());
  return ss;
}

function shouldDeleteSheetAfterCancel_(rows, found) {
  if (!found || !Array.isArray(rows)) return false;
  if (rows.length !== 1) return false;
  return str_(rows[0].booking_id) === str_(found.booking_id);
}

function deleteSheetSafely_(sheet) {
  const ss = sheet.getParent();

  // Google Sheets cannot delete the last remaining tab.
  if (ss.getSheets().length <= 1) {
    if (!ss.getSheetByName("Temp")) ss.insertSheet("Temp");
  }

  ss.deleteSheet(sheet);
}

function ensureHeaders_(sheet) {
  const width = Math.max(sheet.getLastColumn(), HEADERS.length);
  const existing = sheet.getRange(1, 1, 1, width).getValues()[0].map(str_);
  const hasAny = existing.some(function (x) { return !!x; });
  if (!hasAny) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    return;
  }

  let col = existing.length;
  for (var i = 0; i < HEADERS.length; i++) {
    if (existing.indexOf(HEADERS[i]) === -1) {
      col += 1;
      sheet.getRange(1, col).setValue(HEADERS[i]);
      existing.push(HEADERS[i]);
    }
  }
}

function readHeaderMeta_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(str_);
  const map = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) map[headers[i]] = i;
  }
  return { headers: headers, map: map, lastCol: lastCol };
}

function readRows_(sheet, meta) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, meta.lastCol).getValues();
  const rows = [];
  for (var r = 0; r < data.length; r++) {
    const obj = { _row: r + 2 };
    for (var c = 0; c < meta.headers.length; c++) {
      const h = meta.headers[c];
      if (h) obj[h] = data[r][c];
    }
    rows.push(obj);
  }
  return rows;
}

function setCellByHeader_(sheet, meta, row, header, value) {
  if (!Object.prototype.hasOwnProperty.call(meta.map, header)) return;
  sheet.getRange(row, meta.map[header] + 1).setValue(value);
}

function hasOverlap_(rows, date, start, end) {
  for (var i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (str_(r.date) !== date) continue;
    if (normalizeStatus_(r.status) === STATUS_CANCELED) continue;

    const otherStart = timeToMin_(normalizeTime_(r.time));
    if (!Number.isFinite(otherStart)) continue;

    let otherEnd = timeToMin_(normalizeTime_(r.end_time));
    if (!Number.isFinite(otherEnd)) {
      const duration = toInt_(r.duration_min, durationByService_(r.service));
      otherEnd = otherStart + duration;
    }

    if (start < otherEnd && end > otherStart) return true;
  }
  return false;
}

function durationByService_(service) {
  const normalized = str_(service).toLowerCase().replace(/\s+/g, " ");
  if (normalized.indexOf("стрижка + бритье") !== -1) return 60;
  if (normalized.indexOf("стрижка+ бритье") !== -1) return 60;
  if (normalized.indexOf("стрижка+бритье") !== -1) return 60;
  return 30;
}

function makeBookingId_() {
  return "B-" + Utilities.formatDate(new Date(), "Etc/UTC", "yyyyMMdd-HHmmss") + "-" + Utilities.getUuid().slice(0, 8);
}

function parseParams_(e) {
  const out = {};

  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (k) {
      out[k] = String(e.parameter[k] == null ? "" : e.parameter[k]);
    });
  }

  if (!out.action && e && e.postData && e.postData.contents) {
    const raw = String(e.postData.contents || "");
    const pairs = raw.split("&");
    for (var i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const key = decodeURIComponent((eq >= 0 ? pair.slice(0, eq) : pair).replace(/\+/g, " "));
      const val = decodeURIComponent((eq >= 0 ? pair.slice(eq + 1) : "").replace(/\+/g, " "));
      out[key] = val;
    }
  }

  return out;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function str_(v) {
  return String(v == null ? "" : v).trim();
}

function normalizeSingleLine_(v) {
  return str_(v).replace(/\s+/g, " ");
}

function isIsoDate_(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str_(v));
}

function normalizeTime_(v) {
  const m = str_(v).match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return str_(v);
  return String(Number(m[1])).padStart(2, "0") + ":" + String(Number(m[2])).padStart(2, "0");
}

function isValidTime_(v) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalizeTime_(v));
}

function timeToMin_(t) {
  const m = normalizeTime_(t).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minToTime_(min) {
  const n = Number(min);
  if (!Number.isFinite(n)) return "00:00";
  const hh = String(Math.floor(n / 60)).padStart(2, "0");
  const mm = String(n % 60).padStart(2, "0");
  return hh + ":" + mm;
}

function toInt_(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function normalizePhone_(raw) {
  let value = str_(raw);
  if (!value) return "";
  value = value.replace(/[^\d+]/g, "");
  value = value.replace(/(?!^)\+/g, "");
  if (value.indexOf("00") === 0) value = "+" + value.slice(2);

  if (value.indexOf("+") === 0) {
    const digitsIntl = value.slice(1).replace(/\D/g, "");
    return digitsIntl ? "+" + digitsIntl : "";
  }

  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.indexOf("8") === 0) return "+7" + digits.slice(1);
  if (digits.length === 11 && digits.indexOf("7") === 0) return "+7" + digits.slice(1);
  if (digits.length === 10) return "+7" + digits;
  return "+" + digits;
}

function isPhoneValid_(phone) {
  return /^\+\d{10,15}$/.test(str_(phone));
}

function normalizeStatus_(status) {
  const raw = str_(status).toLowerCase();
  if (!raw) return STATUS_ACTIVE;
  if (ALLOWED_STATUSES.indexOf(raw) !== -1) return raw;
  return STATUS_ACTIVE;
}

function dateTimeKey_(date, time) {
  const d = str_(date);
  const t = normalizeTime_(time);
  return Date.parse(d + "T" + t + ":00Z") || 0;
}
