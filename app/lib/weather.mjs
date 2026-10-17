const WEATHER_TIME_ZONE = "Europe/Chisinau";
const DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: WEATHER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const HOUR_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: WEATHER_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});
const LOCAL_TIME_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  timeZone: WEATHER_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const localDateFor = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    DATE_PARTS_FORMATTER.formatToParts(date).map(({ type, value: part }) => [type, part]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const localHourFor = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 12;
  return Number(HOUR_FORMATTER.format(date));
};

export function summarizeWeatherForDate(timeseries, dateKey) {
  const entries = (timeseries || []).filter(({ time }) => localDateFor(time) === dateKey);
  if (!entries.length) return null;

  const temperatures = entries
    .map(({ data }) => Number(data?.instant?.details?.air_temperature))
    .filter(Number.isFinite);
  const windSpeeds = entries
    .map(({ data }) => Number(data?.instant?.details?.wind_speed))
    .filter(Number.isFinite);
  const precipitation = entries.reduce((total, { data }) => {
    const details =
      data?.next_1_hours?.details ||
      data?.next_6_hours?.details ||
      data?.next_12_hours?.details;
    const amount = Number(details?.precipitation_amount);
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const representative = entries.reduce((closest, entry) =>
    Math.abs(localHourFor(entry.time) - 13) < Math.abs(localHourFor(closest.time) - 13)
      ? entry
      : closest,
  );
  const symbolCode =
    representative.data?.next_1_hours?.summary?.symbol_code ||
    representative.data?.next_6_hours?.summary?.symbol_code ||
    representative.data?.next_12_hours?.summary?.symbol_code ||
    "cloudy";
  const hourly = entries.map(({ time, data }) => {
    const interval = data?.next_1_hours
      ? data.next_1_hours
      : data?.next_6_hours
        ? data.next_6_hours
        : data?.next_12_hours;
    const temperature = Number(data?.instant?.details?.air_temperature);
    const windSpeed = Number(data?.instant?.details?.wind_speed);
    const precipitationAmount = Number(interval?.details?.precipitation_amount);
    return {
      time: LOCAL_TIME_FORMATTER.format(new Date(time)),
      temperature: Number.isFinite(temperature) ? temperature : null,
      windSpeed: Number.isFinite(windSpeed) ? windSpeed : null,
      precipitation: Number.isFinite(precipitationAmount) ? precipitationAmount : 0,
      intervalHours: data?.next_1_hours ? 1 : data?.next_6_hours ? 6 : 12,
      symbolCode:
        interval?.summary?.symbol_code ||
        data?.next_6_hours?.summary?.symbol_code ||
        data?.next_12_hours?.summary?.symbol_code ||
        "cloudy",
    };
  });

  return {
    date: dateKey,
    temperatureMin: temperatures.length ? Math.min(...temperatures) : null,
    temperatureMax: temperatures.length ? Math.max(...temperatures) : null,
    precipitation: Math.round(precipitation * 10) / 10,
    windSpeedMax: windSpeeds.length ? Math.max(...windSpeeds) : null,
    symbolCode,
    hourly,
  };
}
