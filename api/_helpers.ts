
import YahooFinance from 'yahoo-finance2';

const instance = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });

export const yahooFinance = instance;

export const formatYFDate = (d: any) => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  if (typeof d === 'number') {
    const isMs = d > 100000000000;
    return new Date(isMs ? d : d * 1000).toISOString();
  }
  try {
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  } catch {}
  return String(d);
};
