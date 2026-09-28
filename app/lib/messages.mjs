import { parseRecordDate } from "./finance.mjs";

export function appointmentReminderMessage(client, language = "ru") {
  const isRomanian = language === "ro";
  const locale = isRomanian ? "ro-RO" : "ru-RU";
  const appointment = parseRecordDate(client?.datetime);
  const date = appointment
    ? new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(appointment)
    : "";
  const time = appointment
    ? new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(appointment)
    : "";
  const service = client?.service
    ? isRomanian
      ? ` pentru serviciul ${client.service}`
      : ` на услугу «${client.service}»`
    : "";

  if (isRomanian) {
    return `Bună ziua, ${client?.car || ""}! Vă reamintim că aveți o programare la ANGEL DETAILING pe ${date}, la ora ${time}${service}. Vă rugăm să confirmați dacă puteți ajunge. Vă așteptăm!`;
  }

  return `Здравствуйте, ${client?.car || ""}! Напоминаем, что вы записаны в ANGEL DETAILING ${date} в ${time}${service}. Пожалуйста, подтвердите, что сможете приехать. Ждём вас!`;
}

export function reminderChannelLinks(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  const encodedMessage = encodeURIComponent(message);
  return [
    { id: "sms", label: "SMS", href: `sms:+${digits}?body=${encodedMessage}` },
    {
      id: "whatsapp",
      label: "WhatsApp",
      href: `https://wa.me/${digits}?text=${encodedMessage}`,
    },
    {
      id: "viber",
      label: "Viber",
      href: `viber://forward?text=${encodedMessage}`,
    },
    {
      id: "telegram",
      label: "Telegram",
      href: `https://t.me/share/url?text=${encodedMessage}`,
    },
  ];
}
