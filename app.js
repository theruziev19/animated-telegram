/***********************
 * CONFIG
 ***********************/
const GAS_URL = "https://script.google.com/macros/s/AKfycbyN_mSD70Z7_DF60tSZgGMX2A6f40byPOwtUA7fphbgw305ZrlzMGmy3zxeqN7sTd-HgA/exec";

const WORK_START = "10:00";
const WORK_END   = "20:00";
const STEP_MIN   = 30;
const NAME_MIN_LEN = 2;
const NAME_MAX_LEN = 60;
const COMMENT_MAX_LEN = 240;

const SERVICES = [
  { key:"Стрижка",   name:"Стрижка",   desc:"Классическая стрижка. 30 минут.", duration:30, price:0 },
  { key:"Борода",    name:"Борода",    desc:"Оформление бороды. 30 минут.",    duration:30, price:0 },
  { key:"Стрижка + бритье",      name:"Стрижка + бритье",      desc:"Стрижка и бритье. 60 минут.",            duration:60, price:0 },
  { key:"Моделирование бороды",  name:"Моделирование бороды",  desc:"Моделирование и форма бороды. 30 минут.", duration:30, price:0 },
  { key:"Черная маска",          name:"Черная маска",          desc:"Черная маска для лица. 30 минут.",       duration:30, price:0 },
  { key:"Коррекция воском",      name:"Коррекция воском",      desc:"Коррекция воском. 30 минут.",            duration:30, price:0 },
  { key:"Пилинг кожи головы",    name:"Пилинг кожи головы",    desc:"Пилинг кожи головы. 30 минут.",          duration:30, price:0 },
];

const PROFILE_KEY = "barber_profile_v1";

// Telegram
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) tg.ready();

/***********************
 * HELPERS
 ***********************/
const $ = (id) => document.getElementById(id);
const bookingUtils = window.BookingUtils || {};
const timeToMin = bookingUtils.timeToMin || ((t) => {
  const [h,m] = String(t || "").split(":").map(Number);
  return h*60 + m;
});
const minToTime = bookingUtils.minToTime || ((m) => {
  const hh = String(Math.floor(m/60)).padStart(2,"0");
  const mm = String(m%60).padStart(2,"0");
  return `${hh}:${mm}`;
});
const normalizePhone = bookingUtils.normalizePhone || ((raw) => {
  let value = String(raw || "").trim();
  if (!value) return "";

  value = value.replace(/[^\d+]/g, "");
  value = value.replace(/(?!^)\+/g, "");
  if (value.startsWith("00")) value = "+" + value.slice(2);

  if (value.startsWith("+")) {
    const internationalDigits = value.slice(1).replace(/\D/g, "");
    return internationalDigits ? "+" + internationalDigits : "";
  }

  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("8")) return "+7" + digits.slice(1);
  if (digits.length === 11 && digits.startsWith("7")) return "+7" + digits.slice(1);
  if (digits.length === 10) return "+7" + digits;
  return "+" + digits;
});
const isPhoneValid = bookingUtils.isPhoneValid || ((phone) => /^\+\d{10,15}$/.test(String(phone || "")));
const isClientNameValid = bookingUtils.isClientNameValid || ((name) => {
  const len = String(name || "").trim().length;
  return len >= NAME_MIN_LEN && len <= NAME_MAX_LEN;
});
const isCommentValid = bookingUtils.isCommentValid || ((comment) => String(comment || "").length <= COMMENT_MAX_LEN);

function normalizeSingleLine(value){
  return String(value || "").replace(/\s+/g, " ").trim();
}

function handleActivateKeydown(event, handler){
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handler();
  }
}

function safeSetFieldValue(id, value){
  if ($(id)) $(id).value = value;
}

function show(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = $(screenId);
  if (el) el.classList.add("active");

  const backBtn = $("backBtn");
  if (backBtn) backBtn.style.visibility = (screenId === "screenHome") ? "hidden" : "visible";

  if (screenId === "screenConfirm") {
    refreshConfirm();
    applyProfileToInputs();
  }

  if (screenId === "screenProfile") {
    renderProfile();
  }

  if (screenId === "screenMy") {
    // подставим телефон из confirm / профиля
    if ($("myPhone")) {
      const p = loadProfile();
      const fromConfirm = $("phone") ? normalizeSingleLine($("phone").value) : "";
      const profilePhone = (p && p.phone) ? normalizeSingleLine(p.phone) : "";
      const prefill = normalizePhone(fromConfirm || profilePhone);
      $("myPhone").value = prefill || fromConfirm || profilePhone || "";
    }
    // можно сразу загрузить, если телефон есть
    // loadMyBookings();
  }
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function overlaps(aStart, aEnd, bStart, bEnd){
  return aStart < bEnd && aEnd > bStart;
}

function setSendNote(t){
  if ($("sendNote")) $("sendNote").textContent = t;
}

function setMyNote(t){
  if ($("myNote")) $("myNote").textContent = t;
}

function getTelegramPayload(){
  if (!tg || !tg.initDataUnsafe || !tg.initDataUnsafe.user) return {};
  const u = tg.initDataUnsafe.user;
  return {
    tg_user_id: String(u.id),
    tg_username: u.username ? String(u.username) : "",
    tg_init_data: tg.initData ? String(tg.initData) : ""
  };
}

async function requestApi({ action, method = "GET", query = {}, body = {}, signal }){
  const url = new URL(GAS_URL);
  const upperMethod = String(method || "GET").toUpperCase();

  if (upperMethod === "GET") {
    url.searchParams.set("action", action);
    Object.entries(query).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      url.searchParams.set(k, String(v));
    });
  }

  const options = { method: upperMethod, signal };
  if (upperMethod === "POST") {
    const payload = new URLSearchParams();
    payload.set("action", action);
    Object.entries(body).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      payload.set(k, String(v));
    });
    options.headers = {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
    };
    options.body = payload.toString();
  }

  const response = await fetch(url.toString(), options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json().catch(() => null);
  if (!data) throw new Error("invalid_json");
  return data;
}

/***********************
 * STATE
 ***********************/
let selectedServiceKey = "";
let selectedServiceDuration = 0;

let selectedDate = "";
let selectedTime = "";

let viewYear, viewMonth;

// занятые интервалы на выбранную дату
let busyIntervals = []; // [{start:"10:00", end:"10:30", duration_min:30}]
let busyRequestSeq = 0;
let busyFetchController = null;

/***********************
 * INIT
 ***********************/
(function init(){
  // default date = tomorrow
  const d = new Date();
  d.setDate(d.getDate() + 1);
  selectedDate = toISODate(d);

  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();

  // NAV buttons
  document.querySelectorAll("[data-open]").forEach(el => {
    const target = el.getAttribute("data-open");
    const openTarget = () => show(target);
    el.addEventListener("click", openTarget);

    if (el.tagName !== "BUTTON") {
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      const title = el.querySelector(".miTitle");
      if (title && title.textContent) el.setAttribute("aria-label", title.textContent.trim());
      el.addEventListener("keydown", (event) => handleActivateKeydown(event, openTarget));
    }
  });

  if ($("profileBtn")) $("profileBtn").addEventListener("click", () => show("screenProfile"));
  if ($("backBtn")) $("backBtn").addEventListener("click", () => show("screenHome"));

  if ($("goConfirm")) $("goConfirm").addEventListener("click", () => show("screenConfirm"));

  if ($("prevMonth")) $("prevMonth").addEventListener("click", prevMonth);
  if ($("nextMonth")) $("nextMonth").addEventListener("click", nextMonth);

  if ($("svcSearch")) $("svcSearch").addEventListener("input", renderServices);

  if ($("sendBtn")) $("sendBtn").addEventListener("click", sendBooking);

  if ($("pfSave")) $("pfSave").addEventListener("click", () => {
    const name = normalizeSingleLine($("pfName") ? $("pfName").value : "");
    const phoneRaw = normalizeSingleLine($("pfPhone") ? $("pfPhone").value : "");
    const note = normalizeSingleLine($("pfNote") ? $("pfNote").value : "");
    const phone = phoneRaw ? normalizePhone(phoneRaw) : "";

    if (name && !isClientNameValid(name)) {
      if ($("pfStatus")) $("pfStatus").textContent = `Имя: ${NAME_MIN_LEN}-${NAME_MAX_LEN} символов.`;
      return;
    }
    if (phoneRaw && !isPhoneValid(phone)) {
      if ($("pfStatus")) $("pfStatus").textContent = "Телефон в формате +79990000000.";
      return;
    }
    if (note && !isCommentValid(note)) {
      if ($("pfStatus")) $("pfStatus").textContent = `Комментарий до ${COMMENT_MAX_LEN} символов.`;
      return;
    }

    safeSetFieldValue("pfName", name);
    safeSetFieldValue("pfPhone", phone);
    safeSetFieldValue("pfNote", note);
    saveProfile({ name, phone, note });
    renderProfile();
    applyProfileToInputs();
  });

  if ($("pfReset")) $("pfReset").addEventListener("click", resetProfile);

  if ($("myLoad")) $("myLoad").addEventListener("click", loadMyBookings);

  // Telegram: если профиля нет — подхватим имя
  const p = loadProfile();
  if (!p && tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    const u = tg.initDataUnsafe.user;
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    saveProfile({ name, phone:"", note:"" }, true);
  }

  renderCalendar();
  renderServices();

  // загрузим занятые слоты на дефолтную дату
  refreshBusyAndSlots(selectedDate);

  updateHomeSummary();
})();

/***********************
 * SERVICES
 ***********************/
function renderServices(){
  const q = ($("svcSearch") ? $("svcSearch").value : "").toLowerCase().trim();
  const box = $("servicesList");
  if (!box) return;

  box.innerHTML = "";

  SERVICES
    .filter(s => !q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q))
    .forEach(s => {
      const row = document.createElement("div");
      row.className = "svcCard";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.setAttribute("aria-pressed", selectedServiceKey === s.key ? "true" : "false");
      row.setAttribute("aria-label", `${s.name}, ${s.duration} минут`);

      const img = document.createElement("div");
      img.className = "svcImg";
      img.textContent = s.name.toUpperCase();

      const info = document.createElement("div");
      info.className = "svcInfo";
      info.innerHTML = `
        <div class="svcName">${s.name}</div>
        <div class="svcDesc">${s.desc}</div>
        <div class="svcPrice">${s.price ? (s.price + " ₽") : ""}</div>
      `;

      const chk = document.createElement("div");
      chk.className = "chk" + (selectedServiceKey === s.key ? " on" : "");
      chk.innerHTML = (selectedServiceKey === s.key
        ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-check"></use></svg>'
        : ""
      );
      chk.setAttribute("aria-hidden", "true");

      const selectService = () => {
        selectedServiceKey = s.key;
        selectedServiceDuration = s.duration;

        if ($("svcSub")) $("svcSub").textContent = selectedServiceKey;

        // после выбора услуги просто перерисуем слоты (busyIntervals уже загружены на выбранную дату)
        renderServices();
        renderSlots();
      };
      row.addEventListener("click", selectService);
      row.addEventListener("keydown", (event) => handleActivateKeydown(event, selectService));

      row.appendChild(img);
      row.appendChild(info);
      row.appendChild(chk);
      box.appendChild(row);
    });

  if ($("svcSub")) $("svcSub").textContent = selectedServiceKey || "Не выбрано";
}

/***********************
 * CALENDAR
 ***********************/
function renderCalendar(){
  const monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  if ($("calMonth")) $("calMonth").textContent = `${monthNames[viewMonth]} ${viewYear}`;

  const dow = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

  if ($("calDow")) {
    $("calDow").innerHTML = "";
    dow.forEach(d => {
      const el = document.createElement("div");
      el.className = "dow";
      el.textContent = d;
      $("calDow").appendChild(el);
    });
  }

  const daysBox = $("calDays");
  if (!daysBox) return;

  daysBox.innerHTML = "";

  const first = new Date(viewYear, viewMonth, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday=0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayISO = toISODate(new Date());

  for (let i=0; i<startOffset; i++){
    const el = document.createElement("div");
    el.className = "day muted";
    daysBox.appendChild(el);
  }

  for (let day=1; day<=daysInMonth; day++){
    const d = new Date(viewYear, viewMonth, day);
    const iso = toISODate(d);
    const isPastDay = iso < todayISO;

    const el = document.createElement("div");
    el.className = "day";
    el.textContent = String(day);
    el.setAttribute("aria-label", iso);

    if (isPastDay) el.classList.add("muted");
    if (iso === todayISO) el.classList.add("today");
    if (iso === selectedDate) el.classList.add("sel");

    const selectDate = () => {
      if (isPastDay) return;
      selectedDate = iso;
      selectedTime = "";

      renderCalendar();
      updateHomeSummary();

      // главное: загрузить busy для даты и перерисовать слоты
      refreshBusyAndSlots(iso);
    };

    if (isPastDay) {
      el.setAttribute("aria-disabled", "true");
      el.tabIndex = -1;
    } else {
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.addEventListener("click", selectDate);
      el.addEventListener("keydown", (event) => handleActivateKeydown(event, selectDate));
    }

    daysBox.appendChild(el);
  }

  if ($("dtSub")) {
    $("dtSub").textContent = (selectedDate && selectedTime) ? `${selectedDate} • ${selectedTime}` : "Не выбрано";
  }
}

function prevMonth(){
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderCalendar();
}
function nextMonth(){
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
}

/***********************
 * SLOTS (busy blocking)
 ***********************/
function generateSlots(){
  const [sh, sm] = WORK_START.split(":").map(Number);
  const [eh, em] = WORK_END.split(":").map(Number);
  const startMin = sh*60 + sm;
  const endMin = eh*60 + em;

  const list = [];
  for (let m=startMin; m<endMin; m += STEP_MIN) {
    list.push(minToTime(m));
  }
  return list;
}

async function loadBusyForDate(dateISO){
  const requestSeq = ++busyRequestSeq;
  if (busyFetchController) busyFetchController.abort();
  busyFetchController = new AbortController();

  try{
    const data = await requestApi({
      action: "busy",
      method: "GET",
      query: { date: dateISO },
      signal: busyFetchController.signal
    });

    if (requestSeq !== busyRequestSeq) return false;

    if (!data || !data.ok) {
      busyIntervals = [];
      return true;
    }
    busyIntervals = Array.isArray(data.intervals) ? data.intervals : [];
    return true;
  } catch(e){
    if (e && e.name === "AbortError") return false;
    if (requestSeq !== busyRequestSeq) return false;
    busyIntervals = [];
    return true;
  } finally {
    if (requestSeq === busyRequestSeq) busyFetchController = null;
  }
}

async function refreshBusyAndSlots(dateISO){
  const applied = await loadBusyForDate(dateISO);
  if (!applied) return;
  if (dateISO === selectedDate) renderSlots();
}

function addBusyIntervalLocal(dateISO, slotTime, durationMin){
  if (dateISO !== selectedDate) return;
  const startMin = timeToMin(slotTime);
  if (!Number.isFinite(startMin)) return;

  const dur = Math.max(Number(durationMin) || 0, STEP_MIN);
  const start = minToTime(startMin);
  const end = minToTime(startMin + dur);

  const exists = busyIntervals.some((it) => it.start === start && it.end === end);
  if (exists) return;
  busyIntervals.push({ start, end, duration_min: dur });
}

function isSlotBusy(slotTime, serviceDurationMin){
  const start = timeToMin(slotTime);
  const end = start + serviceDurationMin;

  for (const it of busyIntervals){
    const bStart = timeToMin(it.start);
    const bEnd = timeToMin(it.end);
    if (overlaps(start, end, bStart, bEnd)) return true;
  }
  return false;
}

function canFitInWorkDay(slotTime, serviceDurationMin){
  const startMin = timeToMin(slotTime);
  const [eh, em] = WORK_END.split(":").map(Number);
  const workEndMin = eh*60 + em;
  return startMin + serviceDurationMin <= workEndMin;
}

function isSlotSelectable(slotTime, serviceDurationMin){
  if (!slotTime || !serviceDurationMin) return false;
  return canFitInWorkDay(slotTime, serviceDurationMin) && !isSlotBusy(slotTime, serviceDurationMin);
}

function renderSlots(){
  const all = generateSlots();
  const durNeed = selectedServiceDuration || 0;
  const checkDuration = durNeed || STEP_MIN;

  if ($("slotsMorning")) $("slotsMorning").innerHTML = "";
  if ($("slotsDay")) $("slotsDay").innerHTML = "";
  if ($("slotsEve")) $("slotsEve").innerHTML = "";

  if (selectedTime && durNeed && !isSlotSelectable(selectedTime, durNeed)) {
    selectedTime = "";
  }

  all.forEach(t => {
    const el = document.createElement("div");
    el.className = "slot" + (selectedTime === t ? " sel" : "");
    el.textContent = t;
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.setAttribute("aria-label", `Время ${t}`);
    el.setAttribute("aria-pressed", selectedTime === t ? "true" : "false");

    // 1) помещается ли услуга в рабочий день
    const fits = !durNeed ? true : canFitInWorkDay(t, durNeed);

    // 2) занято ли (пересечение с busyIntervals)
    const busy = isSlotBusy(t, checkDuration);

    // занятые интервалы не показываем в списке времени
    if (busy) return;

    if (!fits) {
      el.style.opacity = ".35";
      el.style.cursor = "not-allowed";
      el.setAttribute("aria-disabled", "true");
      el.tabIndex = -1;
    } else {
      el.setAttribute("aria-disabled", "false");
      const selectTime = () => {
        selectedTime = t;
        renderSlots();
      };
      el.addEventListener("click", selectTime);
      el.addEventListener("keydown", (event) => handleActivateKeydown(event, selectTime));
    }

    const hh = Number(t.split(":")[0]);
    if (hh < 12) {
      if ($("slotsMorning")) $("slotsMorning").appendChild(el);
    } else if (hh < 17) {
      if ($("slotsDay")) $("slotsDay").appendChild(el);
    } else {
      if ($("slotsEve")) $("slotsEve").appendChild(el);
    }
  });

  if ($("dtSub")) $("dtSub").textContent = (selectedDate && selectedTime) ? `${selectedDate} • ${selectedTime}` : "Не выбрано";
  updateHomeSummary();
}

/***********************
 * HOME SUMMARY
 ***********************/
function updateHomeSummary(){
  const validSelection = Boolean(
    selectedDate &&
    selectedTime &&
    selectedServiceDuration &&
    isSlotSelectable(selectedTime, selectedServiceDuration)
  );
  const ok = Boolean(selectedServiceKey && validSelection);

  if ($("goConfirm")) $("goConfirm").disabled = !ok;

  const need = [];
  if (!selectedServiceKey) need.push("— выбери услугу");
  if (!selectedDate || !selectedTime) need.push("— выбери дату и время");

  if ($("homeNote")) {
    $("homeNote").textContent = ok
      ? `Выбрано: ${selectedServiceKey} • ${selectedDate} • ${selectedTime}`
      : ("Нужно:\n" + need.join("\n"));
  }
}

/***********************
 * CONFIRM + SEND
 ***********************/
function refreshConfirm(){
  if ($("sumLine")) $("sumLine").textContent = `${selectedServiceKey || "—"} • ${selectedDate || "—"} • ${selectedTime || "—"}`;
  if ($("sumSub")) $("sumSub").textContent = `Казань, Дементьева 72к5 • длительность: ${selectedServiceDuration || "?"} мин`;
}

async function sendBooking(){
  const name = normalizeSingleLine($("name") ? $("name").value : "");
  const phoneRaw = normalizeSingleLine($("phone") ? $("phone").value : "");
  const comment = normalizeSingleLine($("comment") ? $("comment").value : "");
  const phone = normalizePhone(phoneRaw);

  if (!selectedServiceKey) return setSendNote("❗ Выбери услугу.");
  if (!selectedDate || !selectedTime) return setSendNote("❗ Выбери дату и время.");
  if (!selectedServiceDuration || !isSlotSelectable(selectedTime, selectedServiceDuration)) {
    await refreshBusyAndSlots(selectedDate);
    return setSendNote("⛔ Выбранное время уже недоступно. Выбери другое.");
  }
  if (!name) return setSendNote("❗ Введи имя.");
  if (!isClientNameValid(name)) return setSendNote(`❗ Имя: ${NAME_MIN_LEN}-${NAME_MAX_LEN} символов.`);
  if (!phoneRaw) return setSendNote("❗ Введи телефон.");
  if (!isPhoneValid(phone)) return setSendNote("❗ Телефон в формате +79990000000.");
  if (!isCommentValid(comment)) return setSendNote(`❗ Комментарий до ${COMMENT_MAX_LEN} символов.`);

  safeSetFieldValue("name", name);
  safeSetFieldValue("phone", phone);
  safeSetFieldValue("comment", comment);

  const btn = $("sendBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Отправляю..."; }

  try{
    const bookingDate = selectedDate;
    const bookingTime = selectedTime;
    const data = await requestApi({
      action: "add",
      method: "POST",
      body: {
        client_name: name,
        phone,
        service: selectedServiceKey,
        date: bookingDate,
        time: bookingTime,
        comment,
        ...getTelegramPayload()
      }
    });

    if (!data || !data.ok) {
      const err = data && data.error ? data.error : "unknown";
      if (err === "slot_busy") {
        setSendNote("⛔ Это время уже занято. Выбери другое.");
        // обновим busy и слоты
        await refreshBusyAndSlots(bookingDate);
      } else if (err === "invalid_secret") {
        setSendNote("❌ Сервер ожидает старый secret. Обнови Apps Script под POST без секрета.");
      } else {
        setSendNote("❌ Ошибка: " + err);
      }
      if (btn) { btn.disabled = false; btn.textContent = "Записаться"; }
      return;
    }

    setSendNote("✅ Записано! Номер:\n" + data.booking_id);
    if (btn) { btn.disabled = false; btn.textContent = "Записаться ещё"; }

    // убираем слот сразу в UI, затем синхронизируемся с сервером
    addBusyIntervalLocal(bookingDate, bookingTime, selectedServiceDuration);
    if (bookingDate === selectedDate) {
      selectedTime = "";
      renderSlots();
    }

    // после успешной записи — подтянем актуальные busy с сервера
    await refreshBusyAndSlots(bookingDate);

    // сохраним профиль (чтоб не вводить снова)
    saveProfile({ name, phone }, true);

    if (tg) tg.showAlert("Запись создана ✅");

  } catch(e){
    const errMsg = String(e);
    if (errMsg.includes("HTTP 405") || errMsg.includes("invalid_json")) {
      setSendNote("❌ Сервер не поддерживает POST. Нужен doPost в Apps Script.");
    } else {
      setSendNote("❌ Ошибка сети: " + errMsg);
    }
    if (btn) { btn.disabled = false; btn.textContent = "Записаться"; }
  }
}

/***********************
 * PROFILE (localStorage)
 ***********************/
function loadProfile(){
  try{
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveProfile(patch, silent=false){
  const current = loadProfile() || { name:"", phone:"", note:"" };
  const draft = { ...current, ...patch };
  const normalizedPhone = draft.phone ? normalizePhone(draft.phone) : "";
  const next = {
    name: normalizeSingleLine(draft.name || ""),
    phone: isPhoneValid(normalizedPhone) ? normalizedPhone : "",
    note: normalizeSingleLine(draft.note || ""),
    saved_at: new Date().toISOString()
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  if (!silent && $("pfStatus")) $("pfStatus").textContent = "✅ Сохранено";
  return next;
}

function resetProfile(){
  localStorage.removeItem(PROFILE_KEY);
  if ($("pfStatus")) $("pfStatus").textContent = "Профиль очищен";
  renderProfile();
  applyProfileToInputs();
}

function renderProfile(){
  const raw = loadProfile() || { name:"", phone:"", note:"" };
  const normalizedPhone = raw.phone ? normalizePhone(raw.phone) : "";
  const p = {
    name: normalizeSingleLine(raw.name || ""),
    phone: isPhoneValid(normalizedPhone) ? normalizedPhone : "",
    note: normalizeSingleLine(raw.note || "")
  };

  let tgName = "";
  let tgUser = "Открыто вне Telegram";
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    const u = tg.initDataUnsafe.user;
    tgName = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    tgUser = u.username ? ("@" + u.username) : ("id: " + u.id);
  }

  if ($("pfNameLine")) $("pfNameLine").textContent = p.name || tgName || "Гость";
  if ($("pfUserLine")) $("pfUserLine").textContent = tgUser;

  if ($("pfName")) $("pfName").value = p.name || tgName || "";
  if ($("pfPhone")) $("pfPhone").value = p.phone || "";
  if ($("pfNote")) $("pfNote").value = p.note || "";
}

function applyProfileToInputs(){
  const p = loadProfile();
  if (!p) return;
  const normalizedPhone = p.phone ? normalizePhone(p.phone) : "";

  if ($("name") && p.name && !$("name").value) $("name").value = p.name;
  if ($("phone") && normalizedPhone && !$("phone").value) $("phone").value = normalizedPhone;
  if ($("comment") && p.note && !$("comment").value) $("comment").value = p.note;
}

/***********************
 * MY BOOKINGS + CANCEL
 ***********************/
async function loadMyBookings(){
  const phoneRaw = normalizeSingleLine($("myPhone") ? $("myPhone").value : "");
  if (!phoneRaw) return setMyNote("❗ Введи телефон.");

  const phone = normalizePhone(phoneRaw);
  if (!isPhoneValid(phone)) return setMyNote("❗ Телефон в формате +79990000000.");
  safeSetFieldValue("myPhone", phone);

  setMyNote("Загружаю...");
  if ($("myList")) $("myList").innerHTML = "";

  try{
    const data = await requestApi({
      action: "my",
      method: "GET",
      query: { phone }
    });

    if (!data || !data.ok){
      setMyNote("❌ Не удалось загрузить.");
      return;
    }

    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length){
      setMyNote("Пока нет записей по этому телефону.");
      return;
    }

    setMyNote("Найдено: " + items.length);
    renderMyList(items, phone);

  } catch(e){
    setMyNote("❌ Ошибка сети: " + String(e));
  }
}

function isoToRu(iso){
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || "");
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function getBookingStatusMeta(status){
  const map = {
    active:    { cls: "ok",      text: "активно" },
    arrived:   { cls: "arrived", text: "пришел" },
    no_show:   { cls: "warn",    text: "не пришел" },
    completed: { cls: "done",    text: "завершено" },
    canceled:  { cls: "cancel",  text: "отменено" }
  };
  return map[status] || map.active;
}

function renderMyList(items, phone){
  const box = $("myList");
  if (!box) return;
  box.innerHTML = "";

  items.forEach(it => {
    const row = document.createElement("div");
    row.className = "myItem";

    const main = document.createElement("div");
    main.className = "myMain";

    const title = document.createElement("div");
    title.className = "myTitle";
    title.textContent = `${it.service} • ${isoToRu(it.date)} • ${it.time}`;

    const statusMeta = getBookingStatusMeta(it.status);
    const badge = document.createElement("span");
    badge.className = "badge " + statusMeta.cls;
    badge.textContent = statusMeta.text;

    const sub = document.createElement("div");
    sub.className = "mySub";
    sub.textContent = `Длительность: ${it.duration_min} мин`;

    main.appendChild(title);
    main.appendChild(badge);
    main.appendChild(document.createElement("div")).style.height="6px";
    main.appendChild(sub);

    row.appendChild(main);

    const actions = document.createElement("div");
    actions.className = "myActions";
    let hasActions = false;

    const appendAction = (label, className, handler) => {
      const btn = document.createElement("button");
      btn.className = "smallBtn " + className;
      btn.textContent = label;
      btn.onclick = handler;
      actions.appendChild(btn);
      hasActions = true;
    };

    const reloadAfterUpdate = async () => {
      await loadMyBookings();
      if (selectedDate) await refreshBusyAndSlots(selectedDate);
    };

    if (it.status === "active") {
      appendAction("Пришел", "ok", async () => {
        const updated = await updateBookingStatus(it.booking_id, phone, "arrived");
        if (updated) await reloadAfterUpdate();
      });
      appendAction("Не пришел", "warn", async () => {
        const updated = await updateBookingStatus(it.booking_id, phone, "no_show");
        if (updated) await reloadAfterUpdate();
      });
      appendAction("Отменить", "danger", async () => {
        const ok = confirm("Отменить запись?\n" + title.textContent);
        if (!ok) return;
        await cancelBooking(it.booking_id, phone);
        await reloadAfterUpdate();
      });
    }

    if (it.status === "arrived") {
      appendAction("Завершено", "ok", async () => {
        const updated = await updateBookingStatus(it.booking_id, phone, "completed");
        if (updated) await reloadAfterUpdate();
      });
      appendAction("Отменить", "danger", async () => {
        const ok = confirm("Отменить запись?\n" + title.textContent);
        if (!ok) return;
        await cancelBooking(it.booking_id, phone);
        await reloadAfterUpdate();
      });
    }

    if (hasActions) row.appendChild(actions);

    box.appendChild(row);
  });
}

async function updateBookingStatus(bookingId, phone, status){
  const normalizedPhone = normalizePhone(phone);
  if (!bookingId) {
    alert("Не удалось обновить статус: нет booking_id");
    return false;
  }
  if (!isPhoneValid(normalizedPhone)) {
    alert("Не удалось обновить статус: неверный формат телефона");
    return false;
  }

  try{
    const data = await requestApi({
      action: "update_status",
      method: "POST",
      body: {
        booking_id: bookingId,
        phone: normalizedPhone,
        status,
        ...getTelegramPayload()
      }
    });

    if (!data || !data.ok){
      const err = data && data.error ? data.error : "unknown";
      alert("Не удалось обновить статус: " + err);
      return false;
    }
    return true;
  } catch(e){
    alert("Ошибка сети: " + String(e));
    return false;
  }
}

async function cancelBooking(bookingId, phone){
  const normalizedPhone = normalizePhone(phone);
  if (!bookingId) {
    alert("Не удалось отменить: нет booking_id");
    return;
  }
  if (!isPhoneValid(normalizedPhone)) {
    alert("Не удалось отменить: неверный формат телефона");
    return;
  }

  try{
    const data = await requestApi({
      action: "cancel",
      method: "POST",
      body: {
        booking_id: bookingId,
        phone: normalizedPhone,
        ...getTelegramPayload()
      }
    });

    if (!data || !data.ok){
      const err = data && data.error ? data.error : "unknown";
      if (err === "invalid_secret") {
        alert("Не удалось отменить: сервер ожидает старый secret. Обнови Apps Script.");
      } else {
        alert("Не удалось отменить: " + err);
      }
      return;
    }
    alert("Запись отменена ✅");
  } catch(e){
    alert("Ошибка сети: " + String(e));
  }
}
