import {
  ArrowDownRight,
  BadgeEuro,
  CheckCircle2,
  CircleDot,
  TrendingUp,
} from 'lucide-react';
import { money } from './dashboard-format';
import { RevenueChart } from './revenue-chart-loader';

type DashboardAnalyticsProps = {
  metrics: {
    revenue: number;
    revenueGrowth: number | null;
    approvedCount: number;
    approvedValue: number;
    conversionRate: number;
    quoteCount: number;
  };
  monthlyRevenue: {
    month: string;
    personalRevenue: number;
    companyRevenue: number;
  }[];
};

/** Server Component: nessun JavaScript client per i KPI; il grafico viene caricato a parte. */
export function DashboardAnalytics({
  metrics,
  monthlyRevenue,
}: DashboardAnalyticsProps) {
  const hasRevenueData = monthlyRevenue.some(
    (item) => item.companyRevenue > 0 || item.personalRevenue > 0,
  );

  return (
    <div className="crm-analytics">
      <section className="crm-kpi-grid">
        <article className="crm-kpi-card crm-kpi-revenue">
          <div className="crm-kpi-topline">
            <span className="crm-kpi-icon"><BadgeEuro size={19} /></span>
            <span className="crm-kpi-period">Questo mese</span>
          </div>
          <p>Fatturato aziendale</p>
          <strong>{money(metrics.revenue)}</strong>
          <div className={`crm-kpi-foot ${metrics.revenueGrowth !== null && metrics.revenueGrowth < 0 ? 'negative' : ''}`}>
            {metrics.revenueGrowth !== null && metrics.revenueGrowth < 0 ? (
              <ArrowDownRight size={15} />
            ) : (
              <TrendingUp size={15} />
            )}
            {metrics.revenueGrowth === null ? (
              <span>Nessun confronto con il mese scorso</span>
            ) : (
              <>
                <b>{Math.abs(metrics.revenueGrowth).toFixed(1)}%</b>
                <span>rispetto al mese scorso</span>
              </>
            )}
          </div>
          <span className="crm-kpi-watermark" aria-hidden="true"><TrendingUp /></span>
        </article>

        <article className="crm-kpi-card">
          <div className="crm-kpi-topline">
            <span className="crm-kpi-icon emerald"><CheckCircle2 size={19} /></span>
            <span className="crm-kpi-period">Totale gestito</span>
          </div>
          <p>Preventivi approvati</p>
          <strong>{metrics.approvedCount}</strong>
          <div className="crm-kpi-foot">
            <span>Valore complessivo</span>
            <b>{money(metrics.approvedValue)}</b>
          </div>
          <span className="crm-kpi-watermark" aria-hidden="true"><CheckCircle2 /></span>
        </article>

        <article className="crm-kpi-card">
          <div className="crm-kpi-topline">
            <span className="crm-kpi-icon violet"><CircleDot size={19} /></span>
            <span className="crm-kpi-period">Su {metrics.quoteCount} preventivi</span>
          </div>
          <p>Tasso di conversione</p>
          <strong>{metrics.conversionRate.toFixed(1)}<small>%</small></strong>
          <div className="crm-kpi-foot">
            <span>Approvati / totale gestiti</span>
            <b>{metrics.approvedCount} / {metrics.quoteCount}</b>
          </div>
          <span className="crm-kpi-watermark" aria-hidden="true"><CircleDot /></span>
        </article>
      </section>

      <section className="crm-chart-grid">
        <article className="crm-panel crm-sales-panel">
          <div className="crm-panel-heading">
            <div>
              <span className="crm-eyebrow">ANDAMENTO</span>
              <h2>Trend vendite</h2>
              <p>Preventivi approvati · ultimi 6 mesi</p>
            </div>
            <span className="crm-panel-icon"><TrendingUp size={18} /></span>
          </div>
          <div className="crm-sales-legend" aria-label="Legenda del grafico">
            <span><i className="crm-sales-legend-company" />Totale azienda</span>
            <span><i className="crm-sales-legend-personal" />Le mie vendite</span>
          </div>
          <div className="crm-chart crm-area-chart">
            {hasRevenueData ? (
              <RevenueChart data={monthlyRevenue} />
            ) : (
              <div className="crm-chart-empty">
                <TrendingUp size={24} />
                <span>Il trend comparirà qui quando verranno approvati i primi preventivi.</span>
              </div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
