// ===== НАСТРОЙКИ ПОД ТВОЮ ТАБЛИЦУ =====
const GAS_URL = "https://script.google.com/macros/s/AKfycbzOvqr-TxyexCwenrSGmrIJlGESxYWrvZVw45Er9cuXtDU7iPBbVEc1Z0uknISjhH6m/exec";
const SECRET  = "12345"; // потом поменяешь

const WORK_START = "10:00";
const WORK_END   = "20:00";
const STEP_MIN   = 30;

const SERVICES = [
  { key:"Стрижка", name:"Стрижка", desc:"Классическая стрижка. 30 минут.", duration:30, price:0 },
  { key:"Борода", name:"Борода", desc:"Оформление бороды. 30 минут.", duration:30, price:0 },
  { key:"Комплекс", name:"Комплекс", desc:"Стрижка + борода. 60 минут.", duration:60, price:0 },
];

const PROFILE_KEY = "barber_profile_v1";

// Telegram
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
}

// ===== DOM HELPERS =====
const $ = (id) => document.getElementById(id);

function show(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(screenId).classList.add("active");
  $("backBtn").style.visibility = (screenId === "screenHome") ? "hidden" : "visible";

  if (screenId === "screenConfirm") {
    refreshConfirm();
    applyProfileToInputs();
  }
  if (screenId === "screenProfile") {
    renderProfile();
  }
}

// ===== NAV =====
document.querySelectorAll("[data-open]").forEach(el => {
  el.addEventListener("click", () => show(el.getAttribute("data-open")));
});

$("profileBtn").addEventListener("click", () => show("screenProfile"));
$("backBtn").addEventListener("click", () => show("screenHome"));
$("goConfirm").addEventListener("click", () => show("screenConfirm"));

// ===== STATE =====
let selectedServiceKey = "";
let selectedServiceDuration = 0;
let selectedDate = "";
let selectedTime = "";
let viewYear, viewMonth;

// init default date (tomorrow)
(function init() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  selectedDate = toISODate(d);

  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();

  // calendar buttons
  $("prevMonth").addEventListener("click", prevMonth);
  $("nextMonth").addEventListener("click", nextMonth);

  // services search
  $("svcSearch").addEventListener("input", renderServices);

  // send
  $("sendBtn").addEventListener("click", sendBooking);

  // profile buttons
  $("pfSave").addEventListener("click", saveProfile);
  $("pfReset").addEventListener("click", resetProfile);

  renderCalendar();
  renderSlots();
  renderServices();
  updateHomeSummary();

  // Telegram autofill name in profile (first run)
  const p = loadProfile();
  if (!p && tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    const u = tg.initDataUnsafe.user;
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    saveProfile({ name, phone:"", note:"" }, true);
  }
})();

// ===== DATE HELPERS =====
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

// ===== SERVICES =====
function renderServices() {
  const q = ($("svcSearch").value || "").toLowerCase().trim();
  const box = $("servicesList");
  box.innerHTML = "";

  SERVICES
    .filter(s => !q || s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q))
    .forEach(s => {
      const row = document.createElement("div");
      row.className = "svcCard";

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
      chk.textContent = (selectedServiceKey === s.key ? "✓" : "");

      row.addEventListener("click", () => {
        selectedServiceKey = s.key;
        selectedServiceDuration = s.duration;
        $("svcSub").textContent = selectedServiceKey;
        renderServices();
        renderSlots();
        updateHomeSummary();
      });

      row.appendChild(img);
      row.appendChild(info);
      row.appendChild(chk);
      box.appendChild(row);
    });

  $("svcSub").textContent = selectedServiceKey || "Не выбрано";
}

// ===== CALENDAR =====
function renderCalendar() {
  const monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
  $("calMonth").textContent = `${monthNames[viewMonth]} ${viewYear}`;

  const dow = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
  $("calDow").innerHTML = "";
  dow.forEach(d => {
    const el = document.createElement("div");
    el.className = "dow";
    el.textContent = d;
    $("calDow").appendChild(el);
  });

  $("calDays").innerHTML = "";

  const first = new Date(viewYear, viewMonth, 1);
  let startOffset = (first.getDay() + 6) % 7; // Monday=0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const todayISO = toISODate(new Date());

  for (let i = 0; i < startOffset; i++) {
    const el = document.createElement("div");
    el.className = "day muted";
    $("calDays").appendChild(el);
  }

  for (let day=1; day<=daysInMonth; day++) {
    const d = new Date(viewYear, viewMonth, day);
    const iso = toISODate(d);

    const el = document.createElement("div");
    el.className = "day";
    el.textContent = String(day);

    if (iso < todayISO) el.classList.add("muted");
    if (iso === todayISO) el.classList.add("today");
    if (iso === selectedDate) el.classList.add("sel");

    el.addEventListener("click", () => {
      if (iso < todayISO) return;
      selectedDate = iso;
      selectedTime = "";
      renderCalendar();
      renderSlots();
      updateHomeSummary();
    });

    $("calDays").appendChild(el);
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

// ===== SLOTS =====
function generateSlots() {
  const [sh, sm] = WORK_START.split(":").map(Number);
  const [eh, em] = WORK_END.split(":").map(Number);
  const startMin = sh*60 + sm;
  const endMin = eh*60 + em;

  const list = [];
  for (let m=startMin; m<endMin; m += STEP_MIN) {
    const h = String(Math.floor(m/60)).padStart(2,"0");
    const mm = String(m%60).padStart(2,"0");
    list.push(`${h}:${mm}`);
  }
  return list;
}

function renderSlots(){
  const all = generateSlots();
  const need = selectedServiceDuration || 0;

  $("slotsMorning").innerHTML = "";
  $("slotsDay").innerHTML = "";
  $("slotsEve").innerHTML = "";

  all.forEach(t => {
    const [hh, mm] = t.split(":").map(Number);
    const start = hh*60 + mm;
    const [eh, em] = WORK_END.split(":").map(Number);
    const end = eh*60 + em;
    const fits = !need ? true : (start + need <= end);

    const el = document.createElement("div");
    el.className = "slot" + (selectedTime === t ? " sel" : "");
    el.textContent = t;

    if (!fits) {
      el.style.opacity = ".35";
      el.style.cursor = "not-allowed";
    } else {
      el.addEventListener("click", () => {
        selectedTime = t;
        renderSlots();
        updateHomeSummary();
      });
    }

    if (hh < 12) $("slotsMorning").appendChild(el);
    else if (hh < 17) $("slotsDay").appendChild(el);
    else $("slotsEve").appendChild(el);
  });

  $("dtSub").textContent = (selectedDate && selectedTime) ? `${selectedDate} • ${selectedTime}` : "Не выбрано";
}

// ===== HOME SUMMARY =====
function updateHomeSummary(){
  const ok = Boolean(selectedServiceKey && selectedDate && selectedTime);
  $("goConfirm").disabled = !ok;

  const need = [];
  if (!selectedServiceKey) need.push("— выбери услугу");
  if (!selectedDate || !selectedTime) need.push("— выбери дату и время");

  $("homeNote").textContent = ok
    ? `Выбрано: ${selectedServiceKey} • ${selectedDate} • ${selectedTime}`
    : ("Нужно:\n" + need.join("\n"));
}

// ===== CONFIRM =====
function refreshConfirm(){
  $("sumLine").textContent = `${selectedServiceKey || "—"} • ${selectedDate || "—"} • ${selectedTime || "—"}`;
  $("sumSub").textContent = `Казань, Дементьева 72к5 • длительность: ${selectedServiceDuration || "?"} мин`;
  applyProfileToInputs();
}

function setSendNote(text){
  $("sendNote").textContent = text;
}

// ===== SEND =====
async function sendBooking(){
  const name = $("name").value.trim();
  const phone = $("phone").value.trim();
  const comment = $("comment").value.trim();

  if (!selectedServiceKey) return setSendNote("❗ Выбери услугу.");
  if (!selectedDate || !selectedTime) return setSendNote("❗ Выбери дату и время.");
  if (!name) return setSendNote("❗ Введи имя.");
  if (!phone) return setSendNote("❗ Введи телефон.");

  $("sendBtn").disabled = true;
  $("sendBtn").textContent = "Отправляю...";

  try {
    const url = new URL(GAS_URL);
    url.searchParams.set("action","add");
    url.searchParams.set("secret",SECRET);
    url.searchParams.set("client_name",name);
    url.searchParams.set("phone",phone);
    url.searchParams.set("service",selectedServiceKey);
    url.searchParams.set("date",selectedDate);
    url.searchParams.set("time",selectedTime);
    url.searchParams.set("comment",comment);

    const r = await fetch(url.toString(), { method:"GET" });
    const data = await r.json().catch(()=>null);

    if (!data || !data.ok) {
      setSendNote("❌ Ошибка: " + (data && data.error ? data.error : "unknown"));
      $("sendBtn").disabled = false;
      $("sendBtn").textContent = "Записаться";
      return;
    }

    setSendNote("✅ Записано! Номер:\n" + data.booking_id);
    $("sendBtn").textContent = "Готово";

    if (tg) tg.showAlert("Запись создана ✅");
  } catch (e) {
    setSendNote("❌ Ошибка сети: " + String(e));
    $("sendBtn").disabled = false;
    $("sendBtn").textContent = "Записаться";
  }
}

// ===== PROFILE (localStorage) =====
function loadProfile(){
  try{
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveProfile(patch, silent=false){
  const current = loadProfile() || { name:"", phone:"", note:"" };
  const next = { ...current, ...patch, saved_at: new Date().toISOString() };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  if (!silent) $("pfStatus").textContent = "✅ Сохранено";
  return next;
}

function resetProfile(){
  localStorage.removeItem(PROFILE_KEY);
  $("pfStatus").textContent = "Профиль очищен";
  renderProfile();
  applyProfileToInputs();
}

function renderProfile(){
  const p = loadProfile() || { name:"", phone:"", note:"" };

  let tgName = "";
  let tgUser = "Открыто вне Telegram";
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    const u = tg.initDataUnsafe.user;
    tgName = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    tgUser = u.username ? ("@" + u.username) : ("id: " + u.id);
  }

  $("pfNameLine").textContent = p.name || tgName || "Гость";
  $("pfUserLine").textContent = tgUser;

  $("pfName").value = p.name || tgName || "";
  $("pfPhone").value = p.phone || "";
  $("pfNote").value = p.note || "";
}

function applyProfileToInputs(){
  const p = loadProfile();
  if (!p) return;
  if (p.name && !$("name").value) $("name").value = p.name;
  if (p.phone && !$("phone").value) $("phone").value = p.phone;
  if (p.note && !$("comment").value) $("comment").value = p.note;
}

$("pfSave").addEventListener("click", () => {
  const name = $("pfName").value.trim();
  const phone = $("pfPhone").value.trim();
  const note = $("pfNote").value.trim();
  saveProfile({ name, phone, note });
});
