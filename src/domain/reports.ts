export type ReportPeriodKey =
  | 'today'
  | 'week'
  | 'month'
  | 'six_months'
  | 'year'
  | 'prior_month';

export interface PeriodRange {
  periodKey: ReportPeriodKey;
  labelFilipino: string;
  startUtcIso: string;
  endUtcIso: string;
  startManilaDate: string;
  endManilaDate: string;
}

export interface TopSellingProduct {
  productId: string;
  productName: string;
  variant: string;
  unit: string;
  unitsSold: number;
  revenueCentavos: number;
}

export interface StoreReport {
  period: PeriodRange;
  asOfUtcIso: string;
  netSalesCentavos: number;
  grossSalesCentavos: number;
  cancelledSalesCentavos: number;
  salesCount: number;
  cancelledSalesCount: number;
  collectionBreakdown: {
    cashSalesCentavos: number;
    cashRepaymentsCentavos: number;
    gcashSalesCentavos: number;
    gcashRepaymentsCentavos: number;
  };
  cashCollectionsCentavos: number;
  gcashCollectionsCentavos: number;
  totalCollectionsCentavos: number;
  newCreditCentavos: number;
  currentOutstandingCreditCentavos: number;
  stockNowUnits: number;
  topProducts: TopSellingProduct[];
}

export const FILIPINO_MONTHS = [
  'Enero',
  'Pebrero',
  'Marso',
  'Abril',
  'Mayo',
  'Hunyo',
  'Hulyo',
  'Agosto',
  'Setyembre',
  'Oktubre',
  'Nobyembre',
  'Disyembre',
];

/**
 * Extracts Manila calendar date and time parts from a date input.
 * Asia/Manila is UTC+8 with no DST.
 */
export function getManilaDateTimeParts(dateInput: Date | string | number) {
  const d = typeof dateInput === 'object' ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) {
    throw new Error('Hindi wastong petsa.');
  }

  const manilaMs = d.getTime() + 8 * 60 * 60 * 1000;
  const manilaDate = new Date(manilaMs);

  return {
    year: manilaDate.getUTCFullYear(),
    month: manilaDate.getUTCMonth() + 1, // 1-12
    day: manilaDate.getUTCDate(), // 1-31
    hour: manilaDate.getUTCHours(),
    minute: manilaDate.getUTCMinutes(),
    second: manilaDate.getUTCSeconds(),
    dayOfWeek: manilaDate.getUTCDay(), // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  };
}

/**
 * Converts a Manila calendar date (year, month, day, hour, min, sec) into an ISO string in UTC.
 */
export function createUtcIsoFromManila(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
): string {
  // Subtract 8 hours to get UTC from Manila time
  const ms = Date.UTC(year, month - 1, day, hour - 8, minute, second, millisecond);
  return new Date(ms).toISOString();
}

/**
 * Formats a Manila calendar day as YYYY-MM-DD.
 */
export function formatManilaDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface PriorMonthOption {
  offset: number; // 1 = 1 month ago, 2 = 2 months ago, ...
  label: string; // e.g. "Setyembre 2026"
  year: number;
  month: number;
}

/**
 * Returns the preceding 5 calendar months before the current Manila month.
 */
export function getAvailablePriorMonths(evaluationDate?: Date | string): PriorMonthOption[] {
  const parts = getManilaDateTimeParts(evaluationDate ?? new Date());
  const options: PriorMonthOption[] = [];

  for (let offset = 1; offset <= 5; offset++) {
    let targetMonth = parts.month - offset;
    let targetYear = parts.year;
    while (targetMonth <= 0) {
      targetMonth += 12;
      targetYear -= 1;
    }
    const monthName = FILIPINO_MONTHS[targetMonth - 1];
    options.push({
      offset,
      label: `${monthName} ${targetYear}`,
      year: targetYear,
      month: targetMonth,
    });
  }

  return options;
}

/**
 * Calculates the exact start and end boundaries for a given period in Asia/Manila,
 * ending at now (or the provided evaluation date).
 */
export function calculatePeriodRange(
  periodKey: ReportPeriodKey,
  evaluationDate?: Date | string,
  selectedPriorMonthOffset = 1
): PeriodRange {
  const evalDate = typeof evaluationDate === 'object' ? evaluationDate : new Date(evaluationDate ?? Date.now());
  if (isNaN(evalDate.getTime())) {
    throw new Error('Hindi wastong petsa para sa pagtatasa ng ulat.');
  }

  const endUtcIso = evalDate.toISOString();
  const manila = getManilaDateTimeParts(evalDate);
  const endManilaDate = formatManilaDateString(manila.year, manila.month, manila.day);

  switch (periodKey) {
    case 'today': {
      const startUtcIso = createUtcIsoFromManila(manila.year, manila.month, manila.day, 0, 0, 0, 0);
      return {
        periodKey: 'today',
        labelFilipino: 'Ngayong Araw (Today)',
        startUtcIso,
        endUtcIso,
        startManilaDate: endManilaDate,
        endManilaDate,
      };
    }

    case 'week': {
      // Monday-start week: Monday = 1, Sunday = 0
      const daysSinceMonday = (manila.dayOfWeek + 6) % 7;
      const mondayDate = new Date(Date.UTC(manila.year, manila.month - 1, manila.day - daysSinceMonday));
      const monYear = mondayDate.getUTCFullYear();
      const monMonth = mondayDate.getUTCMonth() + 1;
      const monDay = mondayDate.getUTCDate();

      const startUtcIso = createUtcIsoFromManila(monYear, monMonth, monDay, 0, 0, 0, 0);
      const startManilaDate = formatManilaDateString(monYear, monMonth, monDay);

      return {
        periodKey: 'week',
        labelFilipino: 'Linggong Ito (Monday-start Week)',
        startUtcIso,
        endUtcIso,
        startManilaDate,
        endManilaDate,
      };
    }

    case 'month': {
      const startUtcIso = createUtcIsoFromManila(manila.year, manila.month, 1, 0, 0, 0, 0);
      const startManilaDate = formatManilaDateString(manila.year, manila.month, 1);
      const monthName = FILIPINO_MONTHS[manila.month - 1];

      return {
        periodKey: 'month',
        labelFilipino: `Buwang Ito (${monthName} ${manila.year})`,
        startUtcIso,
        endUtcIso,
        startManilaDate,
        endManilaDate,
      };
    }

    case 'six_months': {
      // Current month plus preceding 5 months = 6 months total
      let startYear = manila.year;
      let startMonth = manila.month - 5;
      while (startMonth <= 0) {
        startMonth += 12;
        startYear -= 1;
      }
      const startUtcIso = createUtcIsoFromManila(startYear, startMonth, 1, 0, 0, 0, 0);
      const startManilaDate = formatManilaDateString(startYear, startMonth, 1);

      return {
        periodKey: 'six_months',
        labelFilipino: `Huling 6 na Buwan (${FILIPINO_MONTHS[startMonth - 1]} ${startYear} – ${FILIPINO_MONTHS[manila.month - 1]} ${manila.year})`,
        startUtcIso,
        endUtcIso,
        startManilaDate,
        endManilaDate,
      };
    }

    case 'prior_month': {
      const priorOptions = getAvailablePriorMonths(evalDate);
      const selected = priorOptions.find((p) => p.offset === selectedPriorMonthOffset) ?? priorOptions[0];

      const startUtcIso = createUtcIsoFromManila(selected.year, selected.month, 1, 0, 0, 0, 0);
      const startManilaDate = formatManilaDateString(selected.year, selected.month, 1);

      // Last day of that prior month
      const lastDayDate = new Date(Date.UTC(selected.year, selected.month, 0));
      const lastDay = lastDayDate.getUTCDate();
      const endMonthUtcIso = createUtcIsoFromManila(selected.year, selected.month, lastDay, 23, 59, 59, 999);
      const endPriorManilaDate = formatManilaDateString(selected.year, selected.month, lastDay);

      return {
        periodKey: 'prior_month',
        labelFilipino: selected.label,
        startUtcIso,
        endUtcIso: endMonthUtcIso,
        startManilaDate,
        endManilaDate: endPriorManilaDate,
      };
    }

    case 'year': {
      const startUtcIso = createUtcIsoFromManila(manila.year, 1, 1, 0, 0, 0, 0);
      const startManilaDate = formatManilaDateString(manila.year, 1, 1);

      return {
        periodKey: 'year',
        labelFilipino: `Taong Ito (${manila.year})`,
        startUtcIso,
        endUtcIso,
        startManilaDate,
        endManilaDate,
      };
    }
  }
}
