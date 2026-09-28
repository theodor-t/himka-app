import { parseRecordDate } from "./finance.mjs";

export const DEFAULT_REMINDER_TEMPLATES = {
  ru: "Здравствуйте, {{client}}! Напоминаем, что вы записаны в {{business}} {{date}} в {{time}}{{service_phrase}}. Пожалуйста, подтвердите, что сможете приехать. Ждём вас!",
  ro: "Bună ziua, {{client}}! Vă reamintim că aveți o programare la {{business}} pe {{date}}, la ora {{time}}{{service_phrase}}. Vă rugăm să confirmați dacă puteți ajunge. Vă așteptăm!",
};

export const REMINDER_VARIABLES = [
  { key: "{{client}}", description: "Имя клиента или название автомобиля" },
  { key: "{{phone}}", description: "Номер телефона клиента" },
  { key: "{{service}}", description: "Название услуги (пусто, если не указана)" },
  { key: "{{service_phrase}}", description: "Услуга с подходящей языку фразой (например, «на услугу»)" },
  { key: "{{date}}", description: "Дата записи в выбранном языке" },
  { key: "{{time}}", description: "Время записи" },
  { key: "{{price}}", description: "Цена услуги (пусто, если не задана)" },
  { key: "{{business}}", description: "Название мастерской" },
];

export function appointmentReminderMessage(
  client,
  language = "ru",
  template = DEFAULT_REMINDER_TEMPLATES[language] || DEFAULT_REMINDER_TEMPLATES.ru,
) {
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
  const price = client?.servicePrice !== "" && client?.servicePrice != null
    ? `${Number(client.servicePrice).toLocaleString(locale)} MDL`
    : "";
  const variables = {
    client: client?.car || "",
    phone: client?.phone || "",
    service: client?.service || "",
    service_phrase: service.trim(),
    date,
    time,
    price,
    business: "ANGEL DETAILING",
  };
  return String(template).replace(/\{\{([a-z_]+)\}\}/gi, (match, key) =>
    Object.hasOwn(variables, key.toLowerCase()) ? variables[key.toLowerCase()] : match,
  );
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
      href: `viber://chat?number=${encodeURIComponent(`+${digits}`)}`,
      copyBeforeOpen: true,
    },
    {
      id: "telegram",
      label: "Telegram",
      href: `https://t.me/+${digits}`,
      copyBeforeOpen: true,
    },
  ];
}
