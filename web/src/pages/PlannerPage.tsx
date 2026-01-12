import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getMustVisitDetail } from "../data/mustVisitDetails";
import { planTripClient } from "../planner/clientPlanner";

const INTEREST_KEYS = ["nature", "culture", "food", "sport"] as const;
type InterestKey = (typeof INTEREST_KEYS)[number];
type Interests = Record<InterestKey, number>;

const RANK_WEIGHTS = [40, 30, 20, 10];

const DEFAULT_ORDER: InterestKey[] = [...INTEREST_KEYS];

const orderToMap = (order: InterestKey[]): Interests => {
  const map = {} as Interests;
  order.forEach((key, index) => {
    map[key] = RANK_WEIGHTS[index];
  });
  return map;
};

const DEFAULT_INTERESTS: Interests = orderToMap(DEFAULT_ORDER);
const BALANCED_INTERESTS: Interests = {
  nature: 25,
  culture: 25,
  food: 25,
  sport: 25,
};

const INTEREST_COPY: Record<InterestKey, string> = {
  nature: "Peaks, lakes, and scenic landscapes",
  culture: "Museums, heritage sites, and neighbourhood walks",
  food: "Culinary experiences, tastings, and markets",
  sport: "Adventure, adrenaline, and outdoor thrills",
};

const formatInterest = (key: InterestKey) => key.charAt(0).toUpperCase() + key.slice(1);

type Attraction = {
  slug: string;
  name: string;
  city: string;
  image: string;
};

const BASE_ATTRACTIONS: Attraction[] = [
  { slug: "faelensee", name: "Fälensee", city: "Appenzell", image: "/attractions/faelensee.jpg" },
  { slug: "old-city-of-bern", name: "Old City of Bern", city: "Bern", image: "/attractions/old-city-of-bern.jpg" },
  { slug: "stoos", name: "Stoos", city: "Schwyz", image: "/attractions/stoos.jpg" },
  { slug: "muerrenbahn", name: "Mürrenbahn", city: "Interlaken", image: "/attractions/muerrenbahn.jpg" },
  { slug: "gornergrat", name: "Gornergrat", city: "Zermatt", image: "/attractions/gornergrat.jpg" },
  { slug: "grosser-mythen", name: "Grosser Mythen", city: "Schwyz", image: "/attractions/grosser-mythen.jpg" },
  { slug: "mount-rigi", name: "Mount Rigi", city: "Lucerne", image: "/attractions/mount-rigi.jpg" },
  { slug: "interlaken-water-sports", name: "Interlaken Water Sports", city: "Interlaken", image: "/attractions/interlaken-water-sports.jpg" },
  { slug: "gurten", name: "Gurten", city: "Bern", image: "/attractions/gurten.jpg" },
];

const shuffle = <T,>(items: T[]): T[] => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const INITIAL_ATTRACTIONS = shuffle(BASE_ATTRACTIONS);

const CITY_OPTIONS = [
  "appenzell",
  "bern",
  "geneva",
  "interlaken",
  "kandersteg",
  "lausanne",
  "lucerne",
  "lugano",
  "montreux",
  "schwyz",
  "sion",
  "st-gallen",
  "st-moritz",
  "zermatt",
  "zurich",
] as const;

function labelForCity(slug: string): string {
  if (!slug) return "";
  const cleaned = slug.replace(/[_]/g, "-").trim().toLowerCase();
  const parts = cleaned.split("-").filter(Boolean);
  return parts
    .map((part) => {
      if (part === "st" || part === "st." || part === "saint") return "St.";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").trim();
const PLAN_STORAGE_KEY = "alpScheduler:lastPlan";
const PLANNER_INPUTS_KEY = "alpScheduler:lastInputs";

const PlannerPage = () => {
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [days, setDays] = useState<number>(7);
  const [daysText, setDaysText] = useState<string>("7");
  const [season, setSeason] = useState("summer");
  const [maxHours, setMaxHours] = useState<number>(8);
  const [maxHoursText, setMaxHoursText] = useState<string>("8");
  const [rankOrder, setRankOrder] = useState<InterestKey[]>(DEFAULT_ORDER);
  const [interests, setInterests] = useState<Interests>({ ...DEFAULT_INTERESTS });
  const [balancedMode, setBalancedMode] = useState<boolean>(false);
  const previousRankOrderRef = useRef<InterestKey[]>(DEFAULT_ORDER);
  const [showHowWorks, setShowHowWorks] = useState<boolean>(false);
  const dragIndexRef = useRef<number | null>(null);
  const [attractions, setAttractions] = useState<Attraction[]>(INITIAL_ATTRACTIONS);

  // Must‑visit flow state
  const [mvIndex, setMvIndex] = useState<number>(0);
  const [mvSelected, setMvSelected] = useState<string[]>([]);
  const [mvConfirming, setMvConfirming] = useState<boolean>(false);
  const [mvMessage, setMvMessage] = useState<string | null>(null);
  const [mvDone, setMvDone] = useState<boolean>(false);
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load previously saved inputs (so Adjust Preferences retains settings)
  useEffect(() => {
    const stored = sessionStorage.getItem(PLANNER_INPUTS_KEY);
    if (!stored) return;
    try {
      const data = JSON.parse(stored) as {
        from?: string;
        to?: string;
        days?: number;
        season?: string;
        interests?: Interests;
        rankOrder?: InterestKey[];
        maxHours?: number;
      };
      if (data.from) setFrom(data.from);
      if (data.to) setTo(data.to);
      if (data.days) {
        setDays(data.days);
        setDaysText(String(data.days));
      }
      if (data.season) setSeason(data.season);
      if (data.maxHours) {
        setMaxHours(data.maxHours);
        setMaxHoursText(String(data.maxHours));
      }
      if (data.interests) {
        setInterests(data.interests);
        const storedOrder =
          data.rankOrder && data.rankOrder.length === INTEREST_KEYS.length
            ? (data.rankOrder as InterestKey[])
            : [...INTEREST_KEYS];
        const isBalancedStored = INTEREST_KEYS.every(
          (key) => Math.abs((data.interests?.[key] ?? 0) - 25) < 0.0001
        );
        if (isBalancedStored) {
          setBalancedMode(true);
          previousRankOrderRef.current = storedOrder;
          setRankOrder(storedOrder);
        } else {
          const sorted = [...INTEREST_KEYS].sort((a, b) =>
            (data.interests?.[a] ?? 0) > (data.interests?.[b] ?? 0) ? -1 : 1
          );
          const nextOrder = storedOrder.length === INTEREST_KEYS.length ? storedOrder : sorted;
          setRankOrder(nextOrder);
          setBalancedMode(false);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const totalPct = useMemo(
    () =>
      Object.values(interests).reduce((sum, n) => sum + (isNaN(n) ? 0 : n), 0),
    [interests]
  );

  const remainingPct = 100 - totalPct;
  const overLimit = remainingPct < 0;
  const maxMust = Math.max(0, days - 2);
  const canAddMore = mvSelected.length < maxMust;
  const currentAttraction = attractions[mvIndex] ?? attractions[0];

  const displayRanks = useMemo(
    () => rankOrder.map((key, index) => ({ key, position: index + 1 })),
    [rankOrder]
  );

  const applyRankOrder = (order: InterestKey[]) => {
    setRankOrder(order);
    setInterests(orderToMap(order));
  };

  const moveInterest = (index: number, direction: number) => {
    if (balancedMode) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rankOrder.length) return;
    const updated = [...rankOrder];
    [updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]];
    applyRankOrder(updated);
  };

  const handleDragStart = (index: number) => (event: DragEvent<HTMLDivElement>) => {
    if (balancedMode) return;
    dragIndexRef.current = index;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", rankOrder[index]);
  };

  const handleDragOver = (index: number) => (event: DragEvent<HTMLDivElement>) => {
    if (balancedMode) return;
    event.preventDefault();
    const start = dragIndexRef.current;
    if (start === null || start === index) return;
    const updated = [...rankOrder];
    const [removed] = updated.splice(start, 1);
    updated.splice(index, 0, removed);
    dragIndexRef.current = index;
    applyRankOrder(updated);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
  };

  const toggleBalanced = () => {
    if (balancedMode) {
      setBalancedMode(false);
      const restore = previousRankOrderRef.current ?? DEFAULT_ORDER;
      applyRankOrder(restore);
    } else {
      previousRankOrderRef.current = [...rankOrder];
      setBalancedMode(true);
      setInterests({ ...BALANCED_INTERESTS });
    }
  };

  // Must‑visit controls
  function nextAttraction() {
    if (attractions.length === 0) return;
    setMvIndex((i) => (i + 1) % attractions.length);
  }

  function addCurrentAttraction() {
    const current = attractions[mvIndex];
    if (!current) return;
    if (maxMust <= 0) {
      setMvMessage("Increase your total travel days to unlock Must‑Visits for this trip.");
      return;
    }

    const alreadySelected = mvSelected.includes(current.slug);
    const tentativeLength = alreadySelected ? mvSelected.length : mvSelected.length + 1;
    if (tentativeLength > maxMust) {
      setMvMessage(
        `Limit reached: you can add up to ${maxMust} Must‑Visits for a ${days}-day trip. Increase total days to add more.`
      );
      return;
    }

    const nextSelected = alreadySelected ? mvSelected : [...mvSelected, current.slug];
    if (!alreadySelected) setMvSelected(nextSelected);

    setMvConfirming(true);
    setTimeout(() => {
      setMvConfirming(false);
      setMvMessage(null);

      const forward = attractions.findIndex(
        (item, idx) => idx > mvIndex && !nextSelected.includes(item.slug)
      );
      if (forward !== -1) {
        setMvIndex(forward);
      } else {
        const backward = Array.from(attractions.keys())
          .reverse()
          .find((idx) => idx !== mvIndex && !nextSelected.includes(attractions[idx].slug));
        if (backward !== undefined && backward >= 0) {
          setMvIndex(backward);
        } else {
          const firstUnselected = attractions.findIndex((item) => !nextSelected.includes(item.slug));
          if (firstUnselected !== -1) setMvIndex(firstUnselected);
        }
      }

      if (nextSelected.length >= maxMust || nextSelected.length === attractions.length) {
        setMvMessage("Must‑Visits saved. You can finish now or keep adjusting other inputs.");
      }
    }, 1200);
  }

  function prevAttraction() {
    setMvMessage(null);
    if (attractions.length === 0) return;
    setMvIndex((i) => (i - 1 + attractions.length) % attractions.length);
  }

  function removeSelected(slug: string) {
    setMvSelected((prev) => prev.filter((s) => s !== slug));
    setMvMessage(null);
  }

  function reopenMustVisits() {
    setMvDone(false);
    setMvMessage(null);
    setMvConfirming(false);
    const nextIdx = attractions.findIndex((a) => !mvSelected.includes(a.slug));
    setMvIndex(nextIdx === -1 ? 0 : nextIdx);
  }

  // Keyboard navigation for desktop
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (mvDone || mvConfirming) return;
      if (e.key === "ArrowLeft") prevAttraction();
      if (e.key === "ArrowRight") nextAttraction();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mvDone, mvConfirming, mvIndex]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDetailSlug(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function sanitizeDaysText(raw: string, allowEmpty: boolean): string {
    const digits = (raw || "").replace(/\D+/g, "");
    if (digits === "") return allowEmpty ? "" : "1";
    const noLead = digits.replace(/^0+(?=\d)/, "");
    const n = Math.max(1, Math.min(21, parseInt(noLead || "1", 10)));
    return String(n);
  }

  function updateDays(value: string, allowEmpty = true) {
    const text = sanitizeDaysText(value, allowEmpty);
    setDaysText(text);
    const n = parseInt(text || "0", 10);
    setDays(isNaN(n) ? 1 : Math.max(1, Math.min(21, n)));
  }

  function resetAll() {
    setFrom("");
    setTo("");
    setDays(7);
    setDaysText("7");
    setSeason("summer");
    setRankOrder(DEFAULT_ORDER);
    setInterests({ ...DEFAULT_INTERESTS });
    setBalancedMode(false);
    previousRankOrderRef.current = DEFAULT_ORDER;
    setAttractions(shuffle(BASE_ATTRACTIONS));
    setMvIndex(0);
    setMvSelected([]);
    setMvConfirming(false);
    setMvMessage(null);
    setMvDone(false);
    setDetailSlug(null);
    sessionStorage.removeItem(PLAN_STORAGE_KEY);
    sessionStorage.removeItem(PLANNER_INPUTS_KEY);
  }

  async function startPlanning() {
    if (!from || !to) {
      setSubmitError("Please choose both a start and end city.");
      return;
    }
    if (overLimit || totalPct !== 100) {
      setSubmitError("Interest weights must total 100% before planning.");
      return;
    }
    const parsedHours = Number(maxHoursText.trim());
    if (!Number.isInteger(parsedHours) || parsedHours < 4 || parsedHours > 10) {
      setSubmitError("Maximum hours per day must be an integer between 4 and 10.");
      return;
    }
    if (parsedHours !== maxHours) {
      setMaxHours(parsedHours);
    }

    setSubmitError(null);
    setIsSubmitting(true);

    const weights = {
      nature: interests.nature / 100,
      culture: interests.culture / 100,
      food: interests.food / 100,
      sport: interests.sport / 100,
    };

    const body = {
      fromCity: from,
      toCity: to,
      days,
      season,
      preferences: weights,
      maxHoursPerDay: parsedHours,
    };

    try {
      let data;
      const useClientPlanner = import.meta.env.PROD && !API_BASE;
      if (useClientPlanner) {
        data = await planTripClient(body);
      } else {
        try {
          const response = await fetch(`${API_BASE}/api/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const info = await response.json().catch(() => ({}));
            const message = info.detail || "Unable to generate itinerary. Try different inputs.";
            throw new Error(message);
          }

          data = await response.json();
        } catch (error) {
          if (!API_BASE) {
            data = await planTripClient(body);
          } else {
            throw error;
          }
        }
      }
      sessionStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(data));
      // persist current inputs for Adjust Preferences
      sessionStorage.setItem(
        PLANNER_INPUTS_KEY,
        JSON.stringify({ from, to, days, season, interests, rankOrder, maxHours: parsedHours })
      );
      navigate("/planner/itinerary", { state: data });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to reach the planner service.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
    <section className="planner" id="planner">
      <div className="planner__card">
        <div className="planner__header">
          <h2>Plan your route</h2>
          <div className="planner__mode">Routes</div>
        </div>

        <div className="row fromto">
          <label>From</label>
          <select
            className="input-lg"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            <option value="">Select city</option>
            {CITY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {labelForCity(c)}
              </option>
            ))}
          </select>
          <label>To</label>
          <select
            className="input-lg"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Select city</option>
            {CITY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {labelForCity(c)}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <label>Total travel days</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={daysText}
            onChange={(e) => updateDays(e.target.value, true)}
            onBlur={(e) => updateDays(e.target.value, false)}
          />
        </div>

        <div className="row">
          <label>Season</label>
          <select value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="spring">Spring</option>
            <option value="summer">Summer</option>
            <option value="autumn">Autumn</option>
            <option value="winter">Winter</option>
          </select>
        </div>

        <div className="row">
          <label>Maximum hours for travel and activities each day</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={maxHoursText}
            onChange={(e) => {
              setMaxHoursText(e.target.value);
              const trimmed = e.target.value.trim();
              if (!trimmed) return;
              const next = Number(trimmed);
              if (Number.isInteger(next)) {
                setMaxHours(next);
              }
            }}
            onBlur={(e) => {
              const trimmed = e.target.value.trim();
              const next = Number(trimmed);
              if (!Number.isInteger(next) || next < 4 || next > 10) {
                setMaxHoursText(String(maxHours));
              } else {
                setMaxHours(next);
                setMaxHoursText(String(next));
              }
            }}
          />
        </div>

        <div className="row row--interests">
          <div className="interests-heading">
            <label>Prioritise interests</label>
            <button
              type="button"
              className="interest-info"
              onClick={() => setShowHowWorks(true)}
            >
              <span className="interest-info__icon">?</span>
              <span>How it works</span>
            </button>
          </div>
          <div className="interest-rank">
            {displayRanks.map(({ key, position }) => (
              <div
                key={key}
                className="interest-rank__item"
                draggable={!balancedMode}
                onDragStart={handleDragStart(position - 1)}
                onDragOver={handleDragOver(position - 1)}
                onDragEnd={handleDragEnd}
                onDrop={(event) => event.preventDefault()}
              >
                <div className="interest-rank__left">
                  <span
                    className={`interest-rank__badge ${balancedMode ? "interest-rank__badge--dot" : ""}`}
                  >
                    {balancedMode ? "" : `#${position}`}
                  </span>
                  <div className="interest-rank__text">
                    <span className="interest-rank__label">{formatInterest(key)}</span>
                    <span className="interest-rank__hint">{INTEREST_COPY[key]}</span>
                  </div>
                </div>
                {!balancedMode && (
                  <div className="interest-rank__right">
                    <div className="interest-rank__actions">
                      <button
                        type="button"
                        onClick={() => moveInterest(position - 1, -1)}
                        disabled={position === 1}
                        aria-label={`Move ${formatInterest(key)} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveInterest(position - 1, 1)}
                        disabled={position === displayRanks.length}
                        aria-label={`Move ${formatInterest(key)} down`}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="interests-actions">
            <button type="button" className="btn btn--ghost" onClick={toggleBalanced}>
              {balancedMode ? "Customise priorities" : "Balance priorities"}
            </button>
          </div>
        </div>

        {/* Must‑Visit Recommendations Section */}
        <div className="mv">
          <div className="mv__header">
            <h3>Must‑Visit Recommendations</h3>
            <div className="mv__meta">
              <span>Limit: {maxMust}</span>
              <span>Selected: {mvSelected.length}</span>
            </div>
          </div>

          {!mvDone ? (
            <>
              {currentAttraction && (
                <div
                  className={`mv-card ${mvConfirming ? "mv-added" : ""}`}
                  style={{ backgroundImage: `url(${currentAttraction.image})` }}
                >
                  <div className="mv-card__top">
                    <button
                      type="button"
                      className="mv-pill mv-pill--button"
                      onClick={() => setDetailSlug(currentAttraction.slug)}
                    >
                      View details
                    </button>
                    <span className="mv-count">{mvIndex + 1}/{attractions.length}</span>
                  </div>
                  <div className="mv-card__overlay"></div>
                  <div className="mv-card__bottom">
                    <div className="mv-text">
                      <div className="mv-city">{labelForCity(currentAttraction.city)}</div>
                      <div className="mv-title">{currentAttraction.name}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mv-arrow mv-arrow--left"
                    onClick={prevAttraction}
                    disabled={attractions.length <= 1}
                    aria-label="Previous"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="mv-arrow mv-arrow--right"
                    onClick={nextAttraction}
                    disabled={attractions.length <= 1}
                    aria-label="Next"
                  >
                    ›
                  </button>
                  {mvConfirming && (
                    <div className="mv-confirm">
                      <div className="mv-tick">✓</div>
                      <div className="mv-msg">Added to your trip</div>
                    </div>
                  )}
                </div>
              )}

              <div className="mv-actions">
                <button
                  type="button"
                  className="btn btn--must"
                  onClick={addCurrentAttraction}
                  disabled={!canAddMore || mvConfirming}
                >
                  Add to Must‑Visits
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setMvDone(true)}
                >
                  Finish selecting
                </button>
              </div>
              {mvSelected.length > 0 && (
                <div className="mv-selected mv-selected--inline">
                  <div className="mv-selected__label">Added so far:</div>
                  <ul className="mv-selected__list">
                    {mvSelected.map((slug) => {
                      const a = attractions.find((x) => x.slug === slug);
                      if (!a) return null;
                      return (
                        <li key={slug} className="mv-chip">
                          <span className="mv-chip__text">{a.name} – {a.city}</span>
                          <button
                            className="mv-chip__del"
                            onClick={() => removeSelected(slug)}
                            aria-label={`Remove ${a.name}`}
                          >
                            -
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mv-done">Great picks — your Must‑Visits are set!</div>
              <div className="mv-selected">
                {mvSelected.length === 0 ? (
                  <div className="mv-selected__empty">No Must‑Visits selected.</div>
                ) : (
                  <ul className="mv-selected__list">
                    {mvSelected.map((slug) => {
                      const a = attractions.find((x) => x.slug === slug);
                      if (!a) return null;
                      return (
                        <li key={slug} className="mv-chip">
                          <span className="mv-chip__text">{a.name} – {a.city}</span>
                          <button
                            className="mv-chip__del"
                            onClick={() => removeSelected(slug)}
                            aria-label={`Remove ${a.name}`}
                          >
                            -
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="mv-finish-actions">
                <button type="button" className="btn btn--ghost" onClick={reopenMustVisits}>
                  Review attractions again
                </button>
              </div>
            </>
          )}

          {mvMessage && <div className="mv-message">{mvMessage}</div>}
        </div>

        <div className="planner__actions">
          <button
          className="btn btn--primary btn--dark"
          disabled={
            isSubmitting ||
            totalPct !== 100 ||
            !from ||
            !to ||
              days < 1 ||
              days > 21
            }
            onClick={startPlanning}
          >
            {isSubmitting ? "Planning…" : "Start planning"}
          </button>
          <button type="button" className="link" onClick={resetAll}>Clear all</button>
        </div>
        {submitError && <p className="form-error" role="alert">{submitError}</p>}
      </div>
      {detailSlug && (
        <DetailModal slug={detailSlug} onClose={() => setDetailSlug(null)} />
      )}
    </section>
    {showHowWorks && (
      <div className="planner-modal" role="dialog" aria-modal="true">
        <div className="planner-modal__backdrop" onClick={() => setShowHowWorks(false)} />
        <div className="planner-modal__card">
          <h3>How prioritising interests works</h3>
          <p>
            Your highest ranked theme receives the strongest weighting when we pick daily
            activities: 40% for the top choice, followed by 30%, 20%, and 10% for the remaining
            spots. These probabilities only apply when matching attractions are available in the
            chosen city—otherwise the planner automatically moves to the next suitable theme.
          </p>
          <p>
            Selecting <strong>Balance priorities</strong> gives every theme an equal 25% share and
            temporarily locks the ranking. Choose <strong>Customise priorities</strong> whenever you
            want to reorder interests again and return to the weighted approach.
          </p>
          <button type="button" className="btn btn--dark" onClick={() => setShowHowWorks(false)}>
            Got it
          </button>
        </div>
      </div>
    )}
    </>
  );
};

export default PlannerPage;

type DetailModalProps = {
  slug: string;
  onClose: () => void;
};

const DetailModal = ({ slug, onClose }: DetailModalProps) => {
  const detail = getMustVisitDetail(slug);
  if (!detail) return null;
  return (
    <div className="mv-modal" role="dialog" aria-modal="true">
      <div className="mv-modal__backdrop" onClick={onClose} />
      <div className="mv-modal__card">
        <button className="mv-modal__close" onClick={onClose} aria-label="Close details">
          ×
        </button>
        <div className="mv-modal__header">
          <h3>{detail.name}</h3>
          <span className="mv-modal__city">{detail.city}</span>
        </div>
        <p className="mv-modal__intro">{detail.intro}</p>
        <div className="mv-modal__seasons">
          Best seasons: <span>{detail.seasons.join(" · ")}</span>
        </div>
        <div className="mv-modal__body">
          {detail.description.map((paragraph, idx) => (
            <p key={idx}>{paragraph}</p>
          ))}
        </div>
      </div>
    </div>
  );
};
