const dom = {
    status: document.getElementById("status"),
    current: document.getElementById("current"),
    forecast: document.getElementById("forecast"),
    searchInput: document.getElementById("searchInput"),
    searchBtn: document.getElementById("searchBtn"),
    suggestions: document.getElementById("suggestions"),
    useLocationBtn: document.getElementById("useLocationBtn"),
    unitC: document.getElementById("unitC"),
    unitF: document.getElementById("unitF"),
    year: document.getElementById("year"),
    video: document.getElementById("weatherVideo")
};

let state = {
    unit: localStorage.getItem("unit") || "c",
    lastPlace: null,
};

const weatherCodeMap = {
    0: { label: "Clear sky", icon: "☀️" },
    1: { label: "Mainly clear", icon: "🌤️" },
    2: { label: "Partly cloudy", icon: "⛅" },
    3: { label: "Overcast", icon: "☁️" },
    45: { label: "Fog", icon: "🌫️" },
    48: { label: "Depositing rime fog", icon: "🌫️" },
    51: { label: "Light drizzle", icon: "🌦️" },
    53: { label: "Moderate drizzle", icon: "🌦️" },
    55: { label: "Dense drizzle", icon: "🌧️" },
    56: { label: "Light freezing drizzle", icon: "🌧️" },
    57: { label: "Dense freezing drizzle", icon: "🌧️" },
    61: { label: "Slight rain", icon: "🌧️" },
    63: { label: "Rain", icon: "🌧️" },
    65: { label: "Heavy rain", icon: "🌧️" },
    66: { label: "Light freezing rain", icon: "🌧️" },
    67: { label: "Heavy freezing rain", icon: "🌧️" },
    71: { label: "Slight snow fall", icon: "🌨️" },
    73: { label: "Snow fall", icon: "🌨️" },
    75: { label: "Heavy snow fall", icon: "❄️" },
    77: { label: "Snow grains", icon: "❄️" },
    80: { label: "Rain showers", icon: "🌧️" },
    81: { label: "Heavy rain showers", icon: "🌧️" },
    82: { label: "Violent rain showers", icon: "🌧️" },
    85: { label: "Snow showers", icon: "❄️" },
    86: { label: "Heavy snow showers", icon: "❄️" },
    95: { label: "Thunderstorm", icon: "⛈️" },
    96: { label: "Thunderstorm with hail", icon: "⛈️" },
    99: { label: "Thunderstorm with heavy hail", icon: "⛈️" },
};

const THUNDER_CODES = new Set([95, 96, 99]);
const RAIN_CODES = new Set([
  51,53,55,56,57, 
  61,63,65,66,67, 
  80,81,82        
]);

const PRECIP_RAIN_THRESHOLD = 0.1; 

function getVideoForConditions(code, precipValue) {

  if (THUNDER_CODES.has(code)) return "thunderstorm.mp4";

 
  if (RAIN_CODES.has(code) || (typeof precipValue === "number" && precipValue > PRECIP_RAIN_THRESHOLD)) {
    return "rain.mp4";
  }

  if (code === 0 || code === 1) return "sunny.mp4";

  return "cloud.mp4";
}

function setWeatherBackgroundVideoByCode(code, precipValue) {
  const videoEl = dom.video || document.getElementById('weatherVideo');
  if (!videoEl) {
    console.warn("weatherVideo element missing in HTML.");
    return;
  }

  const newSrc = getVideoForConditions(code, precipValue);

  if (videoEl.dataset.currentSrc === newSrc) return; 

  videoEl.classList.add('fade-out');
  setTimeout(() => {
    videoEl.pause();
    videoEl.src = newSrc;
    videoEl.dataset.currentSrc = newSrc;

    let posterKey = "cloud";
    if (newSrc.startsWith("sunny")) posterKey = "sunny";
    else if (newSrc.startsWith("rain")) posterKey = "rain"; 
    else if (newSrc.startsWith("thunderstorm")) posterKey = "thunderstorm";

    videoEl.setAttribute("poster", `assets/img/${posterKey}.jpg`);

    const p = videoEl.play();
    if (p && typeof p.then === "function") {
      p.catch(() => {
        document.body.classList.add("no-video");
      });
    }
    videoEl.classList.remove('fade-out');
  }, 300);
}

document.addEventListener('click', function once() {
  const v = dom.video;
  if (v && v.paused) v.play().catch(()=>{});
  document.removeEventListener('click', once);
});

function setStatus(message, type = "info") {
    if (!dom.status) return;
    dom.status.textContent = message || "";
    dom.status.style.color =
        type === "error"
            ? "var(--danger)"
            : type === "success"
            ? "var(--success)"
            : "var(--muted)";
}

async function geocode(query) {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", query);
    url.searchParams.set("count", "7");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("Geocoding failed");
    const data = await res.json();
    return data.results || [];
}

async function reverseGeocode(lat, lon) {
    const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client?");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("Reverse geocoding failed");
    const r = await res.json();
    if (!r) return { name: "Your location", admin1: "", latitude: lat, longitude: lon };
    r.latitude = lat;
    r.longitude = lon;
    return r;
}

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
let weatherAbortCtrl;

async function fetchWeather(lat, lon, tzOverride) {
    try {
        if (weatherAbortCtrl) weatherAbortCtrl.abort();
        weatherAbortCtrl = new AbortController();

        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set("latitude", lat);
        url.searchParams.set("longitude", lon);
        url.searchParams.set(
            "current",
            "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m"
        );
        url.searchParams.set(
            "daily",
            "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max"
        );
        url.searchParams.set("timezone", tzOverride || "auto");

        if (state.unit === "f") {
            url.searchParams.set("temperature_unit", "fahrenheit");
            url.searchParams.set("wind_speed_unit", "mph");
        } else {
            url.searchParams.set("temperature_unit", "celsius");
            url.searchParams.set("wind_speed_unit", "kmh");
        }

        const res = await fetch(url.toString(), { signal: weatherAbortCtrl.signal });
        if (!res.ok) throw new Error("servererror");
        const data = await res.json();
        return data;
    } catch (err) {
        if (err.name === "AbortError") return;
        console.error("Weather fetch failed", err);
    }
}

function applyTempClass(tempC) {
    const body = document.body;
    body.classList.remove('hot','warm','normal','cold','freezing');
    if (tempC >= 35) body.classList.add('hot');
    else if (tempC >= 25) body.classList.add('warm');
    else if (tempC >= 15) body.classList.add('normal');
    else if (tempC >= 5) body.classList.add('cold');
    else body.classList.add('freezing');
}

function renderCurrent(place, weather) {
    const c = weather.current || weather.current_weather;
    if (!c) return;

    const code = c.weather_code;
    const rawTemp = c.temperature_2m ?? c.temperature;
    const displayTempRounded = Math.round(rawTemp ?? 0);

    const tempC = state.unit === "f" ? ((rawTemp - 32) * (5 / 9)) : rawTemp;
    applyTempClass(Math.round(tempC));

    const map = weatherCodeMap[code] || { label: "N/A", icon: "🌡️" };

    setWeatherBackgroundVideoByCode(code, c.precipitation);

    dom.current.innerHTML = `
        <div>
            <div class="city">${place.city || place.name || "undefined"}${place.admin1 ? ", " + place.admin1 : ""}</div>
            <div class="meta small">${map.icon} ${map.label}</div>
            <div class="meta small">
                Humidity: ${c.relative_humidity_2m ?? "-"}% • Wind: ${Math.round(c.wind_speed_10m ?? 0)} ${state.unit === "f" ? "mph" : "km/h"}
            </div>
        </div>
        <div class="temp">${displayTempRounded}°${state.unit === "f" ? "F" : "C"}</div>
    `;
}

function renderForecast(weather) {
    const d = weather.daily;
    if (!d) return;
    const days = d.time.map((dateStr, idx) => ({
        dateStr,
        code: d.weather_code[idx],
        tmax: d.temperature_2m_max[idx],
        tmin: d.temperature_2m_min[idx],
        rain: d.precipitation_sum[idx],
        wind: d.wind_speed_10m_max[idx],
    }));

    dom.forecast.innerHTML = days.map(day => {
        const map = weatherCodeMap[day.code] || { label: "N/A", icon: "🌡️" };
        const date = new Date(day.dateStr);
        const label = date.toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
        });
        return `
            <div class="day-card">
                <div class="label">${map.icon} ${map.label}</div>
                <div class="date">${label}</div>
                <div class="row"><span>Temp</span><span>${Math.round(day.tmin)}° / ${Math.round(day.tmax)}° ${state.unit === "f" ? "F" : "C"}</span></div>
                <div class="row small"><span>Rain</span><span>${Math.round(day.rain)} mm</span></div>
                <div class="row small"><span>Wind</span><span>${Math.round(day.wind)} ${state.unit === "f" ? "mph" : "km/h"}</span></div>
            </div>
        `;
    }).join("");
}

async function loadAndRender(place) {
    try {
        setStatus("Fetching weather…");
        const weather = await fetchWeather(place.latitude, place.longitude);
        if (!weather) throw new Error("No weather data");
        renderCurrent(place, weather);
        renderForecast(weather);
        setStatus(`Updated • ${new Date().toLocaleTimeString()}`, "success");
        state.lastPlace = place;
        localStorage.setItem("lastPlace", JSON.stringify({
            name: place.name,
            admin1: place.admin1 || "",
            latitude: place.latitude,
            longitude: place.longitude,
        }));
    } catch (err) {
        console.error(err);
        setStatus("Could not load weather. Please try again.", "error");
    }
}

function attachSearch() {
    let abortCtrl;
    let lastResults = [];
    let activeIndex = -1;

    const handleQuery = async () => {
        const q = dom.searchInput.value.trim();
        if (!q) {
            dom.suggestions.classList.remove("show");
            dom.suggestions.innerHTML = "";
            activeIndex = -1;
            return;
        }
        try {
            if (abortCtrl) abortCtrl.abort();
            abortCtrl = new AbortController();
            const results = await geocode(q);
            lastResults = results;
            if (!results.length) {
                dom.suggestions.classList.remove("show");
                dom.suggestions.innerHTML = "";
                activeIndex = -1;
                return;
            }
            dom.suggestions.innerHTML = results
                .map(
                    (r, idx) =>
                        `<li role="option" data-idx="${idx}">${r.name}${r.admin1 ? ", " + r.admin1 : ""}${r.country ? " • " + r.country : ""}</li>`
                )
                .join("");
            dom.suggestions.classList.add("show");
            dom.suggestions.querySelectorAll("li").forEach((li) => {
                li.addEventListener("click", () => {
                    const i = Number(li.getAttribute("data-idx"));
                    const place = lastResults[i];
                    dom.searchInput.value = `${place.name}${place.admin1 ? ", " + place.admin1 : ""}`;
                    dom.suggestions.classList.remove("show");
                    loadAndRender(place);
                });
            });
        } catch (e) {
            console.error(e);
        }
    };

    dom.searchInput.addEventListener("input", debounce(handleQuery, 250));
    dom.searchBtn.addEventListener("click", () => handleQuery());
    dom.searchInput.addEventListener("keydown", (e) => {
        if (!dom.suggestions.classList.contains("show")) return;
        const items = Array.from(dom.suggestions.querySelectorAll("li"));
        if (!items.length) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            activeIndex = (activeIndex + 1) % items.length;
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            activeIndex = (activeIndex - 1 + items.length) % items.length;
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (activeIndex >= 0) {
                items[activeIndex].click();
            } else if (lastResults.length) {
                const place = lastResults[0];
                dom.searchInput.value = `${place.name}${place.admin1 ? ", " + place.admin1 : ""}`;
                dom.suggestions.classList.remove("show");
                loadAndRender(place);
            }
            return;
        } else if (e.key === "Escape") {
            dom.suggestions.classList.remove("show");
            activeIndex = -1;
            return;
        } else {
            return;
        }
        items.forEach((el, idx) => {
            el.style.background = idx === activeIndex ? "var(--card-2)" : "transparent";
        });
    });

    document.addEventListener("click", (e) => {
        if (!dom.suggestions.contains(e.target) && e.target !== dom.searchInput) {
            dom.suggestions.classList.remove("show");
            activeIndex = -1;
        }
    });
}

function debounce(fn, wait) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(null, args), wait);
    };
}

function requestLocation() {
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const { latitude, longitude } = pos.coords;
            const place = await reverseGeocode(latitude, longitude);
            place.latitude = latitude;
            place.longitude = longitude;
            loadAndRender(place);
        },
        (err) => {
            console.error(err);
            setStatus("Permission denied or unavailable. Use search or try again.", "error");
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

function attachUseLocation() {
    dom.useLocationBtn.addEventListener("click", requestLocation);
}

function attachUnitToggle() {
    const applyActive = () => {
        if (!dom.unitC || !dom.unitF) return;
        if (state.unit === "f") {
            dom.unitC.classList.remove("active");
            dom.unitC.setAttribute("aria-pressed", "false");
            dom.unitF.classList.add("active");
            dom.unitF.setAttribute("aria-pressed", "true");
        } else {
            dom.unitF.classList.remove("active");
            dom.unitF.setAttribute("aria-pressed", "false");
            dom.unitC.classList.add("active");
            dom.unitC.setAttribute("aria-pressed", "true");
        }
    };
    applyActive();
    dom.unitC?.addEventListener("click", () => {
        state.unit = "c";
        localStorage.setItem("unit", "c");
        applyActive();
        if (state.lastPlace) loadAndRender(state.lastPlace);
    });
    dom.unitF?.addEventListener("click", () => {
        state.unit = "f";
        localStorage.setItem("unit", "f");
        applyActive();
        if (state.lastPlace) loadAndRender(state.lastPlace);
    });
}

function initFooterYear() {
    if (dom.year) dom.year.textContent = new Date().getFullYear();
}

attachSearch();
attachUseLocation();
attachUnitToggle();
initFooterYear();

const savedPlace = localStorage.getItem("lastPlace");
if (savedPlace) {
    try {
        const place = JSON.parse(savedPlace);
        state.lastPlace = place;
        loadAndRender(place);
    } catch {}
} else {
  
    loadAndRender({
        name: "Delhi",
        admin1: "Delhi",
        latitude: 28.6139,
        longitude: 77.2090
    });
}