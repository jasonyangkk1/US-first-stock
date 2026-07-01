import type { VercelRequest, VercelResponse } from '@vercel/node';

const FRED_API_KEY = process.env.FRED_API_KEY ? process.env.FRED_API_KEY.trim().replace(/^['"]|['"]$/g, '') : undefined;
const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

const SERIES = {
  NFP: 'PAYEMS',
  ADP: 'ADPWNUSNERSA',
  CPI: 'CPIAUCSL',
  PPI: 'WPSFD49207',
  CORE_PPI: 'WPSFD4111',
};

const PPI_FALLBACK = 'PPIFGS';
const CORE_PPI_FALLBACK = 'PPIFES';

let cache: { data: any; ts: number; ttl: number } | null = null;
const CACHE_TTL = 600_000; // 10 minutes default

const CPI_2026 = [
  "2026-01-13", "2026-02-11", "2026-03-11", "2026-04-14", "2026-05-13", "2026-06-12",
  "2026-07-14", "2026-08-12", "2026-09-11", "2026-10-14", "2026-11-13", "2026-12-11"
];

const PPI_2026 = [
  "2026-01-14", "2026-02-12", "2026-03-12", "2026-04-15", "2026-05-14", "2026-06-15",
  "2026-07-15", "2026-08-13", "2026-09-15", "2026-10-15", "2026-11-16", "2026-12-15"
];

function getNthDayOfMonth(year: number, month: number, nth: number, dayOfWeek: number) {
  const date = new Date(Date.UTC(year, month, 1));
  let count = 0;
  while (date.getUTCMonth() === month) {
    if (date.getUTCDay() === dayOfWeek) {
      count++;
      if (count === nth) return new Date(date);
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return null;
}

function getNextReleaseDates() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const checkPassed = (d: Date, hourUTC: number, minUTC = 0) => {
    const releaseTime = d.getTime() + hourUTC * 3600000 + minUTC * 60000;
    return releaseTime < now.getTime();
  };

  // ADP: 1st Wed of month, 08:15 ET (roughly 12:15 or 13:15 UTC)
  let adp = getNthDayOfMonth(year, month, 1, 3);
  if (adp && checkPassed(adp, 13, 15)) {
    adp = getNthDayOfMonth(year, month + 1, 1, 3);
  }

  // NFP: 1st Fri of month, 08:30 ET (roughly 13:30 UTC)
  let nfp = getNthDayOfMonth(year, month, 1, 5);
  if (nfp && checkPassed(nfp, 13, 30)) {
    nfp = getNthDayOfMonth(year, month + 1, 1, 5);
  }

  // CPI: Lookup schedule for 2026, fallback otherwise
  let cpi: Date | null = null;
  if (year === 2026 && month < 12) {
    const scheduledStr = CPI_2026[month];
    const candidate = new Date(scheduledStr + "T13:30:00Z");
    if (checkPassed(candidate, 0, 0)) {
      if (month + 1 < 12) {
        cpi = new Date(CPI_2026[month + 1] + "T13:30:00Z");
      } else {
        cpi = getNthDayOfMonth(year + 1, 0, 2, 3);
      }
    } else {
      cpi = candidate;
    }
  } else {
    cpi = getNthDayOfMonth(year, month, 2, 3);
    if (cpi && checkPassed(cpi, 13, 30)) {
      cpi = getNthDayOfMonth(year, month + 1, 2, 3);
    }
  }

  // PPI: Lookup schedule for 2026, fallback otherwise
  let ppi: Date | null = null;
  if (year === 2026 && month < 12) {
    const scheduledStr = PPI_2026[month];
    const candidate = new Date(scheduledStr + "T13:30:00Z");
    if (checkPassed(candidate, 0, 0)) {
      if (month + 1 < 12) {
        ppi = new Date(PPI_2026[month + 1] + "T13:30:00Z");
      } else {
        ppi = getNthDayOfMonth(year + 1, 0, 2, 4);
      }
    } else {
      ppi = candidate;
    }
  } else {
    ppi = getNthDayOfMonth(year, month, 2, 4);
    if (ppi && checkPassed(ppi, 13, 30)) {
      ppi = getNthDayOfMonth(year, month + 1, 2, 4);
    }
  }

  const format = (d: Date | null, time: string) => {
    if (!d) return 'TBD';
    const tpeOffset = 8 * 60;
    const tpeTime = new Date(d.getTime() + tpeOffset * 60 * 1000);
    const yr = tpeTime.getUTCFullYear();
    const mo = String(tpeTime.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(tpeTime.getUTCDate()).padStart(2, '0');
    return `${yr}-${mo}-${dy} ${time} (TPE)`;
  };

  return {
    adp: format(adp, '20:15'),
    nfp: format(nfp, '20:30'),
    cpi: format(cpi, '20:30'),
    ppi: format(ppi, '20:30')
  };
}

async function fetchWithTimeout(url: string, timeoutMs = 8000) {
  let timeoutId: any = null;
  let signal: AbortSignal | undefined = undefined;

  if (typeof AbortController !== 'undefined') {
    const controller = new AbortController();
    signal = controller.signal;
    timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(url, { signal });
    if (timeoutId) clearTimeout(timeoutId);
    return response;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    throw err;
  }
}

async function fetchFred(seriesId: string, limit = 16, retries = 2) {
  if (!FRED_API_KEY) return null;
  const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, 6000); // 6s per request to leave time for retries
      if (res.status === 429) {
        console.warn(`[macro] Rate limited for ${seriesId}, attempt ${attempt + 1}/${retries + 1}`);
        const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      if (!res.ok) {
        let errorText = '';
        try { errorText = await res.text(); } catch {}
        console.warn(`[macro] FRED ${seriesId} HTTP ${res.status}: ${errorText.slice(0, 150)}`);
        if (res.status >= 500) {
          const delayMs = Math.pow(2, attempt) * 500 + Math.random() * 200;
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        return null;
      }
      const data: any = await res.json();
      const filtered = (data.observations || [])
        .filter((o: any) => o.value !== '.')
        .map((o: any) => ({ ...o, value: Number(o.value) }));
      return filtered.length > 0 ? filtered : null;
    } catch (e: any) {
      const isTimeout = e?.name === 'AbortError';
      console.warn(`[macro] FRED ${seriesId} try ${attempt + 1} failed:`, isTimeout ? 'timeout' : e?.message?.slice(0, 120));
      if (attempt < retries) {
        const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      return null;
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!FRED_API_KEY) {
    return res.json({ error: 'FRED_API_KEY not configured' });
  }

  // GET /api/macro?debug=1 → 回傳原始 FRED 數據與計算過程，不受 cache 影響
  if (req.query?.debug === '1') {
    try {
      const debugResults: any = { timestamp: new Date().toISOString(), series: {} };
      const entries = Object.entries(SERIES);
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const allResults = await Promise.allSettled(
        entries.map(([, seriesId], index) => delay(index * 200).then(() => fetchFred(seriesId, 20)))
      );

      const fallbackResultsList = await Promise.allSettled([
        delay(entries.length * 200).then(() => fetchFred(PPI_FALLBACK, 20)),
        delay((entries.length + 1) * 200).then(() => fetchFred(CORE_PPI_FALLBACK, 20))
      ]);

      const safeGet = (r: PromiseSettledResult<any>) => r.status === 'fulfilled' ? r.value : null;

      for (let i = 0; i < entries.length; i++) {
        const [key, seriesId] = entries[i];
        let data = safeGet(allResults[i]);
        if (key === 'PPI' && (!data || data.length < 14)) {
          data = safeGet(fallbackResultsList[0]);
        }
        if (key === 'CORE_PPI' && (!data || data.length < 14)) {
          data = safeGet(fallbackResultsList[1]);
        }
        debugResults.series[key] = {
          seriesId,
          count: data?.length ?? 0,
          latest3: data?.slice(0, 3).map(d => ({ date: d.date, value: d.value })) ?? [],
          oldest3: data?.slice(-3).map(d => ({ date: d.date, value: d.value })) ?? [],
          calcResult: data ? (() => {
            if (data.length < 1) return { error: 'insufficient data' };
            const current = data[0];
            const targetDate = new Date(current.date);
            targetDate.setFullYear(targetDate.getFullYear() - 1);
            const bestMatches = data.slice(1).map(d => ({
              date: d.date,
              diffDays: Math.abs(new Date(d.date).getTime() - targetDate.getTime()) / 86400000,
              value: d.value
            })).filter(d => d.diffDays <= 60).sort((a, b) => a.diffDays - b.diffDays);
            return {
              current: { date: current.date, value: current.value },
              targetDate: targetDate.toISOString().slice(0, 10),
              bestMatchFound: bestMatches[0] ?? null,
              candidatesCount: bestMatches.length,
              yoy: bestMatches[0] ? ((current.value / bestMatches[0].value - 1) * 100).toFixed(2) + '%' : null
            };
          })() : { error: 'no data' }
        };
      }
      return res.json(debugResults);
    } catch (err: any) {
      return res.status(500).json({ error: 'Debug fetch failed', details: err.message });
    }
  }

  if (cache && Date.now() - cache.ts < cache.ttl) {
    return res.json(cache.data);
  }

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  // Parallel fetch using Promise.allSettled, but spreading them out to avoid FRED burst 429 rate limit
  const [nfpResult, adpResult, cpiResult, ppiResult, corePpiResult, ppiFallbackResult, corePpiFallbackResult] = await Promise.allSettled([
    fetchFred(SERIES.NFP, 6),
    delay(200).then(() => fetchFred(SERIES.ADP, 6)),
    delay(400).then(() => fetchFred(SERIES.CPI, 20)),
    delay(600).then(() => fetchFred(SERIES.PPI, 20)),
    delay(800).then(() => fetchFred(SERIES.CORE_PPI, 20)),
    delay(1000).then(() => fetchFred(PPI_FALLBACK, 20)),
    delay(1200).then(() => fetchFred(CORE_PPI_FALLBACK, 20)),
  ]);

  const safeGet = (r: PromiseSettledResult<any>) => r.status === 'fulfilled' ? r.value : null;

  const nfpData = safeGet(nfpResult);
  const adpData = safeGet(adpResult);
  const cpiData = safeGet(cpiResult);

  const ppiMain = safeGet(ppiResult);
  const ppiFallback = safeGet(ppiFallbackResult);
  const ppiIsMain = !!(ppiMain && ppiMain.length >= 14);
  const ppiData = ppiIsMain ? ppiMain : ppiFallback;

  const corePpiMain = safeGet(corePpiResult);
  const corePpiFallback = safeGet(corePpiFallbackResult);
  const corePpiIsMain = !!(corePpiMain && corePpiMain.length >= 14);
  const corePpiData = corePpiIsMain ? corePpiMain : corePpiFallback;

  console.log('[macro] Series used:', {
    ppi: ppiIsMain ? SERIES.PPI : PPI_FALLBACK,
    corePpi: corePpiIsMain ? SERIES.CORE_PPI : CORE_PPI_FALLBACK,
  });

  const dates = getNextReleaseDates();
  const validateRange = (val: number, min: number, max: number) => !isNaN(val) && val >= min && val <= max;

  // 判斷 ADP 是否為「今天發布但尚未公布」
  const tpeTime = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const yr = tpeTime.getUTCFullYear();
  const mo = String(tpeTime.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(tpeTime.getUTCDate()).padStart(2, '0');
  const tpeTodayStr = `${yr}-${mo}-${dy}`;
  const adpReleaseToday = dates.adp.startsWith(tpeTodayStr);
  const tpeNowHour = tpeTime.getUTCHours();
  const tpeNowMin = tpeTime.getUTCMinutes();
  const isBeforeRelease = (tpeNowHour < 20) || (tpeNowHour === 20 && tpeNowMin < 15);
  const adpReleasePending = adpReleaseToday && isBeforeRelease;

  function calcYoY(data: Array<{value: number, date: string}> | null, currentIdx = 0, minVal = -15, maxVal = 35): string | null {
    if (!data || data.length < currentIdx + 1) return null;
    
    const current = data[currentIdx];
    const currentDate = new Date(current.date);
    const targetDate = new Date(currentDate);
    targetDate.setFullYear(targetDate.getFullYear() - 1); // Exact 1 year ago
    
    // Find the closest observation to 1 year ago (up to 60 days difference)
    let bestMatch: {value: number; date: string} | null = null;
    let bestDiff = Infinity;
    
    for (let i = currentIdx + 1; i < data.length; i++) {
      const d = new Date(data[i].date);
      const diff = Math.abs(d.getTime() - targetDate.getTime());
      const diffDays = diff / (1000 * 60 * 60 * 24);
      if (diffDays <= 60 && diffDays < bestDiff) {
        bestDiff = diffDays;
        bestMatch = data[i];
      }
    }
    
    if (!bestMatch) {
      console.warn(`[macro] calcYoY: no match found for ${current.date}, searched ${data.length - currentIdx - 1} observations`);
      return null;
    }

    if (bestDiff > 35) {
      console.warn(`[macro] calcYoY: best match is ${bestDiff.toFixed(0)} days off for ${current.date}`);
    }
    
    const yoy = (current.value / bestMatch.value - 1) * 100;
    return validateRange(yoy, minVal, maxVal) ? `${yoy.toFixed(1)}%` : null;
  }

  const results = {
    nfp: {
      actual: (nfpData && nfpData.length >= 2) ? (
        validateRange(nfpData[0].value - nfpData[1].value, -500, 1500) 
          ? `${Math.round(nfpData[0].value - nfpData[1].value)}K` : null
      ) : null,
      previous: (nfpData && nfpData.length >= 3) ? (
        validateRange(nfpData[1].value - nfpData[2].value, -500, 1500) 
          ? `${Math.round(nfpData[1].value - nfpData[2].value)}K` : null
      ) : null,
      forecast: "130K",
      forecastSource: "市場共識",
      forecastAsOf: "2026-06",
      nextRelease: dates.nfp,
      dataDate: nfpData?.[0]?.date ?? null,
      dataSource: SERIES.NFP,
      lastUpdated: new Date().toISOString()
    },
    adp: {
      actual: (adpData && adpData.length >= 1) ? (
        validateRange(adpData[0].value, -500, 1000) 
          ? `${Math.round(adpData[0].value)}K` : null
      ) : null,
      previous: (adpData && adpData.length >= 2) ? (
        validateRange(adpData[1].value, -500, 1000) 
          ? `${Math.round(adpData[1].value)}K` : null
      ) : null,
      forecast: "130K",
      forecastSource: "市場共識",
      forecastAsOf: "2026-06",
      nextRelease: dates.adp,
      pendingRelease: adpReleasePending,
      pendingReleaseTime: adpReleasePending ? dates.adp : null,
      dataDate: adpData?.[0]?.date ?? null,
      dataSource: SERIES.ADP,
      lastUpdated: new Date().toISOString()
    },
    cpi: {
      actual: calcYoY(cpiData, 0, -5, 20),
      previous: calcYoY(cpiData, 1, -5, 20),
      forecast: "2.4%",
      forecastSource: "市場共識",
      forecastAsOf: "2026-06",
      nextRelease: dates.cpi,
      dataDate: cpiData?.[0]?.date ?? null,
      dataSource: SERIES.CPI,
      lastUpdated: new Date().toISOString()
    },
    ppi: {
      actual: calcYoY(ppiData, 0, -10, 30),
      previous: calcYoY(ppiData, 1, -10, 30),
      forecast: "3.2%",
      forecastSource: "市場共識",
      forecastAsOf: "2026-06",
      nextRelease: dates.ppi,
      dataDate: ppiData?.[0]?.date ?? null,
      dataSource: ppiIsMain ? SERIES.PPI : PPI_FALLBACK,
      lastUpdated: new Date().toISOString()
    },
    core_ppi: {
      actual: calcYoY(corePpiData, 0, -5, 20),
      previous: calcYoY(corePpiData, 1, -5, 20),
      forecast: "3.0%",
      forecastSource: "市場共識",
      forecastAsOf: "2026-06",
      nextRelease: dates.ppi,
      dataDate: corePpiData?.[0]?.date ?? null,
      dataSource: corePpiIsMain ? SERIES.CORE_PPI : CORE_PPI_FALLBACK,
      lastUpdated: new Date().toISOString()
    }
  };

  console.log('[macro] Data status:', {
    nfp:      { count: nfpData?.length, actual: results.nfp.actual, date: nfpData?.[0]?.date },
    adp:      { count: adpData?.length, actual: results.adp.actual, date: adpData?.[0]?.date },
    cpi:      { count: cpiData?.length, actual: results.cpi.actual, date: cpiData?.[0]?.date },
    ppi:      { count: ppiData?.length, actual: results.ppi.actual, date: ppiData?.[0]?.date },
    core_ppi: { count: corePpiData?.length, actual: results.core_ppi.actual, date: corePpiData?.[0]?.date },
  });

  const successCount = [
    results.nfp.actual,
    results.adp.actual,
    results.cpi.actual,
    results.ppi.actual,
    results.core_ppi.actual,
  ].filter(Boolean).length;

  console.log(`[macro] Success: ${successCount}/5 indicators have data`);

  if (successCount >= 3) {
    cache = { data: results, ts: Date.now(), ttl: CACHE_TTL };
  } else if (successCount >= 1) {
    cache = { data: results, ts: Date.now(), ttl: 2 * 60 * 1000 };
    console.warn('[macro] Partial data, using short cache TTL (2min)');
  } else {
    console.warn('[macro] All fetches failed, not caching');
  }

  res.json(results);
}
