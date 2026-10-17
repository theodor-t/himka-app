import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "../../lib/auth";
import { summarizeWeatherForDate } from "../../lib/weather.mjs";

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export async function GET(request) {
  try {
    const username = verifySessionToken(
      (await cookies()).get(SESSION_COOKIE)?.value,
    );
    if (!username) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parameters = new URL(request.url).searchParams;
    const latitude = Number(parameters.get("lat"));
    const longitude = Number(parameters.get("lon"));
    const date = parameters.get("date");
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < 45 ||
      latitude > 49 ||
      longitude < 26 ||
      longitude > 31 ||
      !isValidDate(date)
    ) {
      return NextResponse.json({ error: "Invalid weather location or date" }, { status: 400 });
    }

    const weatherUrl = new URL(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact",
    );
    weatherUrl.searchParams.set("lat", latitude.toFixed(4));
    weatherUrl.searchParams.set("lon", longitude.toFixed(4));
    const response = await fetch(weatherUrl, {
      headers: {
        "User-Agent": "ANGEL-DETAILING-Calendar/1.0 (https://angel-detailing-nu.vercel.app)",
      },
      next: { revalidate: 1800 },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: "Weather provider unavailable" },
        { status: 502 },
      );
    }

    const payload = await response.json();
    const forecast = summarizeWeatherForDate(payload.properties?.timeseries, date);
    return NextResponse.json(
      { forecast, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "private, max-age=1800" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not load weather forecast" },
      { status: 502 },
    );
  }
}
