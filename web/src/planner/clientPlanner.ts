import type { PlanDay, PlanPOI, PlanResponse } from "../types/plan";

type PreferenceWeights = {
  nature: number;
  culture: number;
  food: number;
  sport: number;
};

export type PlanRequest = {
  fromCity: string;
  toCity: string;
  days: number;
  season: string;
  preferences: PreferenceWeights;
  maxHoursPerDay: number;
};

type RawPoi = {
  identifier: string;
  name: string;
  city: string;
  abstract?: string | null;
  description?: string | null;
  photo?: string | null;
  nature?: boolean;
  culture?: boolean;
  food?: boolean;
  sport?: boolean;
  season?: string[] | string | null;
};

type DistancePayload = {
  duration_minutes?: number | null;
  status?: string | null;
};

type DistanceGraph = Record<string, Record<string, DistancePayload>>;

type PlannerData = {
  poisByCity: Record<string, RawPoi[]>;
  distances: DistanceGraph;
};

const DATA_URLS = {
  pois: "/data/selected_city_pois_llm_theme_labeled.json",
  distances: "/data/google_city_distances.json",
};

const CITY_DISTANCE_TO_POI: Record<string, string> = {
  "Appenzell, Switzerland": "appenzell",
  "Bern, Switzerland": "bern",
  "Geneva, Switzerland": "geneva",
  "Interlaken, Switzerland": "interlaken",
  "Kandersteg, Switzerland": "kandersteg",
  "Lausanne, Switzerland": "lausanne",
  "Lucerne, Switzerland": "luzern",
  "Lugano, Switzerland": "lugano",
  "Montreux, Switzerland": "montreux",
  "Schwyz, Switzerland": "schwyz",
  "Sion, Switzerland": "sion",
  "St. Gallen, Switzerland": "st_gallen",
  "St. Moritz, Switzerland": "st_moritz",
  "Zermatt, Switzerland": "zermatt",
  "Zurich, Switzerland": "zurich",
};

const UI_CITY_TO_POI: Record<string, string> = {
  appenzell: "appenzell",
  bern: "bern",
  geneva: "geneva",
  interlaken: "interlaken",
  kandersteg: "kandersteg",
  lausanne: "lausanne",
  lucerne: "luzern",
  lugano: "lugano",
  montreux: "montreux",
  schwyz: "schwyz",
  sion: "sion",
  "st-gallen": "st_gallen",
  "st-moritz": "st_moritz",
  zermatt: "zermatt",
  zurich: "zurich",
};

const POI_TO_DISTANCE: Record<string, string> = Object.fromEntries(
  Object.entries(CITY_DISTANCE_TO_POI).map(([distanceCity, poiCity]) => [poiCity, distanceCity])
);

let cachedData: Promise<PlannerData> | null = null;

async function loadPlannerData(): Promise<PlannerData> {
  if (cachedData) return cachedData;
  cachedData = (async () => {
    const [poisResponse, distancesResponse] = await Promise.all([
      fetch(DATA_URLS.pois),
      fetch(DATA_URLS.distances),
    ]);

    if (!poisResponse.ok) {
      throw new Error(`Failed to load POI data (${poisResponse.status}).`);
    }
    if (!distancesResponse.ok) {
      throw new Error(`Failed to load distance data (${distancesResponse.status}).`);
    }

    const pois = (await poisResponse.json()) as RawPoi[];
    const distancesPayload = (await distancesResponse.json()) as {
      distances?: DistanceGraph;
    };

    const poisByCity: Record<string, RawPoi[]> = {};
    for (const poi of pois) {
      const cityKey = poi.city?.toLowerCase?.() || "";
      if (!cityKey) continue;
      if (!poisByCity[cityKey]) {
        poisByCity[cityKey] = [];
      }
      poisByCity[cityKey].push(poi);
    }

    return {
      poisByCity,
      distances: distancesPayload.distances ?? {},
    };
  })();

  return cachedData;
}

function normaliseCitySlug(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function toDistanceCity(slug: string): string {
  const normalised = normaliseCitySlug(slug);
  const poiCity = UI_CITY_TO_POI[normalised] ?? normalised.replace(/-/g, "_");
  return POI_TO_DISTANCE[poiCity] ?? slug;
}

function toPoiCity(slug: string): string {
  const normalised = normaliseCitySlug(slug);
  return UI_CITY_TO_POI[normalised] ?? normalised.replace(/-/g, "_");
}

function formatCityLabel(value: string): string {
  if (!value) return "";
  const cleaned = value.replace(/[_-]+/g, " ").trim();
  return cleaned
    .split(/\s+/)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "st" || lower === "st." || lower === "saint") return "St.";
      if (lower === "luzern" || lower === "lucerne") return "Lucerne";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function isPoiInSeason(poi: RawPoi, season: string): boolean {
  const seasons = poi.season;
  if (!seasons) return true;
  if (Array.isArray(seasons)) {
    return seasons.map((s) => s.toLowerCase()).includes(season.toLowerCase());
  }
  return seasons.toLowerCase().includes(season.toLowerCase());
}

function scorePoi(poi: RawPoi, weights: PreferenceWeights): number {
  return (
    (poi.nature ? weights.nature : 0) +
    (poi.culture ? weights.culture : 0) +
    (poi.food ? weights.food : 0) +
    (poi.sport ? weights.sport : 0)
  );
}

function selectPoisForDay(
  pois: RawPoi[],
  season: string,
  weights: PreferenceWeights,
  maxHoursPerDay: number
): RawPoi[] {
  const inSeason = pois.filter((poi) => isPoiInSeason(poi, season));
  const pool = inSeason.length > 0 ? inSeason : pois;
  const count = Math.max(2, Math.min(4, Math.round(maxHoursPerDay / 2)));
  return [...pool]
    .sort((a, b) => scorePoi(b, weights) - scorePoi(a, weights))
    .slice(0, count);
}

function shortestPath(
  graph: DistanceGraph,
  start: string,
  end: string
): { path: string[] } {
  const distances: Record<string, number> = {};
  const previous: Record<string, string | null> = {};
  const nodes = new Set(Object.keys(graph));

  for (const node of nodes) {
    distances[node] = Number.POSITIVE_INFINITY;
    previous[node] = null;
  }
  distances[start] = 0;

  while (nodes.size > 0) {
    let current: string | null = null;
    let smallest = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      const distance = distances[node];
      if (distance < smallest) {
        smallest = distance;
        current = node;
      }
    }
    if (!current) break;
    nodes.delete(current);
    if (current === end) break;

    const neighbors = graph[current] ?? {};
    for (const [neighbor, payload] of Object.entries(neighbors)) {
      if (!nodes.has(neighbor)) continue;
      const duration = payload.duration_minutes ?? Number.POSITIVE_INFINITY;
      if (!Number.isFinite(duration)) continue;
      const nextDistance = distances[current] + duration;
      if (nextDistance < distances[neighbor]) {
        distances[neighbor] = nextDistance;
        previous[neighbor] = current;
      }
    }
  }

  const path: string[] = [];
  let cursor: string | null = end;
  while (cursor) {
    path.unshift(cursor);
    cursor = previous[cursor];
  }

  if (path[0] !== start) {
    return { path: [start, end] };
  }

  return { path };
}

function buildCitySchedule(path: string[], days: number): string[] {
  if (days <= 1) return [path[0]];
  const lastIndex = path.length - 1;
  const schedule: string[] = [];
  for (let day = 0; day < days; day += 1) {
    const ratio = day / (days - 1);
    const idx = Math.round(ratio * lastIndex);
    schedule.push(path[idx]);
  }
  return schedule;
}

function travelMinutesBetween(
  graph: DistanceGraph,
  fromCity: string,
  toCity: string
): number {
  if (fromCity === toCity) return 0;
  const duration = graph[fromCity]?.[toCity]?.duration_minutes;
  if (typeof duration === "number") return duration;
  const reverse = graph[toCity]?.[fromCity]?.duration_minutes;
  return typeof reverse === "number" ? reverse : 0;
}

export async function planTripClient(request: PlanRequest): Promise<PlanResponse> {
  const data = await loadPlannerData();
  const startDistance = toDistanceCity(request.fromCity);
  const endDistance = toDistanceCity(request.toCity);

  const { path } = shortestPath(data.distances, startDistance, endDistance);
  const schedule = buildCitySchedule(path, request.days);

  const days: PlanDay[] = schedule.map((distanceCity, index) => {
    const poiCity = CITY_DISTANCE_TO_POI[distanceCity] ?? toPoiCity(distanceCity);
    const cityPois = data.poisByCity[poiCity] ?? [];
    const selected = selectPoisForDay(
      cityPois,
      request.season,
      request.preferences,
      request.maxHoursPerDay
    );

    const fromDistance = index === 0 ? null : schedule[index - 1];
    const travelMinutes =
      fromDistance && fromDistance !== distanceCity
        ? travelMinutesBetween(data.distances, fromDistance, distanceCity)
        : 0;

    const dayPois: PlanPOI[] = selected.map((poi) => ({
      identifier: poi.identifier,
      name: poi.name,
      city: formatCityLabel(poi.city),
      labels: [
        poi.nature ? "nature" : null,
        poi.culture ? "culture" : null,
        poi.food ? "food" : null,
        poi.sport ? "sport" : null,
      ].filter(Boolean) as string[],
      description: poi.description ?? null,
      abstract: poi.abstract ?? null,
      photo: poi.photo ?? null,
    }));

    const toCity = formatCityLabel(poiCity);
    const fromCity = fromDistance
      ? formatCityLabel(CITY_DISTANCE_TO_POI[fromDistance] ?? fromDistance)
      : null;

    return {
      day: index + 1,
      title: `${fromCity ?? "Start"} → ${toCity}`,
      from_city: fromDistance && fromDistance !== distanceCity ? fromCity : null,
      to_city: toCity,
      travel_minutes: travelMinutes,
      summary: dayPois.map((poi) => poi.name),
      note: null,
      pois: dayPois,
    };
  });

  return {
    from_city: formatCityLabel(toPoiCity(request.fromCity)),
    to_city: formatCityLabel(toPoiCity(request.toCity)),
    num_days: request.days,
    season: request.season,
    days,
    score: null,
    score_components: null,
  };
}
