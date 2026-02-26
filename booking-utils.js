/* eslint-disable no-var */
(function(root, factory){
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }
  root.BookingUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(){
  "use strict";

  function timeToMin(t){
    var value = String(t || "");
    var parts = value.split(":");
    if (parts.length !== 2) return NaN;
    var h = Number(parts[0]);
    var m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
    return h * 60 + m;
  }

  function minToTime(totalMin){
    var min = Number(totalMin);
    if (!Number.isFinite(min)) return "00:00";
    var hh = String(Math.floor(min / 60)).padStart(2, "0");
    var mm = String(min % 60).padStart(2, "0");
    return hh + ":" + mm;
  }

  function normalizePhone(raw){
    var value = String(raw || "").trim();
    if (!value) return "";

    value = value.replace(/[^\d+]/g, "");
    value = value.replace(/(?!^)\+/g, "");
    if (value.startsWith("00")) value = "+" + value.slice(2);

    if (value.startsWith("+")) {
      var internationalDigits = value.slice(1).replace(/\D/g, "");
      return internationalDigits ? "+" + internationalDigits : "";
    }

    var digits = value.replace(/\D/g, "");
    if (!digits) return "";

    if (digits.length === 11 && digits.startsWith("8")) return "+7" + digits.slice(1);
    if (digits.length === 11 && digits.startsWith("7")) return "+7" + digits.slice(1);
    if (digits.length === 10) return "+7" + digits;
    return "+" + digits;
  }

  function isPhoneValid(phone){
    return /^\+\d{10,15}$/.test(String(phone || ""));
  }

  function isClientNameValid(name, minLen, maxLen){
    var value = String(name || "").trim();
    var min = Number(minLen || 2);
    var max = Number(maxLen || 60);
    return value.length >= min && value.length <= max;
  }

  function isCommentValid(comment, maxLen){
    var value = String(comment || "");
    var max = Number(maxLen || 240);
    return value.length <= max;
  }

  return {
    timeToMin: timeToMin,
    minToTime: minToTime,
    normalizePhone: normalizePhone,
    isPhoneValid: isPhoneValid,
    isClientNameValid: isClientNameValid,
    isCommentValid: isCommentValid
  };
});
