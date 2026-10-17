import test from "node:test";
import assert from "node:assert/strict";
import { summarizeWeatherForDate } from "../app/lib/weather.mjs";

const timeseries = [
  {
    time: "2026-10-17T08:00:00Z",
    data: {
      instant: { details: { air_temperature: 10, wind_speed: 3 } },
      next_1_hours: {
        summary: { symbol_code: "partlycloudy_day" },
        details: { precipitation_amount: 0.6 },
      },
    },
  },
  {
    time: "2026-10-17T13:00:00Z",
    data: {
      instant: { details: { air_temperature: 15, wind_speed: 5 } },
      next_1_hours: {
        summary: { symbol_code: "heavyrain" },
        details: { precipitation_amount: 2.4 },
      },
    },
  },
  {
    time: "2026-10-17T21:00:00Z",
    data: {
      instant: { details: { air_temperature: 22, wind_speed: 10 } },
      next_1_hours: {
        summary: { symbol_code: "clearsky_day" },
        details: { precipitation_amount: 0 },
      },
    },
  },
];

test("summarizes local Chisinau day and excludes hours from the next date", () => {
  assert.deepEqual(summarizeWeatherForDate(timeseries, "2026-10-17"), {
    date: "2026-10-17",
    temperatureMin: 10,
    temperatureMax: 15,
    precipitation: 3,
    windSpeedMax: 5,
    symbolCode: "partlycloudy_day",
    hourly: [
      {
        time: "11:00",
        temperature: 10,
        windSpeed: 3,
        precipitation: 0.6,
        intervalHours: 1,
        symbolCode: "partlycloudy_day",
      },
      {
        time: "16:00",
        temperature: 15,
        windSpeed: 5,
        precipitation: 2.4,
        intervalHours: 1,
        symbolCode: "heavyrain",
      },
    ],
  });
});

test("returns no forecast when the selected local date is outside the response", () => {
  assert.equal(summarizeWeatherForDate(timeseries, "2026-10-20"), null);
});
