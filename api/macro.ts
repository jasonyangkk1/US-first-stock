import type { VercelRequest, VercelResponse } from '@vercel/node';

const FRED_API_KEY = process.env.FRED_API_KEY;
const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

const SERIES = {
  NFP: 'PAYEMS',
  ADP: 'ADPWNUSNERSA',
  CPI: 'CPIAUCSL',
  PPI: 'PPIID',
  CORE_PPI: 'PPIFID'
};

let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 600_000; // 10 minutes

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
  // Using 13:15 UTC as a conservative threshold for "passed"
  let adp = getNthDayOfMonth(year, month, 1, 3);
  if (adp && checkPassed(adp, 13, 15)) {
    adp = getNthDayOfMonth(year, month + 1, 1, 3);
  }

  // NFP: 1st Fri of month, 08:30 ET (roughly 13:30 UTC)
  let nfp = getNthDayOfMonth(year, month, 1, 5);
  if (nfp && checkPassed(nfp, 13, 30)) {
    nfp = getNthDayOfMonth(year, month + 1, 1, 5);
  }

  // CPI: 2nd Wed of month (Approx), 08:30 ET
  let cpi = getNthDayOfMonth(year, month, 2, 3);
  if (cpi && checkPassed(cpi, 13, 30)) {
    cpi = getNthDayOfMonth(year, month + 1, 2, 3);
  }

  // PPI: 2nd Thu of month, 08:30 ET (roughly 13:30 UTC)
  let ppi = getNthDayOfMonth(year, month, 2, 4);
  if (ppi && checkPassed(ppi, 13, 30)) {
    ppi = getNthDayOfMonth(year, month + 1, 2, 4);
  }

  const format = (d: Date | null, time: string) => 
    d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${time} (TPE)` : 'TBD';

  return {
    adp: format(adp, '20:15'),
    nfp: format(nfp, '20:30'),
    cpi: format(cpi, '20:30'),
    ppi: format(ppi, '20:30')
  };
}

async function fetchFred(seriesId: string, limit = 16) {
  if (!FRED_API_KEY) return null;
  try {
    const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    return (data.observations || [])
      .filter((o: any) => o.value !== '.')
      .map((o: any) => ({ ...o, value: Number(o.value) }));
  } catch (e) {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return res.json(cache.data);
  }

  if (!FRED_API_KEY) {
    return res.json({ error: 'FRED_API_KEY not configured' });
  }

  const [nfpData, adpData, cpiData, ppiData, corePpiData] = await Promise.all([
    fetchFred(SERIES.NFP, 5),
    fetchFred(SERIES.ADP, 5),
    fetchFred(SERIES.CPI, 18),
    fetchFred(SERIES.PPI, 18),
    fetchFred(SERIES.CORE_PPI, 18)
  ]);

  const dates = getNextReleaseDates();

  const validateRange = (val: number, min: number, max: number) => !isNaN(val) && val >= min && val <= max;

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
      forecast: "145K",
      nextRelease: dates.nfp,
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
      forecast: "150K",
      nextRelease: dates.adp,
      lastUpdated: new Date().toISOString()
    },
    cpi: {
      actual: (cpiData && cpiData.length >= 13) ? (
        (() => {
          const yoy = (cpiData[0].value / cpiData[12].value - 1) * 100;
          return validateRange(yoy, -5, 20) ? `${yoy.toFixed(1)}%` : null;
        })()
      ) : null,
      previous: (cpiData && cpiData.length >= 14) ? (
        (() => {
          const yoy = (cpiData[1].value / cpiData[13].value - 1) * 100;
          return validateRange(yoy, -5, 20) ? `${yoy.toFixed(1)}%` : null;
        })()
      ) : null,
      forecast: "3.4%",
      nextRelease: dates.cpi,
      lastUpdated: new Date().toISOString()
    },
    ppi: {
      actual: (ppiData && ppiData.length >= 13) ? (
        (() => {
          const yoy = (ppiData[0].value / ppiData[12].value - 1) * 100;
          return validateRange(yoy, -10, 30) ? `${yoy.toFixed(1)}%` : null;
        })()
      ) : null,
      previous: (ppiData && ppiData.length >= 14) ? (
        (() => {
          const yoy = (ppiData[1].value / ppiData[13].value - 1) * 100;
          return validateRange(yoy, -10, 30) ? `${yoy.toFixed(1)}%` : null;
        })()
      ) : null,
      forecast: "4.9%",
      nextRelease: dates.ppi,
      lastUpdated: new Date().toISOString()
    },
    core_ppi: {
      actual: (corePpiData && corePpiData.length >= 13) ? (
        (() => {
          const yoy = (corePpiData[0].value / corePpiData[12].value - 1) * 100;
          return validateRange(yoy, -5, 20) ? `${yoy.toFixed(1)}%` : null;
        })()
      ) : null,
      previous: (corePpiData && corePpiData.length >= 14) ? (
        (() => {
          const yoy = (corePpiData[1].value / corePpiData[13].value - 1) * 100;
          return validateRange(yoy, -5, 20) ? `${yoy.toFixed(1)}%` : null;
        })()
      ) : null,
      forecast: "4.3%",
      nextRelease: dates.ppi,
      lastUpdated: new Date().toISOString()
    }
  };

  // Only cache if we have at least one successful fetch
  if (results.nfp.actual || results.adp.actual || results.cpi.actual || results.ppi.actual || results.core_ppi.actual) {
    cache = { data: results, ts: Date.now() };
  }

  res.json(results);
}
