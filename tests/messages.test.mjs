import test from "node:test";
import assert from "node:assert/strict";
import {
  appointmentReminderMessage,
  normalizePhoneForMessaging,
  reminderChannelLinks,
} from "../app/lib/messages.mjs";

const appointment = {
  car: "BMW X5",
  service: "Химчистка",
  datetime: "2026-10-12T14:30",
};

test("Russian reminder includes the appointment date, time, car, and service", () => {
  const message = appointmentReminderMessage(appointment, "ru");
  assert.match(message, /BMW X5/);
  assert.match(message, /12 октября 2026 г\./);
  assert.match(message, /14:30/);
  assert.match(message, /Химчистка/);
});

test("Romanian reminder is localized and includes the appointment details", () => {
  const message = appointmentReminderMessage(appointment, "ro");
  assert.match(message, /Bună ziua/);
  assert.match(message, /BMW X5/);
  assert.match(message, /12 octombrie 2026/);
  assert.match(message, /14:30/);
  assert.match(message, /Химчистка/);
});

test("all four reminder channels receive a prepared message", () => {
  const message = appointmentReminderMessage(appointment, "ru");
  const channels = reminderChannelLinks("+373 69 123 456", message);
  assert.deepEqual(channels.map(({ id }) => id), ["sms", "whatsapp", "viber", "telegram"]);
  assert.match(channels[0].href, /^sms:\+37369123456\?body=/);
  assert.match(channels[1].href, /^https:\/\/wa\.me\/37369123456\?text=/);
  assert.equal(channels[2].href, "viber://chat?number=%2B37369123456");
  assert.equal(channels[3].href, `https://t.me/+37369123456?text=${encodeURIComponent(message)}`);
  assert.equal(channels[2].copyBeforeOpen, true);
  assert.equal(channels[3].copyBeforeOpen, undefined);
  assert.ok(channels[0].href.includes("BMW%20X5"));
  assert.ok(channels[1].href.includes("BMW%20X5"));
});

test("normalizes Moldovan mobile numbers and rejects malformed local numbers", () => {
  for (const phone of ["069 123 456", "0 (69) 123-456", "69 123 456", "+373 69 123 456", "00373 69 123 456"]) {
    assert.equal(normalizePhoneForMessaging(phone), "37369123456");
  }
  assert.equal(normalizePhoneForMessaging("+40 721 234 567"), "40721234567");
  assert.equal(normalizePhoneForMessaging("069 123 45"), "");
  assert.ok(reminderChannelLinks("069 123 45", "Text").every(({ href }) => !href));
});

test("custom reminders replace documented variables and leave unknown tokens visible", () => {
  const message = appointmentReminderMessage(
    { ...appointment, phone: "+37369123456", servicePrice: 1500 },
    "ru",
    "{{client}}|{{phone}}|{{service}}|{{date}}|{{time}}|{{price}}|{{business}}|{{unknown}}",
  );
  assert.match(message, /^BMW X5\|\+37369123456\|Химчистка\|12 октября 2026 г\.\|14:30\|1\s?500 MDL\|ANGEL DETAILING\|\{\{unknown\}\}$/);
});
