/***********************
 * CONFIG
 ***********************/
const GAS_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=AehSKLjSF9gfwYAxTm3Rp6gDxGW1vdAAytPPL_M3LKuHXvEaF9aRbTFzYnsc1GM2oUB0HK86u4ff4CYQqvbaxtaTgVcsrXdfbKXQrMRSmXa85Y83hpNJR9R__WxZV7RRpDZyLIZMI9mZt8XM3cACB0HhA63aqlahXkfC1r4hEHgA2tvh1L5VZK3Jg2Hrz5aGepbhtzQv315MPsuCtF0jmBnGgntd7GyqXV_0vYzJ4Rr8FNAsPAHxt5z6-MjBtsLMyQaJ19sSTHUhxm7nOzSYtmvPQ8wx6she1UbVURJB2Ibp&lib=Msk6J5SAfuSmEmh1hu5icvZvrIXXso_iG"; // тот URL, который у тебя реально пишет в таблицу
const SECRET  = "12345"; // как в Apps Script

const WORK_START = "10:00";
const WORK_END   = "20:00";
const STEP_MIN   = 30;

const SERVICES = [
  { key:"Стрижка",   name:"Стрижка",   desc:"Классическая стрижка. 30 минут.", duration:30, price:0 },
  { key:"Борода",    name:"Борода",    desc:"Оформление бороды. 30 минут.",    duration:30, price:0 },
  { key:"Комплекс",  name:"Комплекс",  desc:"Стрижка + борода. 60 минут.",     duration:60, price:0 },
];

const PROFILE_KEY = "barber_profile_v1";

// Telegram
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) tg.ready();

/***********************
 * HELPERS
 ***********************/
const $ = (id) => document.getElementById(id);

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
      const fromConfirm = $("phone") ? $("phone").value.trim() : "";
      $("myPhone").value = fromConfirm || (p && p.phone ? p.phone : "") || "";
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

function timeToMin(t){
  const [h,m] = t.split(":").map(Number);
  return h*60+m;
}

function minToTime(m){
  const hh = String(Math.floor(m/60)).padStart(2,"0");
  const mm = String(m%60).padStart(2,"0");
  return `${hh}:${mm}`;
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
    el.addEventListener("click", () => show(el.getAttribute("data-open")));
  });

  if ($("profileBtn")) $("profileBtn").addEventListener("click", () => show("screenProfile"));
  if ($("backBtn")) $("backBtn").addEventListener("click", () => show("screenHome"));

  if ($("goConfirm")) $("goConfirm").addEventListener("click", () => show("screenConfirm"));

  if ($("prevMonth")) $("prevMonth").addEventListener("click", prevMonth);
  if ($("nextMonth")) $("nextMonth").addEventListener("click", nextMonth);

  if ($("svcSearch")) $("svcSearch").addEventListener("input", renderServices);

  if ($("sendBtn")) $("sendBtn").addEventListener("click", sendBooking);

  if ($("pfSave")) $("pfSave").addEventListener("click", () => {
    const name = $("pfName") ? $("pfName").value.trim() : "";
    const phone = $("pfPhone") ? $("pfPhone").value.trim() : "";
    const note = $("pfNote") ? $("pfNote").value.trim() : "";
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
  loadBusyForDate(selectedDate).then(() => renderSlots());

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

        if ($("svcSub")) $("svcSub").textContent = selectedServiceKey;

        // после выбора услуги просто перерисуем слоты (busyIntervals уже загружены на выбранную дату)
        renderServices();
        renderSlots();
        updateHomeSummary();
      });

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
      updateHomeSummary();

      // главное: загрузить busy для даты и перерисовать слоты
      loadBusyForDate(selectedDate).then(() => renderSlots());
    });

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
  try{
    const url = new URL(GAS_URL);
    url.searchParams.set("action","busy");
    url.searchParams.set("date", dateISO);

    const r = await fetch(url.toString(), { method:"GET" });
    const data = await r.json().catch(()=>null);

    if (!data || !data.ok) {
      busyIntervals = [];
      return;
    }
    busyIntervals = Array.isArray(data.intervals) ? data.intervals : [];
  } catch(e){
    busyIntervals = [];
  }
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

function renderSlots(){
  const all = generateSlots();
  const durNeed = selectedServiceDuration || 0;

  if ($("slotsMorning")) $("slotsMorning").innerHTML = "";
  if ($("slotsDay")) $("slotsDay").innerHTML = "";
  if ($("slotsEve")) $("slotsEve").innerHTML = "";

  const [eh, em] = WORK_END.split(":").map(Number);
  const workEndMin = eh*60 + em;

  all.forEach(t => {
    const el = document.createElement("div");
    el.className = "slot" + (selectedTime === t ? " sel" : "");
    el.textContent = t;

    const startMin = timeToMin(t);

    // 1) помещается ли услуга в рабочий день
    const fits = !durNeed ? true : (startMin + durNeed <= workEndMin);

    // 2) занято ли (пересечение с busyIntervals)
    const busy = durNeed ? isSlotBusy(t, durNeed) : false;

    if (!fits || busy) {
      el.style.opacity = ".35";
      el.style.cursor = "not-allowed";
    } else {
      el.addEventListener("click", () => {
        selectedTime = t;
        renderSlots();
        updateHomeSummary();
      });
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
}

/***********************
 * HOME SUMMARY
 ***********************/
function updateHomeSummary(){
  const ok = Boolean(selectedServiceKey && selectedDate && selectedTime);

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
  const name = $("name") ? $("name").value.trim() : "";
  const phone = $("phone") ? $("phone").value.trim() : "";
  const comment = $("comment") ? $("comment").value.trim() : "";

  if (!selectedServiceKey) return setSendNote("❗ Выбери услугу.");
  if (!selectedDate || !selectedTime) return setSendNote("❗ Выбери дату и время.");
  if (!name) return setSendNote("❗ Введи имя.");
  if (!phone) return setSendNote("❗ Введи телефон.");

  const btn = $("sendBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Отправляю..."; }

  try{
    const url = new URL(GAS_URL);
    url.searchParams.set("action","add");
    url.searchParams.set("secret", SECRET);
    url.searchParams.set("client_name", name);
    url.searchParams.set("phone", phone);
    url.searchParams.set("service", selectedServiceKey);
    url.searchParams.set("date", selectedDate);
    url.searchParams.set("time", selectedTime);
    url.searchParams.set("comment", comment);

    // telegram user info (если открыто в телеге)
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      const u = tg.initDataUnsafe.user;
      url.searchParams.set("tg_user_id", String(u.id));
      url.searchParams.set("tg_username", u.username ? String(u.username) : "");
    }

    const r = await fetch(url.toString(), { method:"GET" });
    const data = await r.json().catch(()=>null);

    if (!data || !data.ok) {
      const err = data && data.error ? data.error : "unknown";
      if (err === "slot_busy") {
        setSendNote("⛔ Это время уже занято. Выбери другое.");
        // обновим busy и слоты
        await loadBusyForDate(selectedDate);
        renderSlots();
      } else {
        setSendNote("❌ Ошибка: " + err);
      }
      if (btn) { btn.disabled = false; btn.textContent = "Записаться"; }
      return;
    }

    setSendNote("✅ Записано! Номер:\n" + data.booking_id);
    if (btn) btn.textContent = "Готово";

    // после успешной записи — обновим busy, чтобы слот стал серым сразу
    await loadBusyForDate(selectedDate);
    renderSlots();

    // сохраним профиль (чтоб не вводить снова)
    saveProfile({ name, phone }, true);

    if (tg) tg.showAlert("Запись создана ✅");

  } catch(e){
    setSendNote("❌ Ошибка сети: " + String(e));
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
  const next = { ...current, ...patch, saved_at: new Date().toISOString() };
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
  const p = loadProfile() || { name:"", phone:"", note:"" };

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

  if ($("name") && p.name && !$("name").value) $("name").value = p.name;
  if ($("phone") && p.phone && !$("phone").value) $("phone").value = p.phone;
  if ($("comment") && p.note && !$("comment").value) $("comment").value = p.note;
}

/***********************
 * MY BOOKINGS + CANCEL
 ***********************/
async function loadMyBookings(){
  const phone = $("myPhone") ? $("myPhone").value.trim() : "";
  if (!phone) return setMyNote("❗ Введи телефон.");

  setMyNote("Загружаю...");
  if ($("myList")) $("myList").innerHTML = "";

  try{
    const url = new URL(GAS_URL);
    url.searchParams.set("action","my");
    url.searchParams.set("phone", phone);

    const r = await fetch(url.toString(), { method:"GET" });
    const data = await r.json().catch(()=>null);

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
    title.textContent = `${it.service} • ${it.date} • ${it.time}`;

    const badge = document.createElement("span");
    badge.className = "badge " + (it.status === "canceled" ? "cancel" : "ok");
    badge.textContent = it.status === "canceled" ? "отменено" : "активно";

    const sub = document.createElement("div");
    sub.className = "mySub";
    sub.textContent = `Длительность: ${it.duration_min} мин\nID: ${it.booking_id}`;

    main.appendChild(title);
    main.appendChild(badge);
    main.appendChild(document.createElement("div")).style.height="6px";
    main.appendChild(sub);

    row.appendChild(main);

    if (it.status !== "canceled") {
      const btn = document.createElement("button");
      btn.className = "smallBtn danger";
      btn.textContent = "Отменить";
      btn.onclick = async () => {
        const ok = confirm("Отменить запись?\n" + title.textContent);
        if (!ok) return;
        await cancelBooking(it.booking_id, phone);
        await loadMyBookings();
        if (selectedDate) {
          await loadBusyForDate(selectedDate);
          renderSlots();
        }
      };
      row.appendChild(btn);
    }

    box.appendChild(row);
  });
}

async function cancelBooking(bookingId, phone){
  try{
    const url = new URL(GAS_URL);
    url.searchParams.set("action","cancel");
    url.searchParams.set("booking_id", bookingId);
    url.searchParams.set("phone", phone);

    const r = await fetch(url.toString(), { method:"GET" });
    const data = await r.json().catch(()=>null);

    if (!data || !data.ok){
      alert("Не удалось отменить: " + (data && data.error ? data.error : "unknown"));
      return;
    }
    alert("Запись отменена ✅");
  } catch(e){
    alert("Ошибка сети: " + String(e));
  }
}
