const test = require("node:test");
const assert = require("node:assert/strict");

const {
  timeToMin,
  minToTime,
  normalizePhone,
  isPhoneValid,
  isClientNameValid,
  isCommentValid
} = require("../booking-utils.js");

test("time helpers convert correctly", () => {
  assert.equal(timeToMin("10:30"), 630);
  assert.equal(minToTime(630), "10:30");
  assert.equal(Number.isNaN(timeToMin("bad")), true);
});

test("normalizePhone handles common input formats", () => {
  assert.equal(normalizePhone("+7 999 000-00-00"), "+79990000000");
  assert.equal(normalizePhone("8 (999) 000-00-00"), "+79990000000");
  assert.equal(normalizePhone("9990000000"), "+79990000000");
  assert.equal(normalizePhone("+1 (415) 555-2671"), "+14155552671");
  assert.equal(normalizePhone(""), "");
});

test("isPhoneValid accepts only E.164-like phone strings", () => {
  assert.equal(isPhoneValid("+79990000000"), true);
  assert.equal(isPhoneValid("+14155552671"), true);
  assert.equal(isPhoneValid("79990000000"), false);
  assert.equal(isPhoneValid("+7999"), false);
});

test("name and comment validation enforce limits", () => {
  assert.equal(isClientNameValid("Илья"), true);
  assert.equal(isClientNameValid("A"), false);
  assert.equal(isClientNameValid("X".repeat(61)), false);
  assert.equal(isCommentValid("X".repeat(240)), true);
  assert.equal(isCommentValid("X".repeat(241)), false);
});
