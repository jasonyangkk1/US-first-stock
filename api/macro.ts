import type { VercelRequest, VercelResponse } from '@vercel/node';

const FRED_API_KEY = process.env.FRED_API_KEY;
const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';

const SERIES = {
  NFP: 'PAYEMS',       // Total Nonfarm Payrolls (Thousands of Persons, Monthly, Cumulative)
  ADP: 'ADPWNUSNERSA', // ADP Total Private Employment (Thousands of Persons, Monthly, Change)
  CPI: 'CPIAUCSL'      // Consumer Price Index (Index 1982-1984=100, Monthly)
};

let cache: { data: any; ts: number } | null = null;
const CACHE_TTL = 600_000;

function getNthDayOfMonth(year: number, month: number, nth: number, dayOfWeek: number) {
  const date = new Date(year, month, 1);
  let count = 0;
  while (date.getMonth() === month) {
    if (date.getDay() === dayOfWeek) {
      count++;
      if (count === nth) return new Date(date);
    }
    date.setDate(date.getDate() + 1);
  }
  return null;
}

function getNextReleaseDates() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  // Helper to check if a release time (approx 13:30 UTC for 08:30 EST) has passed today
  const checkPassed = (d: Date, hourUTC: number, minUTC = 0) => {
    const releaseTime = d.getTime() + hourUTC * 3600000 + minUTC * 60000;
    return releaseTime < now.getTime();
  };

  // ADP: 1st Wed of month, 08:15 EST approx 13:15 UTC
  let adp = getNthDayOfMonth(year, month, 1, 3);
  if (adp && checkPassed(adp, 13, 15)) {
    adp = getNthDayOfMonth(year, month + 1, 1, 3);
  }
  
  // NFP: 1st Fri of month, 08:30 EST approx 13:30 UTC
  let nfp = getNthDayOfMonth(year, month, 1, 5);
  if (nfp && checkPassed(nfp, 13, 30)) {
    nfp = getNthDayOfMonth(year, month + 1, 1, 5);
  }

  // CPI: Approx 2nd Wed (BLS releases it, varies but 2nd Wed is common approximation)
  let cpi = getNthDayOfMonth(year, month, 2, 3);
  if (cpi && checkPassed(cpi, 13, 30)) {
    cpi = getNthDayOfMonth(year, month + 1, 2, 3);
  }

  const format = (d: Date | null, time: string) => d ? `${d.toISOString().split('T')[0]} ${time} (TPE)` : 'TBD';

  return {
    adp: format(adp, '20:15'),
    nfp: format(nfp, '20:30'),
    cpi: format(cpi, '20:30')
  };
}

async function fetchFred(seriesId: string, limit = 16) {
  if (!FRED_API_KEY) return null;
  try {
    const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${FRED_API_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
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
    return res.json({ 
      error: 'FRED_API_KEY not configured',
      instruction: 'Please set FRED_API_KEY in your environment variables.'
    });
  }

  const [nfpData, adpData, cpiData] = await Promise.all([
    fetchFred(SERIES.NFP, 5),
    fetchFred(SERIES.ADP, 5),
    fetchFred(SERIES.CPI, 18)
  ]);

  const dates = getNextReleaseDates();
  
  const validateRange = (val: number, min: number, max: number) => !isNaN(val) && val >= min && val <= max;

  const getResults = () => {
    // NFP: Cumulative thousands, diff needed
    const nfpActualVal = (nfpData && nfpData.length >= 2) ? nfpData[0].value - nfpData[1].value : NaN;
    const nfpPrevVal = (nfpData && nfpData.length >= 3) ? nfpData[1].value - nfpData[2].value : NaN;

    // ADP: Already change in thousands, no diff needed
    const adpActualVal = (adpData && adpData.length >= 1) ? adpData[0].value : NaN;
    const adpPrevVal = (adpData && adpData.length >= 2) ? adpData[1].value : NaN;

    // CPI: Level index, YoY = (current / (12 months ago) - 1) * 100
    const cpiActualVal = (cpiData && cpiData.length >= 13) ? (cpiData[0].value / cpiData[12].value - 1) * 100 : NaN;
    const cpiPrevVal = (cpiData && cpiData.length >= 14) ? (cpiData[1].value / cpiData[13].value - 1) * 100 : NaN;

    return {
      nfp: {
        actual: validateRange(nfpActualVal, -500, 1500) ? `${Math.round(nfpActualVal)}K` : null,
        previous: validateRange(nfpPrevVal, -500, 1500) ? `${Math.round(nfpPrevVal)}K` : null,
        forecast: "145K",
        forecastSource: 'static',
        nextRelease: dates.nfp,
        lastUpdated: new Date().toISOString()
      },
      adp: {
        actual: validateRange(adpActualVal, -500, 1000) ? `${Math.round(adpActualVal)}K` : null,
        previous: validateRange(adpPrevVal, -500, 1000) ? `${Math.round(adpPrevVal)}K` : null,
        forecast: "150K",
        forecastSource: 'static',
        nextRelease: dates.adp,
        lastUpdated: new Date().toISOString()
      },
      cpi: {
        actual: validateRange(cpiActualVal, -5, 20) ? `${cpiActualVal.toFixed(1)}%` : null,
        previous: validateRange(cpiPrevVal, -5, 20) ? `${cpiPrevVal.toFixed(1)}%` : null,
        forecast: "3.4%",
        forecastSource: 'static',
        nextRelease: dates.cpi,
        lastUpdated: new Date().toISOString()
      }
    };
  };

  const results = getResults();

  // Only cache if we got at least one actual value
  if (results.nfp.actual || results.adp.actual || results.cpi.actual) {
    cache = { data: results, ts: Date.now() };
  }
  
  res.json(results);
}
