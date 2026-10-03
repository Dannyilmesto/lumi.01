'use client';

import dynamic from 'next/dynamic';

/** Recharts pesa circa 150 kB: viene scaricato dopo il primo rendering della dashboard. */
export const RevenueChart = dynamic(() => import('./revenue-chart'), {
  ssr: false,
});
